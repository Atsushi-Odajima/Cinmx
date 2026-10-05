/**
 * 自動テスト・見本生成用のフック（window.__cinemix）。
 * 利用者のデータには触れない（毎回独立した DB 名を使う）。
 */
import { BUILTIN_TEMPLATES, createProjectFromTemplate, assignAssetsInOrder, addText, setAudio, setBackground, type Project, type Asset, type FontId } from '@cinemix/core';
import { createDB, AssetStore } from '@cinemix/storage';
import type { ExportOptions, ExportProgress, ExportResult } from '@cinemix/platform';
import { WebMediaAdapter, WebRenderAdapter, probeCapabilities, renderStill, WebFrameResources, getMeasureFactory, ensureFontsLoaded, makeAssetInfo } from '@cinemix/render-web';
import { buildRenderPlan, renderFrame, frameTimeMs, frameCount, LIMITS } from '@cinemix/core';

export type HarnessExportOptions = ExportOptions & {
  templateId?: string;
  texts?: { value: string; fontId: FontId; slotIndex: number | null; centerY?: number; color?: string; band?: boolean }[];
  audio?: { sourceInMs: number; sourceOutMs: number; volume: number; fadeOutMs: number } | null;
  withBackground?: boolean;
  sampleFiles?: string[];
};

async function fetchFile(path: string, type: string): Promise<File> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`fetch failed: ${path}`);
  const b = await r.blob();
  return new File([b], path.split('/').pop() ?? 'file', { type });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) s += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
  return btoa(s);
}

