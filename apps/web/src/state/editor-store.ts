import type { Asset, Project } from '@cinemix/core';
import { History, projectSchema, referencedAssetIds } from '@cinemix/core';
import { Autosaver, type AutosaveStatus } from '@cinemix/storage';
import { assetStore, projectStore } from '../services';

export type EditorSnapshot = {
  project: Project;
  assets: ReadonlyMap<string, Asset>;
  canUndo: boolean;
  canRedo: boolean;
  save: AutosaveStatus;
  selectedTextId: string | null;
  currentSlotId: string | null;
  dirtyPreview: number;
};

/**
 * 編集中プロジェクトの状態。利用者の操作単位で commit() し、履歴（最大30）と自動保存（500ms デバウンス）を行う。
 * ドラッグ中などの一時更新は preview() で履歴に積まない。
 */
export class EditorStore {
  private project: Project;
  private assets: Map<string, Asset> = new Map();
  private history = new History<Project>();
  private autosaver: Autosaver;
  private save: AutosaveStatus = { state: 'idle' };
  private listeners = new Set<() => void>();
  private snapshot: EditorSnapshot;
  private selectedTextId: string | null = null;
  private currentSlotId: string | null = null;
  private dirtyPreview = 0;

  private readonly onPageHide = () => {
    // 画面遷移・タブ切替・ロック時はデバウンス待ちの保存を即時実行する（IndexedDB の書き込みは開始していれば完了する）
    void this.autosaver.flush();
  };

  constructor(project: Project) {
    this.project = project;
    this.autosaver = new Autosaver(projectStore, (s) => {
      this.save = s;
      this.emit();
    });
    this.snapshot = this.buildSnapshot();
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.onPageHide);
      document.addEventListener('visibilitychange', this.onPageHide);
    }
  }

  async init(): Promise<void> {
    await this.refreshAssets();
  }

  async refreshAssets(): Promise<void> {
    const ids = referencedAssetIds(this.project);
    this.assets = await assetStore.getMany(ids);
    this.emit();
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): EditorSnapshot => this.snapshot;

  private buildSnapshot(): EditorSnapshot {
    return {
      project: this.project,
      assets: this.assets,
      canUndo: this.history.canUndo(),
      canRedo: this.history.canRedo(),
      save: this.save,
      selectedTextId: this.selectedTextId,
      currentSlotId: this.currentSlotId,
      dirtyPreview: this.dirtyPreview,
    };
  }

  private emit() {
    this.snapshot = this.buildSnapshot();
    for (const l of this.listeners) l();
  }

  get current(): Project {
    return this.project;
  }

  /** 利用者の操作単位の確定。履歴に積み、保存を予約する。 */
  commit(next: Project, options: { refreshAssets?: boolean } = {}): void {
    if (next === this.project) return;
    const parsed = projectSchema.safeParse(next);
    if (!parsed.success) {
      console.warn('[cinemix] invalid project state rejected', parsed.error.issues.slice(0, 3));
      return;
    }
    this.history.push(this.project);
    this.project = parsed.data;
    this.autosaver.schedule(this.project);
    if (options.refreshAssets) void this.refreshAssets();
    this.emit();
  }

  /** ドラッグ中などの一時反映（履歴に積まない） */
  preview(next: Project): void {
    this.project = next;
    this.dirtyPreview++;
    this.emit();
  }

  /** preview() で変えた状態を、操作終了時に履歴へ確定する（base = 操作開始時の状態） */
  commitFrom(base: Project): void {
    if (base === this.project) return;
    const parsed = projectSchema.safeParse(this.project);
    if (!parsed.success) {
      this.project = base;
      this.emit();
      return;
    }
    this.history.push(base);
    this.project = parsed.data;
    this.autosaver.schedule(this.project);
    this.emit();
  }

  undo(): void {
    const prev = this.history.undo(this.project);
    if (!prev) return;
    this.project = prev;
    this.autosaver.schedule(this.project);
    void this.refreshAssets();
    this.emit();
  }

  redo(): void {
    const next = this.history.redo(this.project);
    if (!next) return;
    this.project = next;
    this.autosaver.schedule(this.project);
    void this.refreshAssets();
    this.emit();
  }

  selectText(id: string | null): void {
    this.selectedTextId = id;
    this.emit();
  }

  setCurrentSlot(id: string | null): void {
    if (this.currentSlotId === id) return;
    this.currentSlotId = id;
    this.emit();
  }

  async flush(): Promise<void> {
    await this.autosaver.flush();
  }

  retrySave(): void {
    this.autosaver.schedule(this.project);
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.onPageHide);
      document.removeEventListener('visibilitychange', this.onPageHide);
    }
    void this.autosaver.flush();
    this.autosaver.dispose();
    this.listeners.clear();
  }
}
