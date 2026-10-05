import { renderFrame, frameCount, frameTimeMs, LIMITS } from '@cinemix/core';
import { ExportError, type ExportProgress, type ExportResult } from '@cinemix/platform';
import type { PreparedExport } from './common';
import { createExportCanvas, InterruptionWatch, acquireWakeLock } from './common';
import { getAudioContext } from '../audio';

/**
 * WebCodecs が使えない端末向けの代替: Canvas.captureStream + Web Audio を MediaRecorder で実時間録画する。
 * - 出力時間は動画の長さと同じ（実時間）
 * - 形式は実際に対応している mimeType（MP4 または WebM）。WebM を MP4 と偽装しない
 * - 画面を切り替えると停止するため、失敗として再試行へ
 */
export async function exportWithMediaRecorder(prepared: PreparedExport, onProgress: (p: ExportProgress) => void, signal: AbortSignal): Promise<ExportResult> {
  const started = performance.now();
  const { plan, resources, assetInfo, durationMs } = prepared;
  const W = LIMITS.canvas.width;
  const H = LIMITS.canvas.height;
  const fps = LIMITS.canvas.fps;
  const framesTotal = frameCount(durationMs, fps);
  if (typeof MediaRecorder === 'undefined') throw new ExportError('unsupported', 'MediaRecorder がありません');
  const mime = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : null;
  if (!mime) throw new ExportError('unsupported', 'MediaRecorder が MP4 / WebM に対応していません');
  const extension: 'mp4' | 'webm' = mime.startsWith('video/mp4') ? 'mp4' : 'webm';

  const { canvas, ctx } = createExportCanvas(W, H);
  const watch = new InterruptionWatch();
  watch.start();
  const wake = await acquireWakeLock();

  const stream = canvas.captureStream(fps);
  let audioCtx: AudioContext | null = null;
  let audioNode: AudioBufferSourceNode | null = null;
  if (prepared.audioBuffer) {
    try {
      audioCtx = getAudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      audioNode = audioCtx.createBufferSource();
      audioNode.buffer = prepared.audioBuffer;
      audioNode.connect(dest);
      for (const tr of dest.stream.getAudioTracks()) stream.addTrack(tr);
    } catch (e) {
      throw new ExportError('audio', `音声の準備に失敗しました: ${(e as Error).message}`, e);
    }
  }
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: LIMITS.video.bitrate, audioBitsPerSecond: LIMITS.audio.bitrate });
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = (e) => reject(new ExportError('encoder', `録画エラー: ${String((e as unknown as { error?: Error }).error?.message ?? e)}`));
  });
  const videoTrack = stream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;

  try {
    // 最初のフレームを描いてから開始
    await resources.prepare(0);
    renderFrame(ctx, plan, 0, resources, assetInfo);
    onProgress({ phase: 'video', ratio: 0, framesDone: 0, framesTotal, message: `実時間で録画しています（約 ${Math.ceil(durationMs / 1000)} 秒）` });
    recorder.start(250);
    const t0 = performance.now();
    if (audioCtx && audioNode) {
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      audioNode.start();
    }
    let lastK = -1;
    while (true) {
      const elapsed = performance.now() - t0;
      if (elapsed >= durationMs) break;
      if (signal.aborted) throw new ExportError('cancelled', '書き出しをキャンセルしました');
      if (watch.wasInterrupted()) throw new ExportError('interrupted', '画面が切り替わったため録画を中断しました。この画面を開いたまま、もう一度お試しください。');
      const k = Math.min(framesTotal - 1, Math.floor((elapsed * fps) / 1000));
      if (k !== lastK) {
        const t = frameTimeMs(k, fps);
        await resources.prepare(t);
        renderFrame(ctx, plan, t, resources, assetInfo);
        videoTrack?.requestFrame?.();
        lastK = k;
        if (k % 5 === 0) onProgress({ phase: 'video', ratio: (k + 1) / framesTotal, framesDone: k + 1, framesTotal, message: `録画中 ${Math.round(elapsed / 1000)} / ${Math.ceil(durationMs / 1000)} 秒` });
      }
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }
    recorder.stop();
    await stopped;
    const baseMime = mime.split(';')[0] ?? mime;
    const blob = new Blob(chunks, { type: baseMime });
    if (blob.size < 1000) throw new ExportError('encoder', '録画データが空です');
    onProgress({ phase: 'done', ratio: 1, framesDone: framesTotal, framesTotal, message: '完了' });
    return {
      blob,
      mime: baseMime,
      extension,
      width: W,
      height: H,
      durationMs,
      hasAudio: !!prepared.audioBuffer,
      audioCodec: prepared.audioBuffer ? 'platform' : null,
      path: 'media-recorder',
      elapsedMs: Math.round(performance.now() - started),
    };
  } catch (e) {
    if (recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
    }
    if (e instanceof ExportError) throw e;
    throw new ExportError('unknown', (e as Error)?.message ?? String(e), e);
  } finally {
    try {
      audioNode?.stop();
    } catch {
      /* ignore */
    }
    void audioCtx?.close().catch(() => {});
    for (const tr of stream.getTracks()) tr.stop();
    watch.stop();
    await wake?.release().catch(() => {});
    resources.close();
  }
}
