/**
 * 描画面の最小インターフェース。CanvasRenderingContext2D / OffscreenCanvasRenderingContext2D が満たす。
 * テストではモックで置き換える。
 */
export interface Canvas2D {
  canvas: { width: number; height: number };
  save(): void;
  restore(): void;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  clip(): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  drawImage(image: DrawableImage, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  lineJoin: CanvasLineJoin;
  setLineDash(segments: number[]): void;
}

/** 描画できる画像（ImageBitmap / HTMLImageElement / HTMLVideoElement / Canvas など）。 */
export type DrawableImage = CanvasImageSource;

export type Drawable = { image: DrawableImage; width: number; height: number };

/**
 * フレーム描画に必要な素材を供給する。prepare(tMs) で該当時刻の動画フレームを揃え、
 * その後 get(assetId) は同期で返す。これにより renderFrame は決定論的・同期で動く。
 */
export interface FrameResources {
  prepare(tMs: number): Promise<void>;
  get(assetId: string): Drawable | null;
}
