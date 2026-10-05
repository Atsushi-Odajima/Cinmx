import type { AudioSettings } from '../schema/project';

export type AudioPlan = {
  /** 音源内の開始（ms） */
  sourceInMs: number;
  /** 実際に使う長さ（ms）: min(sourceOut - sourceIn, D) */
  usedMs: number;
  /** 動画時刻で音が鳴る終端（ms） = usedMs（動画時刻 0 から配置） */
  endMs: number;
  /** 動画終端までの無音（ms） */
  silentTailMs: number;
  /** フェードの開始・終了（動画時刻 ms）。fade なしなら null */
  fade: { startMs: number; endMs: number } | null;
  volume: number;
};

/**
 * BGM の配置計算。選択区間 [a,b) を動画時刻 0 から再生し、動画より長ければ動画終端で切る。
 * フェードは最後の min(fadeOutMs, 使用区間長) を線形で 0 へ。終端は min(音源終了, 動画終了)。
 */
export function computeAudioPlan(audio: AudioSettings, videoDurationMs: number): AudioPlan {
  const segment = Math.max(0, audio.sourceOutMs - audio.sourceInMs);
  const usedMs = Math.max(0, Math.min(segment, videoDurationMs));
  const fadeLen = Math.min(audio.fadeOutMs, usedMs);
  const fade = audio.fadeOutMs > 0 && fadeLen > 0 ? { startMs: usedMs - fadeLen, endMs: usedMs } : null;
  return {
    sourceInMs: audio.sourceInMs,
    usedMs,
    endMs: usedMs,
    silentTailMs: Math.max(0, videoDurationMs - usedMs),
    fade,
    volume: audio.volume,
  };
}

/** 動画時刻 t における実効ゲイン（0..1）。区間外は 0。 */
export function gainAt(plan: AudioPlan, tMs: number): number {
  if (tMs < 0 || tMs >= plan.endMs) return 0;
  if (!plan.fade) return plan.volume;
  if (tMs < plan.fade.startMs) return plan.volume;
  const len = plan.fade.endMs - plan.fade.startMs;
  if (len <= 0) return 0;
  const p = (tMs - plan.fade.startMs) / len;
  return plan.volume * (1 - p);
}
