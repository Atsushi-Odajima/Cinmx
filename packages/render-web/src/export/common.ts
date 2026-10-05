import type { Asset, Project, RenderPlan, AssetInfoLookup } from '@cinemix/core';
import { buildRenderPlan, totalDurationMs } from '@cinemix/core';
import { ExportError, type ExportProgress } from '@cinemix/platform';
import { ensureFontsLoaded } from '../fonts';
import { getMeasureFactory } from '../measure';
import { WebFrameResources, type BlobLoader } from '../resources';
import { decodeAudioBlob, renderAudioTrack } from '../audio';

export type PreparedExport = {
  plan: RenderPlan;
  resources: WebFrameResources;
  assetInfo: AssetInfoLookup;
  audioBuffer: AudioBuffer | null;
  durationMs: number;
};

export function makeAssetInfo(assets: ReadonlyMap<string, Asset>): AssetInfoLookup {
  return (id) => {
    const a = assets.get(id);
    return a ? { kind: a.kind, durationMs: a.durationMs } : undefined;
  };
}

/** フォント→素材→音声の順に準備する。失敗は ExportError。 */
export async function prepareExport(
  project: Project,
  assets: ReadonlyMap<string, Asset>,
  loadBlob: BlobLoader,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
  withAudio: boolean,
  videoPreference: 'mediabunny' | 'html-video' = 'mediabunny',
): Promise<PreparedExport> {
  const durationMs = totalDurationMs(project.templateSnapshot);
  const framesTotal = Math.ceil((durationMs * 30) / 1000);
  const throwIfAborted = () => {
    if (signal.aborted) throw new ExportError('cancelled', '書き出しをキャンセルしました');
  };

  onProgress({ phase: 'fonts', ratio: 0, framesDone: 0, framesTotal, message: 'フォントを準備しています' });
  const fontRes = await ensureFontsLoaded(project.texts.map((t) => ({ fontId: t.fontId, text: t.value })));
  if (!fontRes.ok) throw new ExportError('font', fontRes.failed.map((f) => f.reason).join(' / '));
  throwIfAborted();

  onProgress({ phase: 'preparing', ratio: 0, framesDone: 0, framesTotal, message: '素材を読み込んでいます' });
  const resources = new WebFrameResources(project, assets, loadBlob, videoPreference);
  try {
    await resources.load();
  } catch (e) {
    resources.close();
    throw new ExportError('asset', `素材を読み込めません: ${(e as Error).message}`, e);
  }
  if (resources.warnings.length > 0) {
    resources.close();
    throw new ExportError('asset', resources.warnings.join(' / '));
  }
  throwIfAborted();

  let audioBuffer: AudioBuffer | null = null;
  if (withAudio && project.audio) {
    onProgress({ phase: 'audio', ratio: 0, framesDone: 0, framesTotal, message: '音楽を処理しています' });
    const blob = await loadBlob(project.audio.assetId);
    if (!blob) {
      resources.close();
      throw new ExportError('audio', '音源が見つかりません');
    }
    try {
      const decoded = await decodeAudioBlob(blob);
      audioBuffer = await renderAudioTrack(decoded, project.audio, durationMs);
    } catch (e) {
      resources.close();
      throw new ExportError('audio', `音源を処理できません: ${(e as Error).message}`, e);
    }
  }
  throwIfAborted();
  const plan = buildRenderPlan(project, getMeasureFactory());
  return { plan, resources, assetInfo: makeAssetInfo(assets), audioBuffer, durationMs };
}

export function createExportCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: false });
  if (!ctx) throw new ExportError('unknown', 'Canvas 2D を初期化できません');
  return { canvas, ctx };
}

/** 画面ロック／バックグラウンド移行の検出。復帰後は再試行へ。 */
export class InterruptionWatch {
  private hidden = false;
  private readonly handler = () => {
    if (document.visibilityState === 'hidden') this.hidden = true;
  };
  start(): void {
    document.addEventListener('visibilitychange', this.handler);
  }
  stop(): void {
    document.removeEventListener('visibilitychange', this.handler);
  }
  wasInterrupted(): boolean {
    return this.hidden;
  }
}

export async function acquireWakeLock(): Promise<{ release: () => Promise<void> } | null> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    if (!nav.wakeLock) return null;
    const lock = await nav.wakeLock.request('screen');
    return lock;
  } catch {
    return null; // 非対応・拒否はエラーにしない
  }
}
