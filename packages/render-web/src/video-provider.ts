import { Input, BlobSource, ALL_FORMATS, CanvasSink, type InputVideoTrack, type WrappedCanvas } from 'mediabunny';
import type { Drawable } from '@cinemix/core';

export interface VideoFrameProvider {
  readonly kind: 'mediabunny' | 'html-video';
  seek(sourceMs: number): Promise<void>;
  current(): Drawable | null;
  close(): void;
}

const MAX_LONG_EDGE = 1920;

/** WebCodecs (Mediabunny) による順次デコード。回転メタデータは CanvasSink が適用する。 */
export class MediabunnyFrameProvider implements VideoFrameProvider {
  readonly kind = 'mediabunny' as const;
  private iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
  private frame: WrappedCanvas | null = null;
  private next: WrappedCanvas | null = null;
  private width = 0;
  private height = 0;

  private constructor(
    private readonly input: Input,
    private readonly sink: CanvasSink,
    private readonly durationSec: number,
  ) {}

  static async open(blob: Blob): Promise<MediabunnyFrameProvider | null> {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    let track: InputVideoTrack | null;
    try {
      track = await input.getPrimaryVideoTrack();
    } catch {
      input.dispose();
      return null;
    }
    if (!track || !(await track.canDecode())) {
      input.dispose();
      return null;
    }
    const dw = await track.getDisplayWidth();
    const dh = await track.getDisplayHeight();
    const scale = Math.min(1, MAX_LONG_EDGE / Math.max(dw, dh));
    const sink = new CanvasSink(track, { poolSize: 3, fit: 'contain', width: Math.max(2, Math.round(dw * scale)), height: Math.max(2, Math.round(dh * scale)) });
    const duration = await track.computeDuration();
    const p = new MediabunnyFrameProvider(input, sink, duration);
    p.width = Math.round(dw * scale);
    p.height = Math.round(dh * scale);
    return p;
  }

  async seek(sourceMs: number): Promise<void> {
    const target = Math.max(0, Math.min(sourceMs / 1000, Math.max(0, this.durationSec - 0.001)));
    // 現在のフレームが target を含めばそのまま
    if (this.frame && target >= this.frame.timestamp && target < this.frame.timestamp + Math.max(this.frame.duration, 0.0005)) return;
    const needRestart = !this.iterator || !this.frame || target < this.frame.timestamp || target > this.frame.timestamp + 1.0;
    if (needRestart) {
      await this.iterator?.return();
      this.iterator = this.sink.canvases(target);
      this.frame = null;
      this.next = null;
    }
    // 順に進めて target を含むフレームまで
    for (let guard = 0; guard < 600; guard++) {
      const candidate = this.next ?? (await this.iterator!.next()).value ?? null;
      this.next = null;
      if (!candidate) {
        // 末尾: 最後のフレームを保持
        return;
      }
      if (candidate.timestamp + Math.max(candidate.duration, 0.0005) > target || candidate.timestamp >= target) {
        if (candidate.timestamp > target && this.frame) {
          // target は前フレームの範囲内（duration が不正確な場合）。次用に保持。
          this.next = candidate;
          return;
        }
        this.frame = candidate;
        return;
      }
      this.frame = candidate;
    }
  }

  current(): Drawable | null {
    if (!this.frame) return null;
    const c = this.frame.canvas;
    return { image: c as unknown as CanvasImageSource, width: this.width || c.width, height: this.height || c.height };
  }

  close(): void {
    void this.iterator?.return();
    this.iterator = null;
    this.frame = null;
    this.input.dispose();
  }
}

/** HTMLVideoElement のシークによる代替。WebCodecs デコードが使えない端末向け。 */
export class HtmlVideoFrameProvider implements VideoFrameProvider {
  readonly kind = 'html-video' as const;
  private readonly video: HTMLVideoElement;
  private readonly url: string;
  private ready = false;
  private lastSeekMs = -1;

  private constructor(blob: Blob) {
    this.url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = this.url;
    this.video = v;
  }

  static async open(blob: Blob): Promise<HtmlVideoFrameProvider | null> {
    const p = new HtmlVideoFrameProvider(blob);
    const ok = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 15000);
      p.video.addEventListener('loadeddata', () => (clearTimeout(t), resolve(true)), { once: true });
      p.video.addEventListener('error', () => (clearTimeout(t), resolve(false)), { once: true });
      p.video.load();
    });
    if (!ok || p.video.videoWidth === 0) {
      p.close();
      return null;
    }
    p.ready = true;
    return p;
  }

  async seek(sourceMs: number): Promise<void> {
    if (!this.ready) return;
    const sec = Math.max(0, Math.min(sourceMs / 1000, Math.max(0, this.video.duration - 0.001)));
    if (Math.abs(this.lastSeekMs - sourceMs) < 1) return;
    this.lastSeekMs = sourceMs;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 2000);
      const done = () => {
        clearTimeout(t);
        // Safari ではフレームの描画準備を待つため rVFC/rAF を一拍挟む
        const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
        if (typeof v.requestVideoFrameCallback === 'function') {
          const t2 = setTimeout(resolve, 200);
          v.requestVideoFrameCallback(() => (clearTimeout(t2), resolve()));
        } else requestAnimationFrame(() => resolve());
      };
      this.video.addEventListener('seeked', done, { once: true });
      this.video.currentTime = sec;
    });
  }

  current(): Drawable | null {
    if (!this.ready) return null;
    return { image: this.video, width: this.video.videoWidth, height: this.video.videoHeight };
  }

  close(): void {
    this.video.removeAttribute('src');
    this.video.load();
    URL.revokeObjectURL(this.url);
    this.ready = false;
  }
}

export async function openVideoProvider(blob: Blob, prefer: 'mediabunny' | 'html-video' = 'mediabunny'): Promise<VideoFrameProvider | null> {
  if (prefer === 'mediabunny' && typeof VideoDecoder !== 'undefined') {
    try {
      const mb = await MediabunnyFrameProvider.open(blob);
      if (mb) return mb;
    } catch {
      /* fall through */
    }
  }
  return HtmlVideoFrameProvider.open(blob);
}
