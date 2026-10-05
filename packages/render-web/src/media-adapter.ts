import { Input, BlobSource, ALL_FORMATS } from 'mediabunny';
import type { Asset, AssetKind } from '@cinemix/core';
import { LIMITS } from '@cinemix/core';
import type { AssetStore } from '@cinemix/storage';
import type { ImportItemResult, MediaAdapter, ProbeResult } from '@cinemix/platform';
import { decodeAudioBlob } from './audio';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif', 'image/bmp']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm', 'video/3gpp']);
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg', 'audio/flac', 'audio/x-flac']);

function guessKind(file: Blob & { name?: string }): AssetKind | 'unknown' {
  const t = (file.type || '').toLowerCase();
  if (IMAGE_TYPES.has(t) || t.startsWith('image/')) return 'image';
  if (VIDEO_TYPES.has(t) || t.startsWith('video/')) return 'video';
  if (AUDIO_TYPES.has(t) || t.startsWith('audio/')) return 'audio';
  const name = (file.name ?? '').toLowerCase();
  if (/\.(jpe?g|png|webp|gif|heic|heif|avif)$/.test(name)) return 'image';
  if (/\.(mp4|mov|m4v|webm|3gp)$/.test(name)) return 'video';
  if (/\.(mp3|m4a|aac|wav|ogg|flac)$/.test(name)) return 'audio';
  return 'unknown';
}

const mb = (n: number) => `${Math.round(n / 1024 / 1024)}MB`;

async function probeImage(file: Blob): Promise<ProbeResult> {
  if (file.size > LIMITS.media.imageMaxBytes) {
    return { ok: false, kind: 'image', code: 'too-large', message: `画像が大きすぎます（${mb(file.size)}）`, hint: `${mb(LIMITS.media.imageMaxBytes)} 以下の JPEG/PNG にしてください` };
  }
  try {
    let width = 0;
    let height = 0;
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
      width = bmp.width;
      height = bmp.height;
      bmp.close();
    } else {
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        width = img.naturalWidth;
        height = img.naturalHeight;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    if (width * height > LIMITS.media.imageMaxPixels) {
      return { ok: false, kind: 'image', code: 'too-many-pixels', message: `画像の画素数が多すぎます（${width}×${height}）`, hint: '36MP 以下に縮小してください' };
    }
    if (width < 2 || height < 2) return { ok: false, kind: 'image', code: 'undecodable', message: '画像を読み取れません', hint: 'JPEG または PNG に変換してください' };
    return { ok: true, kind: 'image', mime: file.type || 'image/jpeg', width, height, rotationApplied: true, notes: [] };
  } catch {
    return { ok: false, kind: 'image', code: 'undecodable', message: 'この画像形式はこの端末でデコードできません（HEIC など）', hint: 'JPEG または PNG に変更してください' };
  }
}

async function probeVideo(file: Blob): Promise<ProbeResult> {
  if (file.size > LIMITS.media.videoMaxBytes) {
    return { ok: false, kind: 'video', code: 'too-large', message: `動画が大きすぎます（${mb(file.size)}）`, hint: `${mb(LIMITS.media.videoMaxBytes)} 以下・30 秒以下・1080p 程度にしてください` };
  }
  const notes: string[] = [];
  // 1) Mediabunny で実際に読み取り・デコード可否を検査
  let input: Input | null = null;
  try {
    input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (track) {
      const durationMs = Math.round((await input.computeDuration()) * 1000);
      const width = await track.getDisplayWidth();
      const height = await track.getDisplayHeight();
      const codec = (await track.getCodec()) ?? 'unknown';
      const decodable = await track.canDecode();
      const hdr = await track.hasHighDynamicRange().catch(() => false);
      input.dispose();
      input = null;
      if (durationMs > LIMITS.media.videoMaxDurationMs) {
        return { ok: false, kind: 'video', code: 'too-long', message: `動画が長すぎます（${(durationMs / 1000).toFixed(1)} 秒）`, hint: '30 秒以下に切り出してください' };
      }
      if (Math.max(width, height) > LIMITS.media.videoMaxLongEdge) {
        return { ok: false, kind: 'video', code: 'resolution', message: `解像度が大きすぎます（${width}×${height}）`, hint: '1080p 程度（長辺 2200px 以下）に縮小してください' };
      }
      if (hdr) notes.push('HDR 動画は SDR に変換されて見えます。色が変わる場合は SDR で書き出してください。');
      if (!decodable) {
        const viaHtml = await probeVideoViaElement(file);
        if (!viaHtml.ok) {
          return { ok: false, kind: 'video', code: 'undecodable', message: `この動画のコーデック（${codec}）はこの端末でデコードできません`, hint: 'SDR の H.264 (MP4) に変換してください' };
        }
        notes.push('この動画は再生要素によるデコードを使います（処理が遅くなることがあります）。');
      }
      return { ok: true, kind: 'video', mime: file.type || 'video/mp4', width, height, durationMs, codec, rotationApplied: true, notes };
    }
    input.dispose();
    input = null;
  } catch {
    input?.dispose();
    input = null;
  }
  // 2) 読み取れない形式は <video> で最終確認
  const viaHtml = await probeVideoViaElement(file);
  if (!viaHtml.ok) return { ok: false, kind: 'video', code: 'undecodable', message: 'この動画はこの端末で再生できません', hint: 'SDR の H.264 (MP4) に変換してください' };
  if (viaHtml.durationMs > LIMITS.media.videoMaxDurationMs) return { ok: false, kind: 'video', code: 'too-long', message: '動画が長すぎます', hint: '30 秒以下に切り出してください' };
  return { ok: true, kind: 'video', mime: file.type || 'video/mp4', width: viaHtml.width, height: viaHtml.height, durationMs: viaHtml.durationMs, rotationApplied: true, notes: ['コンテナ情報を読めないため、再生要素の情報を使います。'] };
}

