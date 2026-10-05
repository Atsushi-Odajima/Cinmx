import type { Asset, AssetKind, Project, Template } from '@cinemix/core';

/* ------------------------------------------------------------------ */
/* MediaAdapter: 素材の取り込み・検査・読み出し・解放                        */
/* ------------------------------------------------------------------ */

export type ProbeOk = {
  ok: true;
  kind: AssetKind;
  mime: string;
  width?: number;
  height?: number;
  durationMs?: number;
  /** 回転メタデータを適用した表示サイズか */
  rotationApplied?: boolean;
  codec?: string;
  notes: string[];
};
export type ProbeFail = { ok: false; kind: AssetKind | 'unknown'; code: ProbeFailCode; message: string; hint: string };
export type ProbeFailCode = 'too-large' | 'too-many-pixels' | 'too-long' | 'undecodable' | 'unsupported-type' | 'resolution' | 'total-exceeded' | 'io';
export type ProbeResult = ProbeOk | ProbeFail;

export type ImportItemResult = { fileName: string; result: ProbeResult; asset?: Asset };

export interface MediaAdapter {
  /** ファイルを検査して端末内ストレージへ保存する。失敗したファイルは理由付きで返し、保存済みデータは壊さない。 */
  import(files: File[], expectedKinds: AssetKind[]): Promise<ImportItemResult[]>;
  probe(file: Blob, expectedKinds: AssetKind[]): Promise<ProbeResult>;
  read(assetId: string): Promise<Blob | undefined>;
  release(assetId: string): void;
}

/* ------------------------------------------------------------------ */
/* RenderAdapter: 能力検査と書き出し                                       */
/* ------------------------------------------------------------------ */

export type ExportPath = 'webcodecs' | 'media-recorder';

export type RenderCapabilities = {
  secureContext: boolean;
  webcodecs: { videoEncoder: boolean; avc: boolean; vp9: boolean; av1: boolean; audioEncoder: boolean; aac: boolean; opus: boolean; mp3Fallback: boolean };
  mediaRecorder: { available: boolean; mp4: boolean; webm: boolean };
  audio: { webAudio: boolean; offline: boolean };
  images: { createImageBitmap: boolean };
  share: { available: boolean; files: boolean };
  wakeLock: boolean;
  /** 推奨経路。null は動画保存不可（編集と下書きのみ） */
  recommendedPath: ExportPath | null;
  /** 推奨経路での音声の扱い */
  audioSupport: 'aac' | 'mp3' | 'platform' | 'none';
  notes: string[];
  probedAt: string;
};

export type ExportProgress = {
  phase: 'preparing' | 'fonts' | 'audio' | 'video' | 'muxing' | 'done';
  /** 実処理フレーム数に基づく 0..1 */
  ratio: number;
  framesDone: number;
  framesTotal: number;
  message: string;
};

export type ExportOptions = {
  /** 音声なしで保存（利用者が明示的に選ぶ） */
  withoutAudio?: boolean;
  /** 書き出し経路の強制（診断用） */
  forcePath?: ExportPath;
  /**
   * 診断・自動テスト専用。利用者向け UI からは渡さない。
   * MP4 の利用者向け出力は H.264 (avc) のみ。VP9/AV1 を MP4 に入れた場合 iPhone の写真アプリでは再生できない。
   */
  forceVideoCodec?: 'avc' | 'vp9' | 'av1';
  forceAudioCodec?: 'aac' | 'mp3' | 'opus';
};

export type ExportResult = {
  blob: Blob;
  mime: string;
  extension: 'mp4' | 'webm';
  width: number;
  height: number;
  durationMs: number;
  hasAudio: boolean;
  audioCodec: 'aac' | 'mp3' | 'opus' | 'platform' | null;
  path: ExportPath;
  elapsedMs: number;
};

export class ExportError extends Error {
  constructor(
    public readonly code: 'unsupported' | 'cancelled' | 'interrupted' | 'font' | 'audio' | 'asset' | 'encoder' | 'mux' | 'unknown',
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ExportError';
  }
}

export interface RenderAdapter {
  capabilities(): Promise<RenderCapabilities>;
  export(project: Project, assets: ReadonlyMap<string, Asset>, onProgress: (p: ExportProgress) => void, signal: AbortSignal, options?: ExportOptions): Promise<ExportResult>;
}

/* ------------------------------------------------------------------ */
/* ShareAdapter                                                        */
/* ------------------------------------------------------------------ */

export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported' | 'failed';

export interface ShareAdapter {
  canShare(file: File): boolean;
  /** 必ずユーザー操作から呼ぶこと。キャンセルは失敗ではない。 */
  shareFile(file: File, title?: string): Promise<ShareOutcome>;
  download(blob: Blob, filename: string): void;
}

/* ------------------------------------------------------------------ */
/* TemplateRepository                                                  */
/* ------------------------------------------------------------------ */

export type TemplateVisibility = 'private' | 'public';
export type ModerationStatus = 'pending' | 'approved' | 'rejected';

export type TemplateListItem = {
  id: string;
  name: string;
  description: string;
  requiredAssetCount: number;
  durationMs: number;
  styleLabel?: string;
  aspectRatio: '9:16';
  source: 'builtin' | 'local' | 'imported' | 'online';
  coverUrl?: string;
  previewUrl?: string;
  cloud?: { visibility: TemplateVisibility; moderationStatus: ModerationStatus; version: number };
};

export type PublishInput = { template: Template; backgroundJpeg?: Blob; coverPng: Blob; previewMp4?: Blob; licensesText: string; visibility: TemplateVisibility };
export type PublishResult = { remoteId: string; version: number; visibility: TemplateVisibility; moderationStatus: ModerationStatus };

export interface TemplateRepository {
  list(): Promise<TemplateListItem[]>;
  get(id: string): Promise<Template | undefined>;
  saveLocal(template: Template, extras?: { backgroundAssetId?: string; coverBlob?: Blob; previewBlob?: Blob }): Promise<void>;
  /** オンライン未接続なら 'not-connected' を返す（公開を偽装しない） */
  publish(input: PublishInput): Promise<PublishResult | { status: 'not-connected' } | { status: 'auth-required' }>;
  setVisibility(remoteId: string, visibility: TemplateVisibility): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* AdService / PurchaseService（今回は NoOp）                            */
/* ------------------------------------------------------------------ */

export type AdPlacement = 'banner-top' | 'export-wait' | 'daily-third-interstitial';
export type AdShowResult = 'shown' | 'skipped' | 'failed' | 'disabled';

export interface AdService {
  readonly mode: 'noop' | 'dev-simulated';
  prepare(placement: AdPlacement): Promise<void>;
  /** 失敗しても動画作成を止めない */
  show(placement: AdPlacement, context: { jobId?: string }): Promise<AdShowResult>;
  close(placement: AdPlacement): void;
  onFailure(cb: (placement: AdPlacement, reason: string) => void): void;
}

export interface PurchaseService {
  readonly mode: 'noop';
  /** 広告解除の権限。今回は常に false（課金していない） */
  hasAdFree(): Promise<boolean>;
  /** 今回は購入できない。UI は説明のみ。 */
  purchaseAdFree(): Promise<{ status: 'not-available'; message: string }>;
}
