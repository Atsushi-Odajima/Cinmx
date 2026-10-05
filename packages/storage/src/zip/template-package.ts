import { zipSync } from 'fflate';
import type { Template } from '@cinemix/core';
import { templateSchema, LIMITS } from '@cinemix/core';
import { StorageError } from '../errors';
import { safeUnzip, sniffMime, utf8Decode, utf8Encode } from './safe-unzip';

export const TEMPLATE_PACKAGE_EXTENSION = '.cinemix-template.zip';
const REQUIRED = ['template.json', 'cover.png', 'licenses.txt'] as const;
const OPTIONAL = ['background.jpg', 'preview.mp4'] as const;
const ALLOWED_NAMES = [...REQUIRED, ...OPTIONAL];

export type TemplatePackageInput = {
  template: Template;
  /** 再エンコード済み（EXIF/GPS 除去済み）の JPEG。呼び出し側が保証する。 */
  backgroundJpeg?: Blob;
  coverPng: Blob;
  previewMp4?: Blob;
  licensesText: string;
};

export type TemplatePackageContents = {
  template: Template; // backgroundAssetId は含まれない
  hasBackground: boolean;
  background?: Uint8Array;
  cover: Uint8Array;
  preview?: Uint8Array;
  licensesText: string;
};

/**
 * 公開パッケージを作る。含めるのはテンプレート JSON＋背景写真＋中立サンプルによる表紙／見本だけ。
 * 利用者の素材・文字・BGM は構造上含められない（引数に存在しない）。
 */
export async function buildTemplatePackage(input: TemplatePackageInput): Promise<Blob> {
  const parsed = templateSchema.safeParse(input.template);
  if (!parsed.success) throw new StorageError('invalid', `テンプレートが不正です: ${parsed.error.issues[0]?.message ?? ''}`);
  const t = { ...parsed.data };
  delete t.backgroundAssetId; // 端末内 id は出さない。background.jpg の有無で判断する
  const files: Record<string, Uint8Array> = {
    'template.json': utf8Encode(JSON.stringify(t, null, 2)),
    'cover.png': new Uint8Array(await input.coverPng.arrayBuffer()),
    'licenses.txt': utf8Encode(input.licensesText),
  };
  if (input.backgroundJpeg) {
    const bg = new Uint8Array(await input.backgroundJpeg.arrayBuffer());
    if (sniffMime(bg) !== 'image/jpeg') throw new StorageError('invalid', '背景は JPEG で再エンコードしてから含めてください');
    files['background.jpg'] = bg;
  }
  if (input.previewMp4) files['preview.mp4'] = new Uint8Array(await input.previewMp4.arrayBuffer());
  if (sniffMime(files['cover.png']!) !== 'image/png') throw new StorageError('invalid', '表紙は PNG である必要があります');
  const zipped = zipSync(files, { level: 6 });
  if (zipped.byteLength > LIMITS.templatePackage.maxTotalBytes) throw new StorageError('invalid', 'パッケージが 25MB を超えています');
  return new Blob([zipped], { type: 'application/zip' });
}

export function readTemplatePackage(bytes: Uint8Array): TemplatePackageContents {
  const entries = safeUnzip(bytes, {
    maxTotalBytes: LIMITS.templatePackage.maxTotalBytes,
    maxFiles: LIMITS.templatePackage.maxFiles,
    allowedExtensions: LIMITS.templatePackage.allowedExtensions,
    allowedNames: ALLOWED_NAMES,
  });
  const map = new Map(entries.map((e) => [e.name, e.data]));
  for (const name of REQUIRED) if (!map.has(name)) throw new StorageError('invalid', `${name} がありません`);
  let json: unknown;
  try {
    json = JSON.parse(utf8Decode(map.get('template.json')!));
  } catch (e) {
    throw new StorageError('invalid', 'template.json を読めません', e);
  }
  const parsed = templateSchema.safeParse(json);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw new StorageError('invalid', `テンプレートが不正です: ${i?.path.join('.') ?? ''} ${i?.message ?? ''}`);
  }
  const template = { ...parsed.data };
  delete template.backgroundAssetId; // パッケージ内の id は信用しない
  const cover = map.get('cover.png')!;
  if (sniffMime(cover) !== 'image/png') throw new StorageError('invalid', 'cover.png が PNG ではありません');
  const background = map.get('background.jpg');
  if (background && sniffMime(background) !== 'image/jpeg') throw new StorageError('invalid', 'background.jpg が JPEG ではありません');
  const preview = map.get('preview.mp4');
  if (preview && sniffMime(preview) !== 'video/mp4') throw new StorageError('invalid', 'preview.mp4 が MP4 ではありません');
  return {
    template,
    hasBackground: !!background,
    ...(background ? { background } : {}),
    cover,
    ...(preview ? { preview } : {}),
    licensesText: utf8Decode(map.get('licenses.txt')!),
  };
}
