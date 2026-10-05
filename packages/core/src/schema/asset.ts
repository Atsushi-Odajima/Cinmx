import { z } from 'zod';
import { finiteNumber, intMs, uuid } from './common';

export const assetKindSchema = z.enum(['image', 'video', 'audio']);
export type AssetKind = z.infer<typeof assetKindSchema>;

/**
 * 素材のメタデータ。Blob 本体は localBlobKey で端末内ストレージから引く。
 * Blob URL は一時値であり、ここには保存しない。
 */
export const assetSchema = z.object({
  id: uuid,
  kind: assetKindSchema,
  mime: z.string().max(100),
  byteSize: finiteNumber.int().min(0),
  width: finiteNumber.int().min(1).optional(),
  height: finiteNumber.int().min(1).optional(),
  durationMs: intMs.optional(),
  localBlobKey: z.string().min(1).max(200),
  checksum: z.string().min(8).max(128),
  /** 元ファイル名の拡張子程度の情報。解析サービスには送らない。 */
  label: z.string().max(80).optional(),
  createdAt: z.iso.datetime(),
});
export type Asset = z.infer<typeof assetSchema>;
