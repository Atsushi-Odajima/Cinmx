import type { CinemixDB } from './db';

export class SettingsStore {
  constructor(private readonly db: CinemixDB) {}
  async get<T>(key: string, fallback: T): Promise<T> {
    const row = await this.db.settings.get(key);
    return (row?.value as T | undefined) ?? fallback;
  }
  async set(key: string, value: unknown): Promise<void> {
    await this.db.settings.put({ key, value });
  }
}

/** 永続化の見積もり（対応ブラウザのみ） */
export async function estimateStorage(): Promise<{ usage: number; quota: number; persisted: boolean | null } | null> {
  const sm = globalThis.navigator?.storage;
  if (!sm || typeof sm.estimate !== 'function') return null;
  const est = await sm.estimate();
  let persisted: boolean | null = null;
  try {
    if (typeof sm.persisted === 'function') persisted = await sm.persisted();
  } catch {
    persisted = null;
  }
  return { usage: est.usage ?? 0, quota: est.quota ?? 0, persisted };
}
