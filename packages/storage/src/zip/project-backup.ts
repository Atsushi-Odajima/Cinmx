import { zipSync } from 'fflate';
import type { Project, Asset } from '@cinemix/core';
import { projectSchema, assetSchema, referencedAssetIds, LIMITS } from '@cinemix/core';
import { StorageError } from '../errors';
import { safeUnzip, utf8Decode, utf8Encode, extensionOf } from './safe-unzip';

export const PROJECT_BACKUP_EXTENSION = '.cinemix-project.zip';
const ALLOWED_EXT = ['json', 'txt', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov', 'm4v', 'mp3', 'm4a', 'wav', 'aac', 'ogg', 'bin'] as const;

export type ProjectBackupInput = {
  project: Project;
  assets: { meta: Asset; blob: Blob }[];
};

export type ProjectBackupContents = {
  project: Project;
  assets: { meta: Asset; data: Uint8Array }[];
  fontIds: string[];
  warnings: string[];
};

function extFor(mime: string): string {
  const m: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/x-m4v': 'm4v',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
  };
  return m[mime] ?? 'bin';
}

/**
 * 編集内容のバックアップ。JSON＋素材＋フォント ID 一覧。私的素材を含むことを呼び出し側 UI で表示すること。
 */
export async function buildProjectBackup(input: ProjectBackupInput): Promise<Blob> {
  const parsed = projectSchema.safeParse(input.project);
  if (!parsed.success) throw new StorageError('invalid', '下書きが不正なためバックアップできません');
  const refs = referencedAssetIds(parsed.data);
  const files: Record<string, Uint8Array> = {};
  const manifest: { assets: Record<string, { file: string; meta: Asset }> } = { assets: {} };
  let total = 0;
  for (const a of input.assets) {
    if (!refs.has(a.meta.id)) continue;
    const file = `asset-${a.meta.id}.${extFor(a.meta.mime)}`;
    const data = new Uint8Array(await a.blob.arrayBuffer());
    total += data.byteLength;
    if (total > LIMITS.projectPackage.maxTotalBytes) throw new StorageError('invalid', 'バックアップが 150MB を超えます');
    files[file] = data;
    manifest.assets[a.meta.id] = { file, meta: a.meta };
  }
  for (const id of refs) if (!manifest.assets[id]) throw new StorageError('invalid', `素材が見つからないためバックアップできません: ${id}`);
  const fontIds = [...new Set(parsed.data.texts.map((t) => t.fontId))];
  files['project.json'] = utf8Encode(JSON.stringify(parsed.data, null, 2));
  files['manifest.json'] = utf8Encode(JSON.stringify(manifest, null, 2));
  files['fonts.txt'] = utf8Encode(fontIds.join('\n') + '\n');
  files['README.txt'] = utf8Encode(
    'CinemiX project backup\nこのファイルには、あなたの写真・動画・音楽（私的素材）が含まれています。第三者と共有する際はご注意ください。\n',
  );
  return new Blob([zipSync(files, { level: 1 })], { type: 'application/zip' });
}

export function readProjectBackup(bytes: Uint8Array): ProjectBackupContents {
  const entries = safeUnzip(bytes, {
    maxTotalBytes: LIMITS.projectPackage.maxTotalBytes,
    maxFiles: LIMITS.projectPackage.maxFiles,
    allowedExtensions: ALLOWED_EXT,
  });
  const map = new Map(entries.map((e) => [e.name, e.data]));
  const pj = map.get('project.json');
  const mj = map.get('manifest.json');
  if (!pj || !mj) throw new StorageError('invalid', 'project.json / manifest.json がありません');
  let projectJson: unknown;
  let manifestJson: unknown;
  try {
    projectJson = JSON.parse(utf8Decode(pj));
    manifestJson = JSON.parse(utf8Decode(mj));
  } catch (e) {
    throw new StorageError('invalid', 'バックアップの JSON を読めません', e);
  }
  const parsed = projectSchema.safeParse(projectJson);
  if (!parsed.success) throw new StorageError('invalid', `下書きが不正です: ${parsed.error.issues[0]?.message ?? ''}`);
  const warnings: string[] = [];
  const assets: { meta: Asset; data: Uint8Array }[] = [];
  const m = manifestJson as { assets?: Record<string, { file?: unknown; meta?: unknown }> };
  for (const id of referencedAssetIds(parsed.data)) {
    const entry = m.assets?.[id];
    const meta = assetSchema.safeParse(entry?.meta);
    const file = typeof entry?.file === 'string' ? entry.file : null;
    const data = file ? map.get(file) : undefined;
    if (!meta.success || !file || !data || !ALLOWED_EXT.includes(extensionOf(file) as (typeof ALLOWED_EXT)[number])) {
      warnings.push(`素材 ${id} がバックアップに含まれていません`);
      continue;
    }
    if (meta.data.id !== id) {
      warnings.push(`素材 ${id} の情報が一致しません`);
      continue;
    }
    assets.push({ meta: { ...meta.data, byteSize: data.byteLength }, data });
  }
  const fontIds = utf8Decode(map.get('fonts.txt') ?? new Uint8Array())
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return { project: parsed.data, assets, fontIds, warnings };
}
