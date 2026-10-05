import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { zipSync } from 'fflate';
import { BUILTIN_TEMPLATES, createProjectFromTemplate, assignAssetsInOrder, addText, type Project } from '@cinemix/core';
import {
  createDB,
  ProjectStore,
  AssetStore,
  Autosaver,
  LocalTemplateStore,
  StorageError,
  buildTemplatePackage,
  readTemplatePackage,
  buildProjectBackup,
  readProjectBackup,
  safeUnzip,
  type CinemixDB,
} from '../src';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0]);

let db: CinemixDB;
let n = 0;
beforeEach(() => {
  db = createDB(`test-${Date.now()}-${n++}`);
});

async function makeProject(assets: AssetStore): Promise<Project> {
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    const a = await assets.put(new Blob([JPG, new Uint8Array(100 + i)], { type: 'image/jpeg' }), { kind: 'image', mime: 'image/jpeg', width: 100, height: 80 });
    ids.push(a.id);
  }
  let p = assignAssetsInOrder(createProjectFromTemplate(BUILTIN_TEMPLATES[0]!), ids).project;
  const t = addText(p, { value: 'テスト', fontId: 'caveat' }, null);
  if ('error' in t) throw new Error(t.error);
  p = t.project;
  return p;
}

describe('IndexedDB persistence', () => {
  it('saves and restores a project; assets survive without Blob URLs', async () => {
    const assets = new AssetStore(db);
    const store = new ProjectStore(db);
    const p = await makeProject(assets);
    await store.save(p);
    const loaded = await store.load(p.id);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.project).toEqual(p);
    expect(JSON.stringify(loaded.project)).not.toContain('blob:');
    const blob = await assets.getBlob(p.slotBindings[0]!.assetId);
    expect(blob?.size).toBeGreaterThan(0);
    const list = await store.list();
    expect(list[0]).toMatchObject({ id: p.id, complete: true, slotCount: 5, durationMs: 15000 });
  });

  it('quarantines a corrupt draft and keeps the others openable', async () => {
    const assets = new AssetStore(db);
    const store = new ProjectStore(db);
    const good = await makeProject(assets);
    await store.save(good);
    await db.projects.put({ id: 'broken', title: 'x', templateName: 'x', createdAt: 'x', updatedAt: 'x', json: { nope: true } as unknown as Project });
    const res = await store.load('broken');
    expect(res.status).toBe('corrupt');
    expect((await store.listQuarantine()).length).toBe(1);
    expect((await store.load(good.id)).status).toBe('ok');
    expect((await store.list()).length).toBe(1);
  });

  it('rejects invalid projects instead of persisting them', async () => {
    const store = new ProjectStore(db);
    const p = createProjectFromTemplate(BUILTIN_TEMPLATES[0]!);
    await expect(store.save({ ...p, texts: [{ ...p.texts, bad: true } as never] })).rejects.toBeInstanceOf(StorageError);
  });

  it('autosaver debounces and reports quota errors without losing the pending project', async () => {
    const store = new ProjectStore(db);
    const statuses: string[] = [];
    const saver = new Autosaver(store, (s) => statuses.push(s.state), 10);
    const p = createProjectFromTemplate(BUILTIN_TEMPLATES[0]!);
    saver.schedule(p);
    saver.schedule({ ...p, title: 'second' });
    await new Promise((r) => setTimeout(r, 60));
    expect(statuses).toContain('saved');
    expect((await store.load(p.id)) as { project: Project }).toMatchObject({ project: { title: 'second' } });

    const failing = new ProjectStore({ projects: { put: async () => { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } } } as unknown as CinemixDB);
    const st: { state: string; code?: string }[] = [];
    const saver2 = new Autosaver(failing, (s) => st.push({ state: s.state, ...(s.error ? { code: s.error.code } : {}) }), 5);
    saver2.schedule(p);
    await new Promise((r) => setTimeout(r, 30));
    expect(st.some((s) => s.state === 'error' && s.code === 'quota-exceeded')).toBe(true);
    saver2.dispose();
    saver.dispose();
  });

  it('collects orphan assets only', async () => {
    const assets = new AssetStore(db);
    const store = new ProjectStore(db);
    const p = await makeProject(assets);
    await store.save(p);
    await assets.put(new Blob([JPG], { type: 'image/jpeg' }), { kind: 'image', mime: 'image/jpeg' });
    const r = await store.collectOrphanAssets();
    expect(r.removed).toBe(1);
    expect((await assets.list()).length).toBe(5);
  });
});

