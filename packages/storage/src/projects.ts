import type { Project } from '@cinemix/core';
import { projectSchema, referencedAssetIds, LIMITS, nowIso } from '@cinemix/core';
import type { CinemixDB, ProjectRow, QuarantineRow } from './db';
import { StorageError, toStorageError } from './errors';

export type ProjectSummary = Pick<ProjectRow, 'id' | 'title' | 'templateName' | 'updatedAt' | 'createdAt'> & { complete: boolean; slotCount: number; durationMs: number };

export type LoadResult = { status: 'ok'; project: Project } | { status: 'missing' } | { status: 'corrupt'; reason: string; quarantineId: string };

export class ProjectStore {
  constructor(private readonly db: CinemixDB) {}

  async save(project: Project): Promise<void> {
    const parsed = projectSchema.safeParse(project);
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      throw new StorageError('invalid', `保存できない内容があります: ${i?.path.join('.') ?? ''} ${i?.message ?? ''}`);
    }
    const p = parsed.data;
    try {
      await this.db.projects.put({ id: p.id, title: p.title, templateName: p.templateSnapshot.name, updatedAt: p.updatedAt, createdAt: p.createdAt, json: p });
    } catch (e) {
      throw toStorageError(e, '下書きの保存に失敗しました');
    }
  }

  /** 破損データは隔離テーブルへ移し、元の行は残さない（他の下書きは開ける） */
  async load(id: string): Promise<LoadResult> {
    const row = await this.db.projects.get(id);
    if (!row) return { status: 'missing' };
    const parsed = projectSchema.safeParse(row.json);
    if (parsed.success) return { status: 'ok', project: parsed.data };
    const reason = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).slice(0, 3).join(' / ');
    const q: QuarantineRow = { id, raw: row.json, reason, quarantinedAt: nowIso() };
    try {
      await this.db.transaction('rw', this.db.projects, this.db.quarantine, async () => {
        await this.db.quarantine.put(q);
        await this.db.projects.delete(id);
      });
    } catch (e) {
      throw toStorageError(e, '破損した下書きの隔離に失敗しました');
    }
    return { status: 'corrupt', reason, quarantineId: id };
  }

  async list(): Promise<ProjectSummary[]> {
    const rows = await this.db.projects.orderBy('updatedAt').reverse().toArray();
    return rows.map((r) => {
      const bound = new Set((r.json?.slotBindings ?? []).map((b) => b.slotId));
      const slots = r.json?.templateSnapshot?.slots ?? [];
      return {
        id: r.id,
        title: r.title,
        templateName: r.templateName,
        updatedAt: r.updatedAt,
        createdAt: r.createdAt,
        complete: slots.length > 0 && slots.every((s) => bound.has(s.id)),
        slotCount: slots.length,
        durationMs: slots.reduce((a, s) => a + (s.durationMs ?? 0), 0),
      };
    });
  }

  async listQuarantine(): Promise<QuarantineRow[]> {
    return this.db.quarantine.toArray();
  }

  async deleteQuarantine(id: string): Promise<void> {
    await this.db.quarantine.delete(id);
  }

  /** 隔離した JSON を取り出す（復旧を試す UI 用） */
  async getQuarantine(id: string): Promise<QuarantineRow | undefined> {
    return this.db.quarantine.get(id);
  }

  async delete(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.projects, this.db.exports, async () => {
      await this.db.projects.delete(id);
      await this.db.exports.delete(id);
    });
  }

  /** どの下書き・ローカルテンプレートからも参照されていない素材を削除し、解放したバイト数を返す */
  async collectOrphanAssets(): Promise<{ removed: number; bytes: number }> {
    const referenced = new Set<string>();
    await this.db.projects.each((r) => {
      for (const id of referencedAssetIds(r.json)) referenced.add(id);
    });
    await this.db.localTemplates.each((t) => {
      if (t.template.backgroundAssetId) referenced.add(t.template.backgroundAssetId);
      if (t.backgroundAssetId) referenced.add(t.backgroundAssetId);
    });
    let removed = 0;
    let bytes = 0;
    const all = await this.db.assets.toArray();
    for (const a of all) {
      if (!referenced.has(a.id)) {
        await this.db.assets.delete(a.id);
        removed++;
        bytes += a.meta.byteSize;
      }
    }
    return { removed, bytes };
  }
}

export type AutosaveStatus = { state: 'idle' | 'pending' | 'saving' | 'saved' | 'error'; error?: StorageError; savedAt?: string };

/**
 * 編集後 500ms のデバウンスで保存。永続化失敗は無視せず onStatus に伝える。
 */
export class Autosaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Project | null = null;
  private saving = false;
  private status: AutosaveStatus = { state: 'idle' };

  constructor(
    private readonly store: ProjectStore,
    private readonly onStatus: (s: AutosaveStatus) => void,
    private readonly debounceMs = LIMITS.autosaveDebounceMs,
  ) {}

  schedule(project: Project): void {
    this.pending = project;
    this.setStatus({ state: 'pending' });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pending || this.saving) return;
    const p = this.pending;
    this.pending = null;
    this.saving = true;
    this.setStatus({ state: 'saving' });
    try {
      await this.store.save(p);
      this.setStatus({ state: 'saved', savedAt: nowIso() });
    } catch (e) {
      const err = toStorageError(e, '下書きの保存に失敗しました');
      this.pending = this.pending ?? p; // 再試行できるよう保持
      this.setStatus({ state: 'error', error: err });
    } finally {
      this.saving = false;
      if (this.pending) this.schedule(this.pending);
    }
  }

  getStatus(): AutosaveStatus {
    return this.status;
  }

  private setStatus(s: AutosaveStatus) {
    this.status = s;
    this.onStatus(s);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
