import Dexie, { type EntityTable } from 'dexie';
import type { Project, Asset, Template } from '@cinemix/core';

export type ProjectRow = {
  id: string;
  title: string;
  templateName: string;
  updatedAt: string;
  createdAt: string;
  json: Project;
};

export type AssetRow = {
  id: string;
  meta: Asset;
  blob: Blob;
};

export type TemplateOrigin = 'local' | 'imported' | 'online';

export type LocalTemplateRow = {
  id: string;
  updatedAt: string;
  origin: TemplateOrigin;
  template: Template;
  /** 背景（再エンコード済み JPEG）。Asset としても登録する。 */
  backgroundAssetId?: string;
  coverBlob?: Blob;
  previewBlob?: Blob;
  /** オンライン投稿の状態（B）。未接続では 'not-connected'。 */
  cloud?: { remoteId: string; version: number; visibility: 'private' | 'public'; moderationStatus: 'pending' | 'approved' | 'rejected'; syncedAt: string };
};

export type ExportRow = {
  projectId: string;
  blob: Blob;
  mime: string;
  extension: string;
  createdAt: string;
  durationMs: number;
  hasAudio: boolean;
  width: number;
  height: number;
  path: 'webcodecs' | 'media-recorder';
};

export type QuarantineRow = {
  id: string;
  raw: unknown;
  reason: string;
  quarantinedAt: string;
};

export type SettingRow = { key: string; value: unknown };

export class CinemixDB extends Dexie {
  projects!: EntityTable<ProjectRow, 'id'>;
  assets!: EntityTable<AssetRow, 'id'>;
  localTemplates!: EntityTable<LocalTemplateRow, 'id'>;
  exports!: EntityTable<ExportRow, 'projectId'>;
  quarantine!: EntityTable<QuarantineRow, 'id'>;
  settings!: EntityTable<SettingRow, 'key'>;

  constructor(name = 'cinemix') {
    super(name);
    this.version(1).stores({
      projects: 'id, updatedAt',
      assets: 'id',
      localTemplates: 'id, updatedAt, origin',
      exports: 'projectId, createdAt',
      quarantine: 'id, quarantinedAt',
      settings: 'key',
    });
  }
}

let shared: CinemixDB | null = null;
export function getDB(): CinemixDB {
  if (!shared) shared = new CinemixDB();
  return shared;
}

/** テスト用: 別名 DB を作る */
export function createDB(name: string): CinemixDB {
  return new CinemixDB(name);
}