describe('template package', () => {
  it('round-trips and never contains private media', async () => {
    const t = structuredClone(BUILTIN_TEMPLATES[1]!);
    t.backgroundAssetId = '99999999-9999-4999-8999-999999999999';
    const blob = await buildTemplatePackage({ template: t, backgroundJpeg: new Blob([JPG]), coverPng: new Blob([PNG]), licensesText: 'OFL' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const contents = readTemplatePackage(bytes);
    expect(contents.template.backgroundAssetId).toBeUndefined();
    expect(contents.hasBackground).toBe(true);
    expect(contents.template.slots.length).toBe(5);
    const names = Object.keys((await import('fflate')).unzipSync(bytes));
    expect(names.sort()).toEqual(['background.jpg', 'cover.png', 'licenses.txt', 'template.json']);
  });

  it('rejects path traversal, scripts, duplicates and oversized expansion', async () => {
    const base = { 'template.json': new TextEncoder().encode(JSON.stringify(BUILTIN_TEMPLATES[0])), 'cover.png': PNG, 'licenses.txt': new TextEncoder().encode('x') };
    const traversal = zipSync({ ...base, '../evil.txt': new Uint8Array([1]) });
    expect(() => readTemplatePackage(traversal)).toThrow(/不正なファイル名|想定外|許可されていない/);
    const script = zipSync({ ...base, 'run.js': new Uint8Array([1]) });
    expect(() => readTemplatePackage(script)).toThrow(/許可されていない|想定外/);
    const html = zipSync({ ...base, 'index.html': new Uint8Array([1]) });
    expect(() => readTemplatePackage(html)).toThrow();
    const nested = zipSync({ ...base, 'sub/cover.png': PNG });
    expect(() => readTemplatePackage(nested)).toThrow();
    const bomb = zipSync({ ...base, 'background.jpg': new Uint8Array(26 * 1024 * 1024) }, { level: 9 });
    expect(bomb.byteLength).toBeLessThan(1024 * 1024); // 圧縮は小さいが…
    expect(() => readTemplatePackage(bomb)).toThrow(/サイズ/);
    const fakePng = zipSync({ ...base, 'cover.png': new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) });
    expect(() => readTemplatePackage(fakePng)).toThrow(/PNG/);
    const tooMany: Record<string, Uint8Array> = { ...base };
    for (let i = 0; i < 120; i++) tooMany[`f${i}.txt`] = new Uint8Array([1]);
    expect(() => safeUnzip(zipSync(tooMany), { maxTotalBytes: 1e9, maxFiles: 100, allowedExtensions: ['txt', 'json', 'png'] })).toThrow(/ファイル数/);
  });

  it('rejects unknown effects via schema', () => {
    const t = structuredClone(BUILTIN_TEMPLATES[0]!) as unknown as { slots: { motionPreset: string }[] };
    t.slots[0]!.motionPreset = 'spinWildly';
    const z = zipSync({ 'template.json': new TextEncoder().encode(JSON.stringify(t)), 'cover.png': PNG, 'licenses.txt': new Uint8Array([1]) });
    expect(() => readTemplatePackage(z)).toThrow(/テンプレートが不正/);
  });
});

describe('project backup', () => {
  it('round-trips project + assets + font ids', async () => {
    const assets = new AssetStore(db);
    const p = await makeProject(assets);
    const rows = await Promise.all(p.slotBindings.map(async (b) => ({ meta: (await assets.get(b.assetId))!, blob: (await assets.getBlob(b.assetId))! })));
    const blob = await buildProjectBackup({ project: p, assets: rows });
    const contents = readProjectBackup(new Uint8Array(await blob.arrayBuffer()));
    expect(contents.project).toEqual(p);
    expect(contents.assets.length).toBe(5);
    expect(contents.fontIds).toEqual(['caveat']);
    expect(contents.warnings).toEqual([]);
  });
});

describe('local templates', () => {
  it('saves, lists and deletes', async () => {
    const store = new LocalTemplateStore(db);
    const t = structuredClone(BUILTIN_TEMPLATES[2]!);
    t.id = '12345678-1234-4123-8123-123456789012';
    t.name = 'My strip';
    await store.save(t, { origin: 'local' });
    expect((await store.list()).map((r) => r.template.name)).toEqual(['My strip']);
    await store.delete(t.id);
    expect((await store.list()).length).toBe(0);
  });
});
