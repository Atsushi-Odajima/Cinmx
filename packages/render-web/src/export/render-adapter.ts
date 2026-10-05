import type { Asset, Project } from '@cinemix/core';
import { ExportError, type ExportOptions, type ExportProgress, type ExportResult, type RenderAdapter, type RenderCapabilities } from '@cinemix/platform';
import { probeCapabilities, ensureMp3Encoder } from '../capabilities';
import { prepareExport } from './common';
import { exportWithWebCodecs } from './webcodecs-exporter';
import { exportWithMediaRecorder } from './media-recorder-exporter';
import type { BlobLoader } from '../resources';

export class WebRenderAdapter implements RenderAdapter {
  constructor(private readonly loadBlob: BlobLoader) {}

  capabilities(): Promise<RenderCapabilities> {
    return probeCapabilities();
  }

  async export(project: Project, assets: ReadonlyMap<string, Asset>, onProgress: (p: ExportProgress) => void, signal: AbortSignal, options: ExportOptions = {}): Promise<ExportResult> {
    const caps = await probeCapabilities();
    const path = options.forcePath ?? (options.forceVideoCodec ? 'webcodecs' : caps.recommendedPath);
    if (!path) throw new ExportError('unsupported', caps.notes.join(' ') || 'この端末では動画の書き出しができません');
    const wantsAudio = !options.withoutAudio && !!project.audio;
    if (path === 'webcodecs') {
      const videoCodec = options.forceVideoCodec ?? 'avc';
      if (videoCodec === 'avc' && !caps.webcodecs.avc) throw new ExportError('unsupported', 'この端末の WebCodecs は H.264 に対応していません。');
      let audioCodec: 'aac' | 'mp3' | 'opus' | null = !wantsAudio ? null : (options.forceAudioCodec ?? (caps.webcodecs.aac ? 'aac' : caps.webcodecs.mp3Fallback ? 'mp3' : null));
      if (wantsAudio && !audioCodec) {
        throw new ExportError('unsupported', 'この端末では音声付きの保存ができません。「音声なしで保存」を選ぶか、別の端末でお試しください。');
      }
      if (audioCodec === 'mp3') {
        if (!(await ensureMp3Encoder())) audioCodec = null;
        if (!audioCodec) throw new ExportError('unsupported', 'MP3 エンコーダを読み込めませんでした。');
      }
      const prepared = await prepareExport(project, assets, this.loadBlob, onProgress, signal, wantsAudio, 'mediabunny');
      return exportWithWebCodecs(prepared, onProgress, signal, { videoCodec, audioCodec });
    }
    const prepared = await prepareExport(project, assets, this.loadBlob, onProgress, signal, wantsAudio, 'html-video');
    return exportWithMediaRecorder(prepared, onProgress, signal);
  }
}
