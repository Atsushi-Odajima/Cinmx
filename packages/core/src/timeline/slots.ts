import type { Template } from '../schema/template';
import { LIMITS } from '../schema/limits';

export type SlotRange = { slotId: string; index: number; startMs: number; endMs: number; durationMs: number };

/** 各枠は [startMs, endMs)。総時間 D = durationMs の合計。 */
export function computeSlotRanges(template: Pick<Template, 'slots'>): SlotRange[] {
  const sorted = [...template.slots].sort((a, b) => a.index - b.index);
  let cursor = 0;
  return sorted.map((s) => {
    const r = { slotId: s.id, index: s.index, startMs: cursor, endMs: cursor + s.durationMs, durationMs: s.durationMs };
    cursor += s.durationMs;
    return r;
  });
}

export function totalDurationMs(template: Pick<Template, 'slots'>): number {
  return template.slots.reduce((a, s) => a + s.durationMs, 0);
}

/** 時刻 t を含む枠。半開区間なので t == endMs は次の枠。t >= D は null。 */
export function findSlotAt(ranges: readonly SlotRange[], tMs: number): SlotRange | null {
  for (const r of ranges) if (tMs >= r.startMs && tMs < r.endMs) return r;
  return null;
}

/** フェード長 = min(250ms, 枠duration/4) */
export function fadeLengthMs(slotDurationMs: number): number {
  return Math.min(250, Math.floor(slotDurationMs / 4));
}

/** 出力フレーム k の時刻（ms, 実数）。 */
export function frameTimeMs(k: number, fps: number = LIMITS.canvas.fps): number {
  return (k * 1000) / fps;
}

/** フレーム数 = ceil(D * fps / 1000) */
export function frameCount(durationMs: number, fps: number = LIMITS.canvas.fps): number {
  return Math.ceil((durationMs * fps) / 1000);
}

/**
 * フレーム k の表示時間（秒）。末尾フレームは D に対して 1 フレーム以内の誤差に収まるよう調整する。
 */
export function frameDurationSec(k: number, durationMs: number, fps: number = LIMITS.canvas.fps): number {
  const n = frameCount(durationMs, fps);
  const nominal = 1 / fps;
  if (k < n - 1) return nominal;
  const start = frameTimeMs(k, fps);
  const remain = (durationMs - start) / 1000;
  return Math.max(remain, nominal / 2);
}

/** 時刻を 0.1 秒刻み・[0, D] に揃える。 */
export function snapMs(ms: number, stepMs = LIMITS.text.timeStepMs, maxMs = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isFinite(ms)) return 0;
  const v = Math.round(ms / stepMs) * stepMs;
  return Math.max(0, Math.min(maxMs, v));
}
