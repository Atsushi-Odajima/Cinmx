import type { Asset, Project } from '@cinemix/core';
import { buildRenderPlan, renderFrame, LIMITS } from '@cinemix/core';
import { getMeasureFactory } from './measure';
import { WebFrameResources, type BlobLoader, decodeImage } from './resources';
import { makeAssetInfo } from './export/common';
import { ensureFontsLoaded } from './fonts';

/** 任意時刻の静止画（PNG）。表紙・サムネイル用。同じ描画エンジンを使う。 */
export async function renderStill(project: Project, assets: ReadonlyMap<string, Asset>, loadBlob: BlobLoader, tMs: number, opts: { width?: number; type?: 'image/png' | 'image/jpeg'; quality?: number } = {}): Promise<Blob> {
  await ensureFontsLoaded(project.texts.map((t) => ({ fontId: t.fontId, text: t.value })));
  const res = new WebFrameResources(project, assets, loadBlob, 'mediabunny');
  try {
    await res.load();
    const W = LIMITS.canvas.width;
    const H = LIMITS.canvas.height;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D を初期化できません');
    const plan = buildRenderPlan(project, getMeasureFactory());
    await res.prepare(tMs);
    renderFrame(ctx, plan, tMs, res, makeAssetInfo(assets));
    let out = canvas;
    if (opts.width && opts.width < W) {
      out = document.createElement('canvas');
      out.width = opts.width;
      out.height = Math.round((opts.width * H) / W);
      out.getContext('2d')!.drawImage(canvas, 0, 0, out.width, out.height);
    }
    return await canvasToBlob(out, opts.type ?? 'image/png', opts.quality);
  } finally {
    res.close();
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を書き出せません'))), type, quality);
  });
}

/**
 * 背景写真を公開用に再エンコードする（EXIF/GPS を除去、長辺を制限）。元ファイルは変更しない。
 */
export async function reencodeJpeg(blob: Blob, maxLongEdge = 1600, quality = 0.88): Promise<{ blob: Blob; width: number; height: number }> {
  const img = await decodeImage(blob);
  const long = Math.max(img.width, img.height);
  const scale = Math.min(1, maxLongEdge / long);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D を初期化できません');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  if (typeof (img as ImageBitmap).close === 'function') (img as ImageBitmap).close();
  const out = await canvasToBlob(canvas, 'image/jpeg', quality);
  return { blob: out, width: canvas.width, height: canvas.height };
}
