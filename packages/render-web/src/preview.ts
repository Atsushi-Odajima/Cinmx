import type { Asset, Project, RenderPlan, AssetInfoLookup } from '@cinemix/core';
import { buildRenderPlan, renderFrame, totalDurationMs, LIMITS } from '@cinemix/core';
import { WebFrameResources, type BlobLoader } from './resources';
import { getMeasureFactory } from './measure';
import { decodeAudioBlob, getAudioContext, scheduleAudioPreview } from './audio';
import { makeAssetInfo } from './export/common';

export type PreviewState = { playing: boolean; timeMs: number; durationMs: number; ready: boolean; error: string | null };

/**
 * 編集画面のプレビュー。renderFrame を rAF ループで呼び、音声は Web Audio で同じ計画（区間・音量・フェード）を使う。
 * 実時刻は「現在の再生位置」の決定にだけ使い、描画内容は renderFrame(project, tMs) の決定論に従う。
 */
export class PreviewPlayer {
  private project: Project;
  private assets: ReadonlyMap<string, Asset>;
  private plan: RenderPlan;
  private resources: WebFrameResources | null = null;
  private assetInfo: AssetInfoLookup;
  private loadToken = 0;
  private raf = 0;
  private playing = false;
  private timeMs = 0;
  private startedWall = 0;
  private startedTime = 0;
  private audioCtx: AudioContext | null = null;
  private audioNode: AudioBufferSourceNode | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private audioAssetId: string | null = null;
  private listeners = new Set<(s: PreviewState) => void>();
  private ready = false;
  private error: string | null = null;
  private renderPending = false;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    project: Project,
    assets: ReadonlyMap<string, Asset>,
    private readonly loadBlob: BlobLoader,
  ) {
    this.project = project;
    this.assets = assets;
    this.canvas.width = LIMITS.canvas.width;
    this.canvas.height = LIMITS.canvas.height;
    this.plan = buildRenderPlan(project, getMeasureFactory());
    this.assetInfo = makeAssetInfo(assets);
    void this.reloadResources();
  }

  subscribe(cb: (s: PreviewState) => void): () => void {
    this.listeners.add(cb);
    cb(this.state());
    return () => this.listeners.delete(cb);
  }

  state(): PreviewState {
    return { playing: this.playing, timeMs: this.timeMs, durationMs: this.plan.durationMs, ready: this.ready, error: this.error };
  }

  private emit() {
    const s = this.state();
    for (const l of this.listeners) l(s);
  }

  /** 素材の参照が変わったときだけ再デコードする。文字や音量の変更は plan の再構築のみ。 */
  update(project: Project, assets: ReadonlyMap<string, Asset>): void {
    const prevRefs = refKey(this.project);
    this.project = project;
    this.assets = assets;
    this.assetInfo = makeAssetInfo(assets);
    this.plan = buildRenderPlan(project, getMeasureFactory());
    if (this.timeMs >= this.plan.durationMs) this.timeMs = Math.max(0, this.plan.durationMs - 1);
    if (refKey(project) !== prevRefs) void this.reloadResources();
    else this.requestRender();
    if (project.audio?.assetId !== this.audioAssetId) {
      this.audioBuffer = null;
      this.audioAssetId = project.audio?.assetId ?? null;
      if (this.playing) this.restartAudio();
    } else if (this.playing && project.audio) {
      // 音量・区間の変更を反映
      this.restartAudio();
    }
    this.emit();
  }

  private async reloadResources(): Promise<void> {
    const token = ++this.loadToken;
    this.ready = false;
    this.error = null;
    this.emit();
    const res = new WebFrameResources(this.project, this.assets, this.loadBlob, 'mediabunny');
    try {
      await res.load();
    } catch (e) {
      this.error = (e as Error).message;
    }
    if (token !== this.loadToken || this.disposed) {
      res.close();
      return;
    }
    this.resources?.close();
    this.resources = res;
    if (res.warnings.length > 0) this.error = res.warnings.join(' / ');
    this.ready = true;
    this.emit();
    this.requestRender();
  }

  requestRender(): void {
    if (this.renderPending) return;
    this.renderPending = true;
    requestAnimationFrame(() => {
      this.renderPending = false;
      void this.renderAt(this.timeMs);
    });
  }

  private async renderAt(tMs: number): Promise<void> {
    const res = this.resources;
    if (!res) return;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    try {
      await res.prepare(tMs);
    } catch {
      /* 動画デコード失敗時はそのまま描く */
    }
    if (this.resources !== res) return;
    renderFrame(ctx, this.plan, tMs, res, this.assetInfo);
  }

  async seek(tMs: number): Promise<void> {
    const D = this.plan.durationMs;
    this.timeMs = Math.max(0, Math.min(tMs, Math.max(0, D - 1)));
    if (this.playing) {
      this.startedWall = performance.now();
      this.startedTime = this.timeMs;
      this.restartAudio();
    }
    this.emit();
    await this.renderAt(this.timeMs);
  }

  /** 必ずユーザー操作から呼ぶ（音声再生のため） */
  async play(): Promise<void> {
    if (this.playing) return;
    if (this.timeMs >= this.plan.durationMs - 1) this.timeMs = 0;
    this.playing = true;
    this.startedWall = performance.now();
    this.startedTime = this.timeMs;
    await this.ensureAudio();
    this.restartAudio();
    this.emit();
    const loop = async () => {
      if (!this.playing || this.disposed) return;
      const t = this.startedTime + (performance.now() - this.startedWall);
      if (t >= this.plan.durationMs) {
        this.timeMs = this.plan.durationMs - 1;
        await this.renderAt(this.timeMs);
        this.pause();
        return;
      }
      this.timeMs = t;
      await this.renderAt(t);
      this.emit();
      this.raf = requestAnimationFrame(() => void loop());
    };
    this.raf = requestAnimationFrame(() => void loop());
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.stopAudio();
    this.emit();
  }

  private async ensureAudio(): Promise<void> {
    const audio = this.project.audio;
    if (!audio) return;
    if (!this.audioCtx) {
      try {
        this.audioCtx = getAudioContext();
      } catch {
        return;
      }
    }
    if (this.audioCtx.state === 'suspended') await this.audioCtx.resume().catch(() => {});
    if (!this.audioBuffer || this.audioAssetId !== audio.assetId) {
      const blob = await this.loadBlob(audio.assetId);
      if (!blob) return;
      try {
        this.audioBuffer = await decodeAudioBlob(blob);
        this.audioAssetId = audio.assetId;
      } catch {
        this.audioBuffer = null;
      }
    }
  }

  private restartAudio(): void {
    this.stopAudio();
    const audio = this.project.audio;
    if (!this.playing || !audio || !this.audioCtx || !this.audioBuffer) return;
    this.audioNode = scheduleAudioPreview(this.audioCtx, this.audioBuffer, audio, totalDurationMs(this.project.templateSnapshot), this.timeMs);
  }

  private stopAudio(): void {
    try {
      this.audioNode?.stop();
    } catch {
      /* ignore */
    }
    this.audioNode = null;
  }

  /** 書き出し中など重い処理の前に呼ぶ（再生停止＋デコード資源を解放しない） */
  suspend(): void {
    this.pause();
  }

  dispose(): void {
    this.disposed = true;
    this.pause();
    this.resources?.close();
    this.resources = null;
    void this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    this.listeners.clear();
  }
}

function refKey(p: Project): string {
  return [p.templateSnapshot.backgroundAssetId ?? '', ...p.slotBindings.map((b) => `${b.slotId}:${b.assetId}:${b.sourceInMs}`)].join('|');
}
