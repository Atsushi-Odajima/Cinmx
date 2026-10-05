import { canEncodeAudio, canEncodeVideo } from 'mediabunny';
import type { RenderCapabilities } from '@cinemix/platform';
import { LIMITS } from '@cinemix/core';

let mp3Registered = false;
/** AAC が使えない端末向けの MP3 エンコーダ（WASM、必要なときだけ読み込む） */
export async function ensureMp3Encoder(): Promise<boolean> {
  if (mp3Registered) return true;
  try {
    const mod = await import('@mediabunny/mp3-encoder');
    mod.registerMp3Encoder();
    mp3Registered = true;
    return true;
  } catch {
    return false;
  }
}

let cached: Promise<RenderCapabilities> | null = null;

/** 対応形式の名前だけで判断せず、実行時に検査する。 */
export function probeCapabilities(force = false): Promise<RenderCapabilities> {
  if (cached && !force) return cached;
  cached = (async () => {
    const notes: string[] = [];
    const secureContext = typeof isSecureContext === 'boolean' ? isSecureContext : false;
    if (!secureContext) notes.push('HTTPS ではないため、一部の機能（PWA・メディア API）が使えない可能性があります。');

    const hasVideoEncoder = typeof VideoEncoder !== 'undefined';
    const hasAudioEncoder = typeof AudioEncoder !== 'undefined';
    let avc = false;
    let vp9 = false;
    let av1 = false;
    let aac = false;
    let opus = false;
    let mp3Fallback = false;
    const vopts = { width: LIMITS.canvas.width, height: LIMITS.canvas.height, frameRate: LIMITS.canvas.fps, bitrate: LIMITS.video.bitrate };
    const aopts = { numberOfChannels: 2, sampleRate: LIMITS.audio.sampleRate, bitrate: LIMITS.audio.bitrate };
    if (hasVideoEncoder) {
      try {
        avc = await canEncodeVideo('avc', vopts);
        vp9 = await canEncodeVideo('vp9', vopts).catch(() => false);
        av1 = await canEncodeVideo('av1', vopts).catch(() => false);
      } catch (e) {
        notes.push(`H.264 エンコーダ検査でエラー: ${(e as Error).message}`);
      }
      if (!avc) notes.push('この環境の WebCodecs には H.264 (avc) エンコーダがありません。');
    } else notes.push('WebCodecs VideoEncoder がありません。');
    if (hasAudioEncoder) {
      try {
        aac = await canEncodeAudio('aac', aopts);
        opus = await canEncodeAudio('opus', aopts).catch(() => false);
      } catch (e) {
        notes.push(`AAC エンコーダ検査でエラー: ${(e as Error).message}`);
      }
    }
    if (hasVideoEncoder && !aac) {
      mp3Fallback = await ensureMp3Encoder();
      if (mp3Fallback) {
        try {
          mp3Fallback = await canEncodeAudio('mp3', { numberOfChannels: 2, sampleRate: LIMITS.audio.sampleRate, bitrate: LIMITS.audio.bitrate });
        } catch {
          mp3Fallback = false;
        }
      }
      notes.push(mp3Fallback ? 'この端末は AAC エンコードに対応していないため、音声は MP3 で MP4 に保存します。' : 'この端末は AAC / MP3 エンコードに対応していません。');
    }

    const mrAvailable = typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
    const mrMp4 = mrAvailable && MediaRecorder.isTypeSupported('video/mp4');
    const mrWebm = mrAvailable && (MediaRecorder.isTypeSupported('video/webm;codecs=vp9') || MediaRecorder.isTypeSupported('video/webm'));

    const w = globalThis as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown; OfflineAudioContext?: unknown; webkitOfflineAudioContext?: unknown };
    const webAudio = !!(w.AudioContext ?? w.webkitAudioContext);
    const offline = !!(w.OfflineAudioContext ?? w.webkitOfflineAudioContext);
    const cib = typeof createImageBitmap === 'function';
    const shareAvailable = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    let shareFiles = false;
    if (shareAvailable && typeof navigator.canShare === 'function') {
      try {
        shareFiles = navigator.canShare({ files: [new File([new Uint8Array(4)], 'probe.mp4', { type: 'video/mp4' })] });
      } catch {
        shareFiles = false;
      }
    }
    const wakeLock = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

    let recommendedPath: RenderCapabilities['recommendedPath'] = null;
    let audioSupport: RenderCapabilities['audioSupport'] = 'none';
    if (avc) {
      recommendedPath = 'webcodecs';
      audioSupport = aac ? 'aac' : mp3Fallback ? 'mp3' : 'none';
    } else if (mrMp4 || mrWebm) {
      recommendedPath = 'media-recorder';
      audioSupport = webAudio ? 'platform' : 'none';
      notes.push(
        mrMp4
          ? 'WebCodecs が使えないため、実時間録画（MediaRecorder, MP4）で書き出します。動画の長さと同じ時間がかかり、途中で画面を切り替えると止まります。'
          : 'WebCodecs が使えず、MediaRecorder は WebM のみ対応です。保存形式は WebM になります（MP4 には変換しません）。',
      );
    } else {
      notes.push('この端末では動画の書き出しができません。編集と下書き保存は使えます。');
    }

    return {
      secureContext,
      webcodecs: { videoEncoder: hasVideoEncoder, avc, vp9, av1, audioEncoder: hasAudioEncoder, aac, opus, mp3Fallback },
      mediaRecorder: { available: mrAvailable, mp4: mrMp4, webm: mrWebm },
      audio: { webAudio, offline },
      images: { createImageBitmap: cib },
      share: { available: shareAvailable, files: shareFiles },
      wakeLock,
      recommendedPath,
      audioSupport,
      notes,
      probedAt: new Date().toISOString(),
    };
  })();
  return cached;
}
