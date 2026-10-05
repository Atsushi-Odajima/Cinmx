import type { Slot } from '../schema/template';
import { easeInOutCubic, linear } from '../timeline/easing';
import { fadeLengthMs } from '../timeline/slots';

export type SlotTransform = {
  /** 素材の不透明度 0..1 */
  alpha: number;
  /** 中心基準のスケール（1.00→1.05 など） */
  scale: number;
  /** キャンバス比率での平行移動 */
  dx: number;
  dy: number;
};

/** 移動距離はキャンバス比率で記述する。12px 相当 = 12/1280。 */
export const ENTRY_DISTANCE = {
  slideUpSmall: { dx: 0, dy: 12 / 1280 },
  slideFromRight: { dx: 0.06, dy: 0 },
} as const;

/** 入退場の長さ（ms）。仕様: 最初 0.25 秒／最後 0.25 秒。枠が短い場合は duration/4。 */
export function entryExitMs(durationMs: number): number {
  return fadeLengthMs(durationMs);
}

/**
 * 枠ローカル時刻 localMs（0 <= localMs < durationMs）での素材の変換を決定論的に計算する。
 * 乱数・実時刻に依存しない。
 */
export function computeSlotTransform(slot: Pick<Slot, 'durationMs' | 'motionPreset' | 'entryPreset' | 'exitPreset'>, localMs: number): SlotTransform {
  const d = slot.durationMs;
  const t = Math.max(0, Math.min(localMs, d));
  const io = entryExitMs(d);
  let alpha = 1;
  let scale = 1;
  let dx = 0;
  let dy = 0;

  if (slot.motionPreset === 'zoomSlow') {
    scale = 1 + 0.05 * linear(t / d);
  }

  if (io > 0 && t < io) {
    const p = easeInOutCubic(t / io);
    switch (slot.entryPreset) {
      case 'fadeIn':
        alpha = Math.min(alpha, p);
        break;
      case 'slideUpSmall':
        alpha = Math.min(alpha, p);
        dy = ENTRY_DISTANCE.slideUpSmall.dy * (1 - p);
        break;
      case 'slideFromRight':
        alpha = Math.min(alpha, p);
        dx = ENTRY_DISTANCE.slideFromRight.dx * (1 - p);
        break;
      case 'none':
        break;
    }
  }
  if (io > 0 && t >= d - io && slot.exitPreset === 'fadeOut') {
    const p = easeInOutCubic((t - (d - io)) / io);
    alpha = Math.min(alpha, 1 - p);
  }
  return { alpha, scale, dx, dy };
}
