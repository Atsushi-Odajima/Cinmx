import type { Canvas2D } from './types';
import type { Rect } from '../schema/common';

export const FRAME_COLORS = {
  paper: '#FFFCF4',
  line: '#C8CDC2',
  ink: '#25382E',
} as const;

/** Postcard: 素材枠の外側に紙色の固定フレーム（線 1px 相当） */
export function drawPostcardFrame(ctx: Canvas2D, rect: Rect, W: number, H: number): void {
  const pad = Math.round(W * 0.025);
  const x = rect.x * W;
  const y = rect.y * H;
  const w = rect.w * W;
  const h = rect.h * H;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = FRAME_COLORS.paper;
  // 枠の外周（紙）を4辺で塗る → 素材の上に重ならない中央は空ける
  ctx.fillRect(x - pad, y - pad, w + pad * 2, pad);
  ctx.fillRect(x - pad, y + h, w + pad * 2, pad);
  ctx.fillRect(x - pad, y, pad, h);
  ctx.fillRect(x + w, y, pad, h);
  ctx.strokeStyle = FRAME_COLORS.line;
  ctx.lineWidth = Math.max(1, W / 720);
  ctx.strokeRect(x - pad + 0.5, y - pad + 0.5, w + pad * 2 - 1, h + pad * 2 - 1);
  ctx.restore();
}

/** Contact Strip: 細い罫線と枠外の小さな番号 (01..) */
export function drawContactStrip(ctx: Canvas2D, rect: Rect, W: number, H: number, index: number, total: number, ink: string): void {
  const x = rect.x * W;
  const y = rect.y * H;
  const w = rect.w * W;
  const h = rect.h * H;
  const lineW = Math.max(1, W / 720);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = ink;
  ctx.lineWidth = lineW;
  ctx.setLineDash([]);
  ctx.beginPath();
  // 上下の罫線（枠の少し外）
  const gap = Math.round(H * 0.02);
  ctx.moveTo(x, y - gap);
  ctx.lineTo(x + w, y - gap);
  ctx.moveTo(x, y + h + gap);
  ctx.lineTo(x + w, y + h + gap);
  ctx.stroke();
  // 枠線
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  // 番号（枠外・左上）
  const px = Math.round(W * 0.028);
  ctx.font = `500 ${px}px "Noto Sans JP", system-ui, sans-serif`;
  ctx.fillStyle = ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const label = String(index + 1).padStart(2, '0');
  ctx.fillText(label, x, y - gap - Math.round(px * 0.5));
  ctx.textAlign = 'right';
  ctx.fillText(`${String(total).padStart(2, '0')}`, x + w, y + h + gap + px + Math.round(px * 0.4));
  ctx.restore();
}
