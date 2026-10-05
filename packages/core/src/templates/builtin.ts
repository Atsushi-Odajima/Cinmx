import type { Template, BaseLayoutId, Slot } from '../schema/template';
import { LIMITS } from '../schema/limits';

/**
 * 初期テンプレート3種。自作。CapCut 等の素材・名称・動画は流用しない。
 * ID は固定 UUID（同梱テンプレートの識別に使う）。
 */
export const BUILTIN_TEMPLATE_IDS = {
  quietCut: '0b6f1d2e-5a3c-4c8e-9d1f-1a2b3c4d5e01',
  postcard: '0b6f1d2e-5a3c-4c8e-9d1f-1a2b3c4d5e02',
  contactStrip: '0b6f1d2e-5a3c-4c8e-9d1f-1a2b3c4d5e03',
} as const;

const SLOT_ID_BASE = '7c9e6a1f-0000-4000-8000-0000000000';

/** 固定の slot id（同梱テンプレート用、決定論的） */
export function builtinSlotId(templateIndex: number, slotIndex: number): string {
  return `${SLOT_ID_BASE}${templateIndex}${slotIndex}`;
}

export type BaseLayout = {
  id: BaseLayoutId;
  label: string;
  description: string;
  rect: Slot['rect'];
  motionPreset: Slot['motionPreset'];
  entryPreset: Slot['entryPreset'];
  exitPreset: Slot['exitPreset'];
  frameStyle: Template['frameStyle'];
  defaultBackground: string;
};

/** 制作画面で選べる既定レイアウト。素材枠形状・演出セットはここに固定。 */
export const BASE_LAYOUTS: readonly BaseLayout[] = [
  {
    id: 'quiet-cut',
    label: 'Quiet Cut',
    description: '全面の写真が 1.00→1.05 倍でゆっくりズーム。前後は背景へフェード。',
    rect: { x: 0, y: 0, w: 1, h: 1 },
    motionPreset: 'zoomSlow',
    entryPreset: 'fadeIn',
    exitPreset: 'fadeOut',
    frameStyle: 'none',
    defaultBackground: '#25382E',
  },
  {
    id: 'postcard',
    label: 'Postcard',
    description: '背景の上に固定の長方形フレーム。最初 0.25 秒で下から入り、最後 0.25 秒で消える。',
    rect: { x: 0.08, y: 0.16, w: 0.84, h: 0.64 },
    motionPreset: 'none',
    entryPreset: 'slideUpSmall',
    exitPreset: 'fadeOut',
    frameStyle: 'postcard',
    defaultBackground: '#59665D',
  },
  {
    id: 'contact-strip',
    label: 'Contact Strip',
    description: '罫線と小さな番号。素材は最初 0.25 秒で右から入る。派手な動きなし。',
    rect: { x: 0.08, y: 0.12, w: 0.84, h: 0.7 },
    motionPreset: 'none',
    entryPreset: 'slideFromRight',
    exitPreset: 'none',
    frameStyle: 'contactStrip',
    defaultBackground: '#F3F0E7',
  },
];

export function getBaseLayout(id: BaseLayoutId): BaseLayout {
  const b = BASE_LAYOUTS.find((x) => x.id === id);
  if (!b) throw new Error(`unknown base layout ${id}`);
  return b;
}

export function makeSlots(base: BaseLayout, durationsMs: number[], idFor: (i: number) => string): Slot[] {
  return durationsMs.map((durationMs, index) => ({
    id: idFor(index),
    index,
    durationMs,
    rect: base.rect,
    motionPreset: base.motionPreset,
    entryPreset: base.entryPreset,
    exitPreset: base.exitPreset,
  }));
}

function builtin(templateIndex: number, id: string, base: BaseLayoutId, name: string, description: string, styleLabel: string, background: string): Template {
  const b = getBaseLayout(base);
  const durations = Array.from({ length: LIMITS.defaultSlotCount }, () => LIMITS.defaultSlotDurationMs);
  return {
    id,
    version: 1,
    name,
    description,
    baseLayoutId: base,
    aspectRatio: '9:16',
    canvasBackground: background,
    backgroundTransform: { centerX: 0.5, centerY: 0.5, scale: 1 },
    slots: makeSlots(b, durations, (i) => builtinSlotId(templateIndex, i)),
    frameStyle: b.frameStyle,
    requiredAssetCount: LIMITS.defaultSlotCount,
    styleLabel,
    author: 'CinemiX',
  };
}

export const BUILTIN_TEMPLATES: readonly Template[] = [
  builtin(1, BUILTIN_TEMPLATE_IDS.quietCut, 'quiet-cut', '01 Quiet Cut', '写真が静かにズームしながら、背景へ溶けるように切り替わります。', '静かなカット', '#25382E'),
  builtin(2, BUILTIN_TEMPLATE_IDS.postcard, 'postcard', '02 Postcard', '背景写真の上に、はがきのような固定フレーム。やわらかく入って消えます。', 'はがき', '#59665D'),
  builtin(3, BUILTIN_TEMPLATE_IDS.contactStrip, 'contact-strip', '03 Contact Strip', 'コンタクトシートのような罫線と番号。右から入る落ち着いた動き。', 'コンタクトシート', '#F3F0E7'),
];

export function getBuiltinTemplate(id: string): Template | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}

export function isBuiltinTemplate(id: string): boolean {
  return BUILTIN_TEMPLATES.some((t) => t.id === id);
}
