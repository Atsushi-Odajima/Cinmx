import type { TextItem } from '../schema/project';

/** 表示区間は半開区間 [startMs, endMs)。 */
export function isTextVisibleAt(text: Pick<TextItem, 'startMs' | 'endMs'>, tMs: number): boolean {
  return tMs >= text.startMs && tMs < text.endMs;
}

/** 0 <= start < end <= D を満たすように補正した区間を返す。 */
export function normalizeTextRange(startMs: number, endMs: number, totalMs: number, stepMs = 100): { startMs: number; endMs: number } {
  let s = Math.round(Math.max(0, Math.min(startMs, totalMs)) / stepMs) * stepMs;
  let e = Math.round(Math.max(0, Math.min(endMs, totalMs)) / stepMs) * stepMs;
  if (e <= s) e = Math.min(totalMs, s + stepMs);
  if (e <= s) s = Math.max(0, e - stepMs);
  return { startMs: s, endMs: e };
}
