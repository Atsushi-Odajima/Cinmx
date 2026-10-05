import { z } from 'zod';

/** NaN / Infinity を拒否する数値。 */
export const finiteNumber = z.number().refine((v) => Number.isFinite(v), { message: '有限の数値が必要です' });
export const ratio01 = finiteNumber.min(0).max(1);
export const intMs = finiteNumber.int().min(0);
export const uuid = z.uuid();
export const isoDateTime = z.iso.datetime();
export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, { message: '#RRGGBB 形式の色が必要です' });

export const rectSchema = z
  .object({ x: ratio01, y: ratio01, w: ratio01, h: ratio01 })
  .refine((r) => r.x + r.w <= 1 + 1e-9 && r.y + r.h <= 1 + 1e-9, { message: '枠がキャンバスからはみ出しています' });
export type Rect = z.infer<typeof rectSchema>;

export const cropSchema = z.object({
  centerX: ratio01,
  centerY: ratio01,
  scale: finiteNumber.min(1).max(3),
});
export type Crop = z.infer<typeof cropSchema>;

export const aspectRatioSchema = z.enum(['9:16']);
export type AspectRatio = z.infer<typeof aspectRatioSchema>;
