import type { AudioSettings } from '@cinemix/core';
import { computeAudioPlan, LIMITS } from '@cinemix/core';

type AudioCtxCtor = typeof AudioContext;
function getAudioContextCtor(): AudioCtxCtor | null {
  const w = globalThis as unknown as { AudioContext?: AudioCtxCtor; webkitAudioContext?: AudioCtxCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}
function getOfflineCtor(): typeof OfflineAudioContext | null {
  const w = globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext };
  return w.OfflineAudioContext ?? w.webkitOfflineAudioContext ?? null;
}

/** 実デコードで判定する。失敗は例外。 */
export async function decodeAudioBlob(blob: Blob): Promise<AudioBuffer> {
  const Ctor = getAudioContextCtor();
  if (!Ctor) throw new Error('Web Audio が使えません');
  const ctx = new Ctor();
  try {
    const buf = await blob.arrayBuffer();
    return await new Promise<AudioBuffer>((resolve, reject) => {
      // Safari 旧版はコールバック形式のみのため両対応
      const r = ctx.decodeAudioData(buf, resolve, reject) as unknown;
      if (r && typeof (r as Promise<AudioBuffer>).then === 'function') (r as Promise<AudioBuffer>).then(resolve, reject);
    });
  } finally {
    void ctx.close().catch(() => {});
  }
}

/**
 * 指定区間・音量・フェードを適用した 48kHz ステレオの AudioBuffer を作る。
 * 長さは動画総時間 D（音源が短ければ以降は無音）。映像と同じ 0 起点。
 */
export async function renderAudioTrack(source: AudioBuffer, audio: AudioSettings, videoDurationMs: number): Promise<AudioBuffer> {
  const Offline = getOfflineCtor();
  if (!Offline) throw new Error('OfflineAudioContext が使えません');
  const sr = LIMITS.audio.sampleRate;
  const plan = computeAudioPlan(audio, videoDurationMs);
  const length = Math.max(1, Math.ceil((videoDurationMs / 1000) * sr));
  const ctx = new Offline(2, length, sr);
  const src = ctx.createBufferSource();
  src.buffer = source;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(plan.volume, 0);
  if (plan.fade) {
    gain.gain.setValueAtTime(plan.volume, plan.fade.startMs / 1000);
    gain.gain.linearRampToValueAtTime(0, plan.fade.endMs / 1000);
  }
  src.connect(gain).connect(ctx.destination);
  const usedSec = plan.usedMs / 1000;
  if (usedSec > 0) src.start(0, plan.sourceInMs / 1000, usedSec);
  return ctx.startRendering();
}

/** プレビュー再生用: 動画時刻 fromMs から再生するノードを作る（呼び出し側が ctx を管理） */
export function scheduleAudioPreview(ctx: AudioContext, source: AudioBuffer, audio: AudioSettings, videoDurationMs: number, fromMs: number): AudioBufferSourceNode | null {
  const plan = computeAudioPlan(audio, videoDurationMs);
  if (fromMs >= plan.endMs) return null;
  const src = ctx.createBufferSource();
  src.buffer = source;
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  const offsetInVideo = fromMs / 1000;
  gain.gain.setValueAtTime(plan.volume, now);
  if (plan.fade) {
    const fs = plan.fade.startMs / 1000 - offsetInVideo;
    const fe = plan.fade.endMs / 1000 - offsetInVideo;
    if (fe > 0) {
      if (fs > 0) {
        gain.gain.setValueAtTime(plan.volume, now + fs);
        gain.gain.linearRampToValueAtTime(0, now + fe);
      } else {
        const p = (0 - fs) / (fe - fs);
        gain.gain.setValueAtTime(plan.volume * (1 - p), now);
        gain.gain.linearRampToValueAtTime(0, now + fe);
      }
    }
  }
  src.connect(gain).connect(ctx.destination);
  const remain = (plan.endMs - fromMs) / 1000;
  src.start(now, (plan.sourceInMs + fromMs) / 1000, remain);
  return src;
}

export function getAudioContext(): AudioContext {
  const Ctor = getAudioContextCtor();
  if (!Ctor) throw new Error('Web Audio が使えません');
  return new Ctor();
}
