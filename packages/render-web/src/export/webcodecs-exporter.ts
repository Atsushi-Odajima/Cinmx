import { Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource } from 'mediabunny';
import { renderFrame, frameCount, frameTimeMs, frameDurationSec, LIMITS } from '@cinemix/core';
import { ExportError, type ExportProgress, type ExportResult } from '@cinemix/platform';
import type { PreparedExport } from './common';
import { createExportCanvas, InterruptionWatch, acquireWakeLock } from './common';

export type WebCodecsOptions = { videoCodec: 'avc' | 'vp9' | 'av1'; audioCodec: 'aac' | 'mp3' | 'opus' | null };

/**
 * WebCodecs + Mediabunny による H.264/AAC MP4 の実エンコード。
 * - フレーム k の時刻は k*1000/30 ms、フレーム数は ceil(D*30/1000)
 * - CanvasSource.add はエンコーダのキューが空くまで待つ（バックプレッシャー）
 * - 全フレームをメモリに持たず、1 枚ずつ描画→エンコード
 */
export async function exportWithWebCodecs(prepared: PreparedExport, onProgress: (p: ExportProgress) => void, signal: AbortSignal, opts: WebCodecsOptions): Promise<ExportResult> {
  const started = performance.now();
  const { plan, resources, assetInfo, durationMs } = prepared;
  const W = LIMITS.canvas.width;
  const H = LIMITS.canvas.height;
  const fps = LIMITS.canvas.fps;
  const framesTotal = frameCount(durationMs, fps);
  const { canvas, ctx } = createExportCanvas(W, H);
  const watch = new InterruptionWatch();
  watch.start();
  const wake = await acquireWakeLock();

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const videoSource = new CanvasSource(canvas, { codec: opts.videoCodec, bitrate: LIMITS.video.bitrate, latencyMode: 'quality' });
  output.addVideoTrack(videoSource, { frameRate: fps });
  const useAudio = !!prepared.audioBuffer && !!opts.audioCodec;
  const audioSource = useAudio ? new AudioBufferSource({ codec: opts.audioCodec!, bitrate: LIMITS.audio.bitrate }) : null;
  if (audioSource) output.addAudioTrack(audioSource);

  const cancel = async (code: 'cancelled' | 'interrupted', message: string) => {
    try {
      await output.cancel();
    } catch {
      /* ignore */
    }
    throw new ExportError(code, message);
  };

  try {
    try {
      await output.start();
    } catch (e) {
      throw new ExportError('encoder', `エンコーダを開始できません: ${(e as Error).message}`, e);
    }
    onProgress({ phase: 'video', ratio: 0, framesDone: 0, framesTotal, message: '映像を書き出しています' });
    for (let k = 0; k < framesTotal; k++) {
      if (signal.aborted) await cancel('cancelled', '書き出しをキャンセルしました');
      if (watch.wasInterrupted()) await cancel('interrupted', '画面が切り替わったため書き出しを中断しました。この画面を開いたまま、もう一度お試しください。');
      const t = frameTimeMs(k, fps);
      await resources.prepare(t);
      renderFrame(ctx, plan, t, resources, assetInfo);
      try {
        await videoSource.add(k / fps, frameDurationSec(k, durationMs, fps));
      } catch (e) {
        throw new ExportError('encoder', `映像のエンコードに失敗しました (frame ${k}): ${(e as Error).message}`, e);
      }
      if (k % 5 === 0 || k === framesTotal - 1) {
        onProgress({ phase: 'video', ratio: (k + 1) / framesTotal, framesDone: k + 1, framesTotal, message: `映像を書き出しています ${k + 1}/${framesTotal}` });
      }
    }
    videoSource.close();
    if (audioSource && prepared.audioBuffer) {
      onProgress({ phase: 'muxing', ratio: 1, framesDone: framesTotal, framesTotal, message: '音声を書き出しています' });
      try {
        await audioSource.add(prepared.audioBuffer);
      } catch (e) {
        throw new ExportError('encoder', `音声のエンコードに失敗しました: ${(e as Error).message}`, e);
      }
      audioSource.close();
    }
    onProgress({ phase: 'muxing', ratio: 1, framesDone: framesTotal, framesTotal, message: 'ファイルをまとめています' });
    try {
      await output.finalize();
    } catch (e) {
      throw new ExportError('mux', `MP4 の作成に失敗しました: ${(e as Error).message}`, e);
    }
    const buffer = output.target.buffer;
    if (!buffer || buffer.byteLength < 1000) throw new ExportError('mux', 'MP4 が空です');
    const blob = new Blob([buffer], { type: 'video/mp4' });
    onProgress({ phase: 'done', ratio: 1, framesDone: framesTotal, framesTotal, message: '完了' });
    return {
      blob,
      mime: 'video/mp4',
      extension: 'mp4',
      width: W,
      height: H,
      durationMs,
      hasAudio: useAudio,
      audioCodec: useAudio ? opts.audioCodec : null,
      path: 'webcodecs',
      elapsedMs: Math.round(performance.now() - started),
    };
  } catch (e) {
    if (output.state === 'started') {
      try {
        await output.cancel();
      } catch {
        /* ignore */
      }
    }
    if (e instanceof ExportError) throw e;
    throw new ExportError('unknown', (e as Error)?.message ?? String(e), e);
  } finally {
    watch.stop();
    await wake?.release().catch(() => {});
    resources.close();
    canvas.width = 1;
    canvas.height = 1;
  }
}
