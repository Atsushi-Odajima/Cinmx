/**
 * 補間関数は linear と easeInOutCubic に限定する（共通仕様）。
 *  linear(p) = p
 *  easeInOutCubic(p) = p < 0.5 ? 4p^3 : 1 - (-2p + 2)^3 / 2
 * 入力 p は [0,1] にクランプする。
 */
export type EasingId = 'linear' | 'easeInOutCubic';

export function clamp01(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

export function linear(p: number): number {
  return clamp01(p);
}

export function easeInOutCubic(p: number): number {
  const x = clamp01(p);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export const EASINGS: Record<EasingId, (p: number) => number> = { linear, easeInOutCubic };
