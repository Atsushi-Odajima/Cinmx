import { unzipSync, type UnzipFileInfo } from 'fflate';
import { StorageError } from '../errors';

export type SafeUnzipOptions = {
  maxTotalBytes: number;
  maxFiles: number;
  allowedExtensions: readonly string[];
  /** 許可するファイル名（指定時はこれ以外を拒否） */
  allowedNames?: readonly string[];
  /** 個別ファイルの上限（省略時は maxTotalBytes） */
  maxFileBytes?: number;
};

export type SafeEntry = { name: string; data: Uint8Array };

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

/**
 * ZIP を安全に展開する。
 * - 展開前に各エントリの無圧縮サイズ（central directory）を検査し、合計・件数・拡張子・名前を検証（圧縮爆弾対策）
 * - パストラバーサル（.., /, \）、ディレクトリ、重複名を拒否
 * - 展開後に実サイズを再検査
 */
export function safeUnzip(bytes: Uint8Array, opts: SafeUnzipOptions): SafeEntry[] {
  if (bytes.byteLength > opts.maxTotalBytes) throw new StorageError('invalid', `ファイルが大きすぎます（上限 ${Math.round(opts.maxTotalBytes / 1024 / 1024)}MB）`);
  const infos: UnzipFileInfo[] = [];
  // 1st pass: 目録だけ（filter が false を返すので展開しない）
  try {
    unzipSync(bytes, {
      filter: (f) => {
        infos.push(f);
        return false;
      },
    });
  } catch (e) {
    throw new StorageError('invalid', 'ZIP を読み取れません', e);
  }
  if (infos.length === 0) throw new StorageError('invalid', 'ZIP が空です');
  if (infos.length >= opts.maxFiles) throw new StorageError('invalid', `ファイル数が多すぎます（${opts.maxFiles} 未満）`);
  const seen = new Set<string>();
  let total = 0;
  const maxFile = opts.maxFileBytes ?? opts.maxTotalBytes;
  for (const f of infos) {
    const name = f.name;
    if (name.endsWith('/')) throw new StorageError('invalid', `フォルダは含められません: ${name}`);
    if (name.includes('..') || name.includes('/') || name.includes('\\') || name.startsWith('.') || !NAME_RE.test(name)) {
      throw new StorageError('invalid', `不正なファイル名です: ${name}`);
    }
    if (seen.has(name.toLowerCase())) throw new StorageError('invalid', `重複したファイルがあります: ${name}`);
    seen.add(name.toLowerCase());
    const ext = extensionOf(name);
    if (!opts.allowedExtensions.includes(ext)) throw new StorageError('invalid', `許可されていない種類のファイルです: ${name}`);
    if (opts.allowedNames && !opts.allowedNames.includes(name)) throw new StorageError('invalid', `想定外のファイルです: ${name}`);
    if (!Number.isFinite(f.size) || f.size < 0 || f.size > maxFile) throw new StorageError('invalid', `展開後のサイズが大きすぎます: ${name}`);
    total += f.size;
    if (total > opts.maxTotalBytes) throw new StorageError('invalid', `展開後の合計サイズが上限を超えます（${Math.round(opts.maxTotalBytes / 1024 / 1024)}MB）`);
  }
  // 2nd pass: 展開
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.size <= maxFile });
  } catch (e) {
    throw new StorageError('invalid', 'ZIP の展開に失敗しました', e);
  }
  const entries: SafeEntry[] = [];
  let actual = 0;
  for (const [name, data] of Object.entries(files)) {
    actual += data.byteLength;
    if (actual > opts.maxTotalBytes) throw new StorageError('invalid', '展開後の合計サイズが上限を超えました');
    entries.push({ name, data });
  }
  return entries;
}

/** 先頭バイトでファイル種別を確認する（拡張子の偽装対策） */
export function sniffMime(data: Uint8Array): 'image/jpeg' | 'image/png' | 'video/mp4' | 'application/zip' | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'image/png';
  if (data.length >= 12 && data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70) return 'video/mp4';
  if (data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && (data[2] === 3 || data[2] === 5)) return 'application/zip';
  return null;
}

export function utf8Decode(data: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(data);
}
export function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
