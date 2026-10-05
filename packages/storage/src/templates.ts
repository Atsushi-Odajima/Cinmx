import type { Template } from '@cinemix/core';
import { templateSchema, nowIso } from '@cinemix/core';
import type { CinemixDB, LocalTemplateRow, TemplateOrigin } from './db';
import { StorageError, toStorageError } from './errors';

export class LocalTemplateStore {
  constructor(private readonly db: CinemixDB) {}

  async save(template: Template, extra: Partial<Omit<LocalTemplateRow, 'id' | 'template' | 'updatedAt'>> & { origin?: TemplateOrigin } = {}): Promise<LocalTemplateRow> {
    const parsed = templateSchema.safeParse(template);
    if (!parsed.success) throw new StorageError('invalid', `テンプレートが不正です: ${parsed.error.issues[0]?.message ?? ''}`);
    const existing = await this.db.localTemplates.get(template.id);
    const row: LocalTemplateRow = {
      ...(existing ?? {}),
      ...extra,
      id: template.id,
      origin: extra.origin ?? existing?.origin ?? 'local',
      template: parsed.data,
      updatedAt: nowIso(),
    };
    try {
      await this.db.localTemplates.put(row);
    } catch (e) {
      throw toStorageError(e, 'テンプレートの保存に失敗しました');
    }
    return row;
  }

  async get(id: string): Promise<LocalTemplateRow | undefined> {
    const row = await this.db.localTemplates.get(id);
    if (!row) return undefined;
    const parsed = templateSchema.safeParse(row.template);
    if (!parsed.success) return undefined;
    return { ...row, template: parsed.data };
  }

  async list(): Promise<LocalTemplateRow[]> {
    const rows = await this.db.localTemplates.orderBy('updatedAt').reverse().toArray();
    return rows.filter((r) => templateSchema.safeParse(r.template).success);
  }

  async delete(id: string): Promise<void> {
    await this.db.localTemplates.delete(id);
  }
}