async function buildSampleProject(opts: HarnessExportOptions): Promise<{ project: Project; assets: Map<string, Asset>; store: AssetStore }> {
  const db = createDB(`harness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const store = new AssetStore(db);
  const media = new WebMediaAdapter(store);
  const template = BUILTIN_TEMPLATES.find((t) => t.id === opts.templateId) ?? BUILTIN_TEMPLATES[0]!;
  const names = opts.sampleFiles ?? ['sample-01.jpg', 'sample-02.jpg', 'sample-03.jpg', 'sample-04.jpg', 'sample-05.jpg'];
  const files = await Promise.all(names.map((n) => fetchFile(`/samples/${n}`, n.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg')));
  const imported = await media.import(files, ['image', 'video']);
  const bad = imported.filter((i) => !i.result.ok);
  if (bad.length) throw new Error('import failed: ' + JSON.stringify(bad.map((b) => b.result)));
  const ids = imported.map((i) => i.asset!.id);
  let project = createProjectFromTemplate(template, 'Harness');
  project = assignAssetsInOrder(project, ids).project;
  const texts = opts.texts ?? [
    { value: '夏の記録\n2026', fontId: 'noto-serif-jp', slotIndex: 0, centerY: 0.5 },
    { value: 'Summer Days', fontId: 'caveat', slotIndex: 1, centerY: 0.2 },
    { value: '海と、光と', fontId: 'noto-sans-jp', slotIndex: 2, centerY: 0.8, band: true },
    { value: 'おわり', fontId: 'noto-sans-jp', slotIndex: 4, centerY: 0.5 },
  ];
  for (const t of texts) {
    const slotId = t.slotIndex === null ? null : template.slots[t.slotIndex]!.id;
    const r = addText(
      project,
      {
        value: t.value,
        fontId: t.fontId,
        color: t.color ?? '#FFFCF4',
        centerY: t.centerY ?? 0.78,
        ...(t.band ? { background: { color: '#25382E', opacity: 0.6, paddingRatio: 0.02 } } : {}),
      },
      slotId,
    );
    if ('error' in r) throw new Error(r.error);
    project = r.project;
  }
  if (opts.withBackground) {
    const bg = await fetchFile('/samples/background-01.jpg', 'image/jpeg');
    const [res] = await media.import([bg], ['image']);
    if (res?.asset) project = setBackground(project, res.asset.id, { centerX: 0.5, centerY: 0.5, scale: 1 });
  }
  if (opts.audio !== null) {
    const bgm = await fetchFile('/samples/cinemix-sample-bgm.mp3', 'audio/mpeg');
    const [res] = await media.import([bgm], ['audio']);
    if (!res?.asset) throw new Error('bgm import failed: ' + JSON.stringify(res?.result));
    const a = opts.audio ?? { sourceInMs: 2000, sourceOutMs: 10000, volume: 0.7, fadeOutMs: 1000 };
    project = setAudio(project, { assetId: res.asset.id, ...a });
  }
  const assets = await store.getMany([...project.slotBindings.map((b) => b.assetId), ...(project.audio ? [project.audio.assetId] : []), ...(project.templateSnapshot.backgroundAssetId ? [project.templateSnapshot.backgroundAssetId] : [])]);
  return { project, assets, store };
}

export function installHarness(): void {
  const api = {
    version: __APP_VERSION__,
    probe: () => probeCapabilities(true),
    buildSampleProject: async (opts: HarnessExportOptions = {}) => {
      const { project } = await buildSampleProject(opts);
      return project;
    },
    exportSample: async (opts: HarnessExportOptions = {}) => {
      const { project, assets, store } = await buildSampleProject(opts);
      const adapter = new WebRenderAdapter((id) => store.getBlob(id));
      const progress: ExportProgress[] = [];
      const started = performance.now();
      const result: ExportResult = await adapter.export(project, assets, (p) => progress.push(p), new AbortController().signal, opts);
      const base64 = await blobToBase64(result.blob);
      return {
        base64,
        size: result.blob.size,
        mime: result.mime,
        extension: result.extension,
        width: result.width,
        height: result.height,
        durationMs: result.durationMs,
        hasAudio: result.hasAudio,
        audioCodec: result.audioCodec,
        path: result.path,
        elapsedMs: result.elapsedMs,
        wallMs: Math.round(performance.now() - started),
        progressCount: progress.length,
        phases: [...new Set(progress.map((p) => p.phase))],
        lastProgress: progress[progress.length - 1] ?? null,
        monotonic: progress.every((p, i) => i === 0 || p.framesDone >= progress[i - 1]!.framesDone),
        texts: project.texts.map((t) => ({ value: t.value, fontId: t.fontId, startMs: t.startMs, endMs: t.endMs })),
        audio: project.audio ?? null,
      };
    },
    cancelSample: async (opts: HarnessExportOptions = {}, cancelAtMs: number) => {
      const { project, assets, store } = await buildSampleProject(opts);
      const adapter = new WebRenderAdapter((id) => store.getBlob(id));
      const ac = new AbortController();
      setTimeout(() => ac.abort(), cancelAtMs);
      try {
        await adapter.export(project, assets, () => {}, ac.signal, opts);
        return { cancelled: false };
      } catch (e) {
        return { cancelled: true, code: (e as { code?: string }).code, message: (e as Error).message };
      }
    },
    /** 見本動画の生成用: 同じ描画エンジンでフレーム列（JPEG）を返す。エンコードはホスト側（ffmpeg）で行う。 */
    renderFramesSample: async (opts: HarnessExportOptions, fromFrame: number, toFrame: number, quality = 0.85) => {
      const { project, assets, store } = await buildSampleProject(opts);
      await ensureFontsLoaded(project.texts.map((t) => ({ fontId: t.fontId, text: t.value })));
      const res = new WebFrameResources(project, assets, (id) => store.getBlob(id), 'mediabunny');
      await res.load();
      const canvas = document.createElement('canvas');
      canvas.width = LIMITS.canvas.width;
      canvas.height = LIMITS.canvas.height;
      const ctx = canvas.getContext('2d', { alpha: false })!;
      const plan = buildRenderPlan(project, getMeasureFactory());
      const info = makeAssetInfo(assets);
      const total = frameCount(plan.durationMs);
      const frames: string[] = [];
      for (let k = fromFrame; k < Math.min(toFrame, total); k++) {
        const t = frameTimeMs(k);
        await res.prepare(t);
        renderFrame(ctx, plan, t, res, info);
        frames.push(canvas.toDataURL('image/jpeg', quality).split(',')[1]!);
      }
      res.close();
      return { frames, total, durationMs: plan.durationMs };
    },
    renderStillSample: async (opts: HarnessExportOptions, tMs: number) => {
      const { project, assets, store } = await buildSampleProject(opts);
      const blob = await renderStill(project, assets, (id) => store.getBlob(id), tMs);
      return { base64: await blobToBase64(blob), size: blob.size };
    },
  };
  (window as unknown as { __cinemix: typeof api }).__cinemix = api;
}
