import type { Asset, AssetKind } from '@cinemix/core';
import { newId, nowIso, assetSchema } from '@cinemix/core';
import type { CinemixDB } from './db';
import { checksumBlob } from './checksum';
import { StorageError, toStorageError } from './errors';

export type AssetInit = {
  kind: AssetKind;
  mime: string;
  width?: number;
  height?: number;
  durationMs?: number;
  label?: string;
};

export class AssetStore {
  constructor(private readonly db: CinemixDB) {}

  async put(blob: Blob, init: AssetInit): Promise<Asset> {
    const id = newId();
    const meta: Asset = {
      id,
      kind: init.kind,
      mime: init.mime,
      byteSize: blob.size,
      localBlobKey: `asset:${id}`,
      checksum: await checksumBlob(blob),
      createdAt: nowIso(),
      ...(init.width !== undefined ? { width: init.width } : {}),
      ...(init.height !== undefined ? { height: init.height } : {}),
      ...(init.durationMs !== undefined ? { durationMs: init.durationMs } : {}),
      ...(init.label !== undefined ? { label: init.label.slice(0, 80) } : {}),
    };
    const parsed = assetSchema.safeParse(meta);
    if (!parsed.success) throw new StorageError('invalid', `素材情報が不正です: ${parsed.error.issues[0]?.message ?? ''}`);
    try {
      await this.db.assets.put({ id, meta: parsed.data, blob });
    } catch (e) {
      throw toStorageError(e, '素材の保存に失敗しました');
    }
    return parsed.data;
  }

  /** 既存の id のまま入れる（バックアップ復元用） */
  async putWithId(meta: Asset, blob: Blob): Promise<void> {
    const parsed = assetSchema.safeParse(meta);
    if (!parsed.success) throw new StorageError('invalid', '素材情報が不正です');
    try {
      await this.db.assets.put({ id: meta.id, meta: parsed.data, blob });
    } catch (e) {
      throw toStorageError(e, '素材の保存に失敗しました');
    }
  }

  async get(id: string): Promise<Asset | undefined> {
    const row = await this.db.assets.get(id);
    return row?.meta;
  }

  async getBlob(id: string): Promise<Blob | undefined> {
    const row = await this.db.assets.get(id);
    return row?.blob;
  }

  async getMany(ids: Iterable<string>): Promise<Map<string, Asset>> {
    const out = new Map<string, Asset>();
    const rows = await this.db.assets.bulkGet([...new Set(ids)]);
    for (const r of rows) if (r) out.set(r.id, r.meta);
    return out;
  }

  async list(): Promise<Asset[]> {
    return (await this.db.assets.toArray()).map((r) => r.meta);
  }

  async delete(id: string): Promise<void> {
    await this.db.assets.delete(id);
  }

  async totalBytes(): Promise<number> {
    let total = 0;
    await this.db.assets.each((r) => void (total += r.meta.byteSize));
    return total;
  }
}
