import { z } from 'zod';
import { LIMITS } from './limits';
import { cropSchema, hexColor, intMs, rectSchema, uuid, aspectRatioSchema, finiteNumber } from './common';

/** 演出は列挙値のみ。任意コード・シェーダーは受け付けない。 */
export const motionPresetSchema = z.enum(['none', 'zoomSlow']);
export const entryPresetSchema = z.enum(['none', 'fadeIn', 'slideUpSmall', 'slideFromRight']);
export const exitPresetSchema = z.enum(['none', 'fadeOut']);
export const frameStyleSchema = z.enum(['none', 'postcard', 'contactStrip']);
export const baseLayoutIdSchema = z.enum(['quiet-cut', 'postcard', 'contact-strip']);

export type MotionPreset = z.infer<typeof motionPresetSchema>;
export type EntryPreset = z.infer<typeof entryPresetSchema>;
export type ExitPreset = z.infer<typeof exitPresetSchema>;
export type FrameStyle = z.infer<typeof frameStyleSchema>;
export type BaseLayoutId = z.infer<typeof baseLayoutIdSchema>;

export const slotSchema = z.object({
  id: uuid,
  index: finiteNumber.int().min(0),
  durationMs: intMs
    .min(LIMITS.minSlotDurationMs)
    .max(LIMITS.maxSlotDurationMs)
    .refine((v) => v % LIMITS.slotDurationStepMs === 0, { message: '0.1秒刻みで指定してください' }),
  rect: rectSchema,
  motionPreset: motionPresetSchema,
  entryPreset: entryPresetSchema,
  exitPreset: exitPresetSchema,
});
export type Slot = z.infer<typeof slotSchema>;

export const templateSchema = z
  .object({
    id: uuid,
    version: finiteNumber.int().min(1),
    name: z.string().min(1).max(LIMITS.templatePackage.nameMaxChars),
    description: z.string().max(LIMITS.templatePackage.descriptionMaxChars),
    /** どの既定レイアウトから派生したか（制作画面での固定部分を決める） */
    baseLayoutId: baseLayoutIdSchema,
    aspectRatio: aspectRatioSchema,
    canvasBackground: hexColor,
    backgroundAssetId: uuid.optional(),
    backgroundTransform: cropSchema,
    slots: z.array(slotSchema).min(LIMITS.minSlots).max(LIMITS.maxSlots),
    frameStyle: frameStyleSchema,
    requiredAssetCount: finiteNumber.int().min(LIMITS.minSlots).max(LIMITS.maxSlots),
    /** 表示用のスタイル名（例: "静かなカット"） */
    styleLabel: z.string().max(40).optional(),
    /** 作者表記（公開用）。私的情報は入れない。 */
    author: z.string().max(60).optional(),
  })
  .superRefine((t, ctx) => {
    if (t.slots.length !== t.requiredAssetCount) {
      ctx.addIssue({ code: 'custom', message: '枠数と必要素材数が一致しません', path: ['requiredAssetCount'] });
    }
    const total = t.slots.reduce((a, s) => a + s.durationMs, 0);
    if (total > LIMITS.maxDurationMs) {
      ctx.addIssue({ code: 'custom', message: `総時間が ${LIMITS.maxDurationMs / 1000} 秒を超えています`, path: ['slots'] });
    }
    const indices = t.slots.map((s) => s.index).sort((a, b) => a - b);
    if (indices.some((v, i) => v !== i)) {
      ctx.addIssue({ code: 'custom', message: '枠の index は 0 から連番である必要があります', path: ['slots'] });
    }
    const ids = new Set(t.slots.map((s) => s.id));
    if (ids.size !== t.slots.length) {
      ctx.addIssue({ code: 'custom', message: '枠 id が重複しています', path: ['slots'] });
    }
  });
export type Template = z.infer<typeof templateSchema>;
