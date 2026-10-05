/**
 * 試作の上限値。仕様 1 章「今回の実装上限」に対応する。後で変更可能な初期値。
 * すべて整数ミリ秒／ピクセル／バイト単位。
 */
export const LIMITS = {
  canvas: { width: 720, height: 1280, fps: 30 },
  aspectRatio: '9:16' as const,
  maxDurationMs: 30_000,
  minSlotDurationMs: 1_000,
  maxSlotDurationMs: 8_000,
  slotDurationStepMs: 100,
  minSlots: 3,
  maxSlots: 10,
  defaultSlotDurationMs: 3_000,
  defaultSlotCount: 5,

  text: {
    maxCount: 10,
    maxChars: 100,
    maxLines: 4,
    fontSizeRatio: { min: 0.02, max: 0.15, default: 0.055 },
    lineHeight: { min: 1.0, max: 2.0, default: 1.3 },
    maxWidthRatio: 0.9,
    timeStepMs: 100,
  },

  crop: { scale: { min: 1, max: 3, default: 1 } },

  audio: {
    volume: { min: 0, max: 1, default: 0.7 },
    fadeOutMs: 1_000,
    sampleRate: 48_000,
    bitrate: 128_000,
  },

  video: {
    bitrate: 3_000_000,
    /** 短い動画のフェード長（ms） */
    shortVideoFadeMs: 300,
  },

  media: {
    imageMaxBytes: 20 * 1024 * 1024,
    imageMaxPixels: 36_000_000,
    videoMaxBytes: 50 * 1024 * 1024,
    videoMaxDurationMs: 30_000,
    videoMaxLongEdge: 2_200, // 1080p 程度の目安（1920 + 余裕）
    totalMaxBytes: 150 * 1024 * 1024,
    audioMaxBytes: 30 * 1024 * 1024,
  },

  templatePackage: {
    maxTotalBytes: 25 * 1024 * 1024,
    maxFiles: 100,
    nameMaxChars: 40,
    descriptionMaxChars: 200,
    allowedExtensions: ['json', 'jpg', 'jpeg', 'png', 'mp4', 'txt'] as const,
  },
  projectPackage: {
    maxTotalBytes: 150 * 1024 * 1024,
    maxFiles: 200,
  },

  history: { maxEntries: 30 },
  autosaveDebounceMs: 500,
} as const;

export const SCHEMA_VERSION = 1 as const;
