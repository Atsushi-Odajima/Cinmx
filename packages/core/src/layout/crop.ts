import type { Crop } from '../schema/common';

export type SourceRect = { sx: number; sy: number; sw: number; sh: number };

/**
 * cover + 焦点 + 倍率から、元画像のどの矩形を宛先 (dstW x dstH) に描くかを求める。
 * scale=1 で cover（宛先を満たす最小領域）。scale>1 で拡大。焦点 (centerX, centerY) は元画像比率。
 * 元画像の外に空白が出ないように中心をクランプする。元ファイルは変更しない。
 */
export function computeCoverSourceRect(srcW: number, srcH: number, dstW: number, dstH: number, crop: Crop): SourceRect {
  const coverScale = Math.max(dstW / srcW, dstH / srcH);
  const scale = coverScale * Math.max(1, crop.scale);
  const sw = dstW / scale;
  const sh = dstH / scale;
  const halfW = sw / 2;
  const halfH = sh / 2;
  const cx = Math.min(Math.max(crop.centerX * srcW, halfW), srcW - halfW);
  const cy = Math.min(Math.max(crop.centerY * srcH, halfH), srcH - halfH);
  return { sx: cx - halfW, sy: cy - halfH, sw, sh };
}

/** 焦点を有効範囲に収める（ドラッグ時に使う） */
export function clampCropCenter(srcW: number, srcH: number, dstW: number, dstH: number, crop: Crop): Crop {
  const coverScale = Math.max(dstW / srcW, dstH / srcH);
  const scale = coverScale * Math.max(1, crop.scale);
  const sw = dstW / scale;
  const sh = dstH / scale;
  const minX = sw / 2 / srcW;
  const minY = sh / 2 / srcH;
  return {
    centerX: Math.min(Math.max(crop.centerX, minX), 1 - minX),
    centerY: Math.min(Math.max(crop.centerY, minY), 1 - minY),
    scale: Math.min(3, Math.max(1, crop.scale)),
  };
}
