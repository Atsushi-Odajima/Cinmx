import type { Asset, Project, FrameResources, Drawable } from '@cinemix/core';
import { computeSlotRanges, findSlotAt, resolveVideoFrame } from '@cinemix/core';
import { openVideoProvider, type VideoFrameProvider } from './video-provider';

export type BlobLoader = (assetId: string) => Promise<Blob | undefined>;

const IMAGE_MAX_EDGE = 2160;

export async function decodeImage(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      // 回転メタデータを適用し、大きすぎる画像は縮小してデコード
      const probe = await createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions);
      const long = Math.max(probe.width, probe.height);
      if (long <= IMAGE_MAX_EDGE) return probe;
      const scale = IMAGE_MAX_EDGE / long;
      const resized = await createImageBitmap(blob, {
        imageOrientation: 'from-image',
        resizeWidth: Math.round(probe.width * scale),
        resizeHeight: Math.round(probe.height * scale),
        resizeQuality: 'high',
      } as ImageBitmapOptions);
      probe.close();
      return resized;
    } catch {
      /* fall back to <img> */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * 画像ビットマップと動画フレーム供給をまとめる。prepare(t) で該当時刻の動画フレームを揃える。
 * 使用後は close() で VideoFrame / bitmap / Blob URL を解放する。
 */
export class WebFrameResources implements FrameResources {
  private images = new Map<string, Drawable>();
  private videos = new Map<string, VideoFrameProvider>();
  private ranges: ReturnType<typeof computeSlotRanges>;
  private closed = false;
  readonly warnings: string[] = [];

  constructor(
    private readonly project: Project,
    private readonly assets: ReadonlyMap<string, Asset>,
    private readonly loadBlob: BlobLoader,
    private readonly videoPreference: 'mediabunny' | 'html-video' = 'mediabunny',
  ) {
    this.ranges = computeSlotRanges(project.templateSnapshot);
  }

  /** 使用中の素材を全てデコードする（画像は一度だけ） */
  async load(onProgress?: (done: number, total: number) => void): Promise<void> {
    const ids = new Set<string>();
    for (const b of this.project.slotBindings) ids.add(b.assetId);
    if (this.project.templateSnapshot.backgroundAssetId) ids.add(this.project.templateSnapshot.backgroundAssetId);
    let done = 0;
    for (const id of ids) {
      const meta = this.assets.get(id);
      const blob = await this.loadBlob(id);
      if (!meta || !blob) {
        this.warnings.push(`素材 ${id.slice(0, 8)} が見つかりません`);
        continue;
      }
      if (meta.kind === 'image') {
        const img = await decodeImage(blob);
        this.images.set(id, { image: img, width: img.width, height: img.height });
      } else if (meta.kind === 'video') {
        const provider = await openVideoProvider(blob, this.videoPreference);
        if (!provider) this.warnings.push(`動画 ${meta.label ?? id.slice(0, 8)} をデコードできません`);
        else this.videos.set(id, provider);
      }
      done++;
      onProgress?.(done, ids.size);
    }
  }

  async prepare(tMs: number): Promise<void> {
    const range = findSlotAt(this.ranges, tMs);
    if (!range) return;
    const binding = this.project.slotBindings.find((b) => b.slotId === range.slotId);
    if (!binding) return;
    const provider = this.videos.get(binding.assetId);
    if (!provider) return;
    const meta = this.assets.get(binding.assetId);
    const req = resolveVideoFrame(tMs - range.startMs, binding.sourceInMs, meta?.durationMs ?? 0, binding.shortVideoPolicy);
    if (req.state === 'gone') return;
    await provider.seek(req.sourceMs);
  }

  get(assetId: string): Drawable | null {
    const img = this.images.get(assetId);
    if (img) return img;
    const v = this.videos.get(assetId);
    return v ? v.current() : null;
  }

  hasVideo(): boolean {
    return this.videos.size > 0;
  }

  videoProviderKinds(): string[] {
    return [...this.videos.values()].map((v) => v.kind);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const d of this.images.values()) {
      const img = d.image as ImageBitmap;
      if (typeof (img as ImageBitmap).close === 'function') (img as ImageBitmap).close();
    }
    this.images.clear();
    for (const v of this.videos.values()) v.close();
    this.videos.clear();
  }
}
