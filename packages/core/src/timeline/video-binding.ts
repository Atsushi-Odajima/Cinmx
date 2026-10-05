import type { ShortVideoPolicy } from '../schema/project';
import { LIMITS } from '../schema/limits';

export type VideoFrameRequest = {
  /** 参照すべき音源内の時刻（ms）。hold の場合は最終フレーム時刻。 */
  sourceMs: number;
  /** 素材の不透明度（fade ポリシーで背景へ消えるとき 1→0） */
  alpha: number;
  /** 'playing' | 'hold' | 'fading' | 'gone' */
  state: 'playing' | 'hold' | 'fading' | 'gone';
};

/**
 * 枠ローカル時刻 localMs における動画の参照時刻を決める。
 * - 枠より長い動画: sourceIn から枠時間分のみ使用。
 * - 短い動画: hold=最終フレームを残す／fade=再生可能区間の最後 0.3 秒で背景へフェードし残りは背景。
 *   0.3 秒より短ければ可能区間の半分をフェード長にする。枠自体の時間は変えない。
 */
export function resolveVideoFrame(
  localMs: number,
  sourceInMs: number,
  sourceDurationMs: number,
  policy: ShortVideoPolicy,
): VideoFrameRequest {
  const available = Math.max(0, sourceDurationMs - sourceInMs);
  const lastMs = Math.max(0, sourceDurationMs - 1);
  if (available <= 0) return { sourceMs: lastMs, alpha: policy === 'hold' ? 1 : 0, state: policy === 'hold' ? 'hold' : 'gone' };
  if (localMs < available) {
    const sourceMs = sourceInMs + localMs;
    if (policy === 'fade') {
      const fadeLen = available >= LIMITS.video.shortVideoFadeMs ? LIMITS.video.shortVideoFadeMs : available / 2;
      const fadeStart = available - fadeLen;
      if (localMs >= fadeStart) {
        const p = (localMs - fadeStart) / fadeLen;
        return { sourceMs, alpha: 1 - Math.min(1, Math.max(0, p)), state: 'fading' };
      }
    }
    return { sourceMs, alpha: 1, state: 'playing' };
  }
  if (policy === 'hold') return { sourceMs: lastMs, alpha: 1, state: 'hold' };
  return { sourceMs: lastMs, alpha: 0, state: 'gone' };
}