function probeVideoViaElement(file: Blob): Promise<{ ok: true; width: number; height: number; durationMs: number } | { ok: false }> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve({ ok: false });
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'metadata';
    const done = (r: { ok: true; width: number; height: number; durationMs: number } | { ok: false }) => {
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);
      resolve(r);
    };
    const t = setTimeout(() => done({ ok: false }), 15000);
    v.addEventListener('loadedmetadata', () => {
      clearTimeout(t);
      if (!Number.isFinite(v.duration) || v.videoWidth === 0) return done({ ok: false });
      done({ ok: true, width: v.videoWidth, height: v.videoHeight, durationMs: Math.round(v.duration * 1000) });
    });
    v.addEventListener('error', () => (clearTimeout(t), done({ ok: false })));
    v.src = url;
  });
}

async function probeAudio(file: Blob): Promise<ProbeResult> {
  if (file.size > LIMITS.media.audioMaxBytes) {
    return { ok: false, kind: 'audio', code: 'too-large', message: `音源が大きすぎます（${mb(file.size)}）`, hint: `${mb(LIMITS.media.audioMaxBytes)} 以下の MP3/M4A/WAV にしてください` };
  }
  try {
    const buf = await decodeAudioBlob(file);
    return { ok: true, kind: 'audio', mime: file.type || 'audio/mpeg', durationMs: Math.round(buf.duration * 1000), notes: [] };
  } catch {
    return { ok: false, kind: 'audio', code: 'undecodable', message: 'この音源はこの端末でデコードできません', hint: 'MP3、M4A（AAC）、WAV に変換してください' };
  }
}

export class WebMediaAdapter implements MediaAdapter {
  constructor(private readonly assets: AssetStore) {}

  async probe(file: Blob, expectedKinds: AssetKind[]): Promise<ProbeResult> {
    const kind = guessKind(file);
    if (kind === 'unknown' || !expectedKinds.includes(kind)) {
      return { ok: false, kind: kind === 'unknown' ? 'unknown' : kind, code: 'unsupported-type', message: 'このファイルの種類は使えません', hint: expectedKinds.includes('audio') ? 'MP3 / M4A / WAV を選んでください' : '写真（JPEG/PNG）または動画（MP4/MOV）を選んでください' };
    }
    if (kind === 'image') return probeImage(file);
    if (kind === 'video') return probeVideo(file);
    return probeAudio(file);
  }

  async import(files: File[], expectedKinds: AssetKind[]): Promise<ImportItemResult[]> {
    const results: ImportItemResult[] = [];
    let total = await this.assets.totalBytes();
    for (const file of files) {
      const result = await this.probe(file, expectedKinds);
      if (!result.ok) {
        results.push({ fileName: file.name, result });
        continue;
      }
      if (total + file.size > LIMITS.media.totalMaxBytes) {
        results.push({ fileName: file.name, result: { ok: false, kind: result.kind, code: 'total-exceeded', message: '素材の合計が 150MB を超えます', hint: '不要な素材や下書きを削除してから追加してください' } });
        continue;
      }
      try {
        const asset: Asset = await this.assets.put(file, {
          kind: result.kind,
          mime: result.mime,
          label: file.name,
          ...(result.width !== undefined ? { width: result.width } : {}),
          ...(result.height !== undefined ? { height: result.height } : {}),
          ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
        });
        total += file.size;
        results.push({ fileName: file.name, result, asset });
      } catch (e) {
        results.push({ fileName: file.name, result: { ok: false, kind: result.kind, code: 'io', message: (e as Error).message, hint: '容量を空けてから再試行してください' } });
      }
    }
    return results;
  }

  async read(assetId: string): Promise<Blob | undefined> {
    return this.assets.getBlob(assetId);
  }

  release(): void {
    /* Blob URL はこのアダプタでは発行しない（各 provider が自身で revoke する） */
  }
}
