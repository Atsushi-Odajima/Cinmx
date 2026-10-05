import { z } from 'zod';
import { LIMITS, SCHEMA_VERSION } from './limits';
import { cropSchema, finiteNumber, hexColor, intMs, isoDateTime, ratio01, uuid } from './common';
import { templateSchema } from './template';

export const shortVideoPolicySchema = z.enum(['hold', 'fade']);
export type ShortVideoPolicy = z.infer<typeof shortVideoPolicySchema>;

export const slotBindingSchema = z.object({
  slotId: uuid,
  assetId: uuid,
  sourceInMs: intMs,
  crop: cropSchema,
  shortVideoPolicy: shortVideoPolicySchema,
});
export type SlotBinding = z.infer<typeof slotBindingSchema>;

export const fontIdSchema = z.enum(['noto-sans-jp', 'noto-serif-jp', 'caveat', 'allura']);
export type FontId = z.infer<typeof fontIdSchema>;

export const textAlignSchema = z.enum(['left', 'center', 'right']);
export type TextAlign = z.infer<typeof textAlignSchema>;

export const textBackgroundSchema = z.object({ color: hexColor, opacity: ratio01, paddingRatio: finiteNumber.min(0).max(0.1) });
export const textStrokeSchema = z.object({ color: hexColor, widthRatio: finiteNumber.min(0).max(0.02) });

export const textItemSchema = z
  .object({
    id: uuid,
    value: z
      .string()
      .max(LIMITS.text.maxChars)
      .refine((v) => v.split('\n').length <= LIMITS.text.maxLines, { message: `改行は ${LIMITS.text.maxLines - 1} 回までです` }),
    fontId: fontIdSchema,
    color: hexColor,
    fontSizeRatio: finiteNumber.min(LIMITS.text.fontSizeRatio.min).max(LIMITS.text.fontSizeRatio.max),
    lineHeight: finiteNumber.min(LIMITS.text.lineHeight.min).max(LIMITS.text.lineHeight.max),
    align: textAlignSchema,
    centerX: ratio01,
    centerY: ratio01,
    startMs: intMs,
    endMs: intMs,
    zOrder: finiteNumber.int().min(0),
    background: textBackgroundSchema.optional(),
    stroke: textStrokeSchema.optional(),
  })
  .refine((t) => t.startMs < t.endMs, { message: '開始は終了より前である必要があります', path: ['endMs'] });
export type TextItem = z.infer<typeof textItemSchema>;

export const audioSettingsSchema = z
  .object({
    assetId: uuid,
    sourceInMs: intMs,
    sourceOutMs: intMs,
    volume: finiteNumber.min(LIMITS.audio.volume.min).max(LIMITS.audio.volume.max),
    /** 0 でフェードなし。ON 時は LIMITS.audio.fadeOutMs */
    fadeOutMs: intMs.max(LIMITS.audio.fadeOutMs),
  })
  .refine((a) => a.sourceInMs < a.sourceOutMs, { message: '開始位置は終了位置より前である必要があります', path: ['sourceOutMs'] });
export type AudioSettings = z.infer<typeof audioSettingsSchema>;

export const projectSchema = z.object({
  id: uuid,
  schemaVersion: z.literal(SCHEMA_VERSION),
  title: z.string().max(80),
  templateSnapshot: templateSchema,
  slotBindings: z.array(slotBindingSchema),
  texts: z.array(textItemSchema).max(LIMITS.text.maxCount),
  audio: audioSettingsSchema.optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Project = z.infer<typeof projectSchema>;
