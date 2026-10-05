import type { Canvas2D, FrameResources, Drawable } from './types';
import type { RenderPlan, TextPlan } from './plan';
import { computeCoverSourceRect } from '../layout/crop';
import { computeSlotTransform } from './presets';
import { drawContactStrip, drawPostcardFrame } from './frame-style';
import { findSlotAt } from '../timeline/slots';
import { isTextVisibleAt } from '../timeline/text-time';
import { resolveVideoFrame } from '../timeline/video-binding';
import { clampTextCenter } from '../layout/text-layout';
import type { Rect } from '../schema/common';

export type AssetInfo = { kind: 'image' | 'video' | 'audio'; durationMs?: number | undefined };
export type AssetInfoLookup = (assetId: string) => AssetInfo | undefined;

/**
 * 時刻 tMs のフレームを決定論的に描画する。
 * 描画順: 背景 → 該当素材枠 → 固定フレーム・番号 → 表示時間内の利用者文字（zOrder 順）。
 * 事前に resources.prepare(tMs) を await しておくこと。
 */
export function renderFrame(ctx: Canvas2D, plan: RenderPlan, tMs: number, resources: FrameResources, assetInfo: AssetInfoLookup): void {
  const { width: W, height: H, template } = plan;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  // 1. 背景
  ctx.fillStyle = template.canvasBackground;
  ctx.fillRect(0, 0, W, H);
  if (template.backgroundAssetId) {
    const bg = resources.get(template.backgroundAssetId);
    if (bg) drawCover(ctx, bg, { x: 0, y: 0, w: 1, h: 1 }, W, H, template.backgroundTransform, 1, 1, 0, 0);
  }

  // 2. 該当素材枠
  const range = findSlotAt(plan.ranges, tMs);
  if (range) {
    const slot = template.slots.find((s) => s.id === range.slotId);
    const binding = plan.bindings.get(range.slotId);
    if (slot && binding) {
      const localMs = tMs - range.startMs;
      const tr = computeSlotTransform(slot, localMs);
      const info = assetInfo(binding.assetId);
      let alpha = tr.alpha;
      let drawable: Drawable | null = null;
      if (info?.kind === 'video') {
        const req = resolveVideoFrame(localMs, binding.sourceInMs, info.durationMs ?? 0, binding.shortVideoPolicy);
        alpha *= req.alpha;
        if (req.state !== 'gone') drawable = resources.get(binding.assetId);
      } else {
        drawable = resources.get(binding.assetId);
      }
      if (drawable && alpha > 0) {
        drawCover(ctx, drawable, slot.rect, W, H, binding.crop, alpha, tr.scale, tr.dx, tr.dy);
      }
    }
    // 3. 固定フレーム・番号
    if (slot) {
      if (template.frameStyle === 'postcard') drawPostcardFrame(ctx, slot.rect, W, H);
      else if (template.frameStyle === 'contactStrip') drawContactStrip(ctx, slot.rect, W, H, slot.index, template.slots.length, '#25382E');
    }
  }

  // 4. 文字（zOrder 順、最前面）
  for (const tp of plan.texts) {
    if (!isTextVisibleAt(tp.text, tMs)) continue;
    drawText(ctx, tp, W, H);
  }
  ctx.restore();
}

/** 素材を枠に cover で描く。枠でクリップし、scale/dx/dy は枠中心基準。 */
export function drawCover(
  ctx: Canvas2D,
  drawable: Drawable,
  rect: Rect,
  W: number,
  H: number,
  crop: { centerX: number; centerY: number; scale: number },
  alpha: number,
  extraScale: number,
  dx: number,
  dy: number,
): void {
  const x = rect.x * W;
  const y = rect.y * H;
  const w = rect.w * W;
  const h = rect.h * H;
  const src = computeCoverSourceRect(drawable.width, drawable.height, w, h, crop);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  const cx = x + w / 2 + dx * W;
  const cy = y + h / 2 + dy * H;
  ctx.translate(cx, cy);
  ctx.scale(extraScale, extraScale);
  ctx.drawImage(drawable.image, src.sx, src.sy, src.sw, src.sh, -w / 2, -h / 2, w, h);
  ctx.restore();
}

export function drawText(ctx: Canvas2D, tp: TextPlan, W: number, H: number): void {
  const { text, layout, padPx, strokePx } = tp;
  const boxW = layout.width + padPx * 2;
  const boxH = layout.height + padPx * 2;
  const c = clampTextCenter(text.centerX, text.centerY, boxW, boxH, W, H);
  const cx = c.centerX * W;
  const cy = c.centerY * H;
  const left = cx - layout.width / 2;
  const top = cy - layout.height / 2;
  ctx.save();
  ctx.globalAlpha = 1;
  if (text.background) {
    ctx.globalAlpha = text.background.opacity;
    ctx.fillStyle = text.background.color;
    ctx.fillRect(left - padPx, top - padPx, boxW, boxH);
    ctx.globalAlpha = 1;
  }
  ctx.font = tp.font;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = text.align;
  ctx.lineJoin = 'round';
  const ascent = layout.fontPx * 0.8; // 行内のベースライン位置（行送り比）
  for (let i = 0; i < layout.lines.length; i++) {
    const line = layout.lines[i]!;
    const baseY = top + i * layout.linePx + (layout.linePx - layout.fontPx) / 2 + ascent;
    const bx = text.align === 'left' ? left : text.align === 'right' ? left + layout.width : cx;
    if (text.stroke && strokePx > 0) {
      ctx.strokeStyle = text.stroke.color;
      ctx.lineWidth = strokePx * 2;
      ctx.strokeText(line.text, bx, baseY);
    }
    ctx.fillStyle = text.color;
    ctx.fillText(line.text, bx, baseY);
  }
  ctx.restore();
}
