import { describe, it, expect } from 'vitest';
import {
  BUILTIN_TEMPLATES,
  createProjectFromTemplate,
  assignAssetsInOrder,
  moveBinding,
  removeBinding,
  addText,
  updateText,
  reorderText,
  clampTextsToDuration,
  setBackground,
  validateProject,
  isProjectComplete,
  History,
  projectSchema,
  templateSchema,
  type Asset,
} from '../src';

const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666'];
const asset = (id: string, kind: Asset['kind'] = 'image', durationMs?: number): Asset => ({
  id,
  kind,
  mime: kind === 'image' ? 'image/jpeg' : kind === 'video' ? 'video/mp4' : 'audio/mpeg',
  byteSize: 1000,
  localBlobKey: `blob-${id}`,
  checksum: 'deadbeefdeadbeef',
  createdAt: new Date().toISOString(),
  ...(durationMs !== undefined ? { durationMs } : {}),
});

describe('project operations', () => {
  it('assigns in order, reports overflow, reorders and removes', () => {
    const t = BUILTIN_TEMPLATES[0]!;
    const { project, overflow } = assignAssetsInOrder(createProjectFromTemplate(t), ids);
    expect(overflow).toEqual([ids[5]]);
    expect(isProjectComplete(project)).toEqual({ complete: true, missing: 0 });
    const moved = moveBinding(project, t.slots[0]!.id, 1);
    expect(moved.slotBindings.find((b) => b.slotId === t.slots[1]!.id)?.assetId).toBe(ids[0]);
    expect(moved.slotBindings.find((b) => b.slotId === t.slots[0]!.id)?.assetId).toBe(ids[1]);
    const removed = removeBinding(moved, t.slots[0]!.id);
    expect(isProjectComplete(removed)).toEqual({ complete: false, missing: 1 });
  });

  it('text default range is the selected slot; zOrder reorder swaps neighbours', () => {
    const t = BUILTIN_TEMPLATES[0]!;
    let p = createProjectFromTemplate(t);
    const a = addText(p, { value: 'A' }, t.slots[2]!.id);
    if ('error' in a) throw new Error(a.error);
    p = a.project;
    expect(a.text).toMatchObject({ startMs: 6000, endMs: 9000, zOrder: 0 });
    const b = addText(p, { value: 'B' }, null);
    if ('error' in b) throw new Error(b.error);
    p = b.project;
    expect(b.text).toMatchObject({ startMs: 0, endMs: 15000, zOrder: 1 });
    p = reorderText(p, a.text.id, 'forward');
    expect(p.texts.find((x) => x.id === a.text.id)?.zOrder).toBe(1);
    expect(p.texts.find((x) => x.id === b.text.id)?.zOrder).toBe(0);
    p = updateText(p, a.text.id, { startMs: 5000, endMs: 5000 });
    const ta = p.texts.find((x) => x.id === a.text.id)!;
    expect(ta.endMs).toBeGreaterThan(ta.startMs);
  });

  it('text position/time survive background change and slot duration change (clamped to D)', () => {
    const t = BUILTIN_TEMPLATES[1]!;
    let p = createProjectFromTemplate(t);
    const a = addText(p, { value: 'A', centerX: 0.3, centerY: 0.2, startMs: 1000, endMs: 14000 }, null);
    if ('error' in a) throw new Error(a.error);
    p = a.project;
    p = setBackground(p, ids[0], { centerX: 0.4, centerY: 0.6, scale: 1.5 });
    expect(p.texts[0]).toMatchObject({ centerX: 0.3, centerY: 0.2, startMs: 1000, endMs: 14000 });
    // 枠を短くして D=11000 にする
    p = { ...p, templateSnapshot: { ...p.templateSnapshot, slots: p.templateSnapshot.slots.map((s) => (s.index === 4 ? { ...s, durationMs: 1000 } : s)) } };
    p = { ...p, templateSnapshot: { ...p.templateSnapshot, slots: p.templateSnapshot.slots.map((s) => (s.index === 3 ? { ...s, durationMs: 1000 } : s)) } };
    p = clampTextsToDuration(p);
    expect(p.texts[0]).toMatchObject({ centerX: 0.3, centerY: 0.2, startMs: 1000, endMs: 11000 });
  });

  it('history: undo/redo up to 30', () => {
    const h = new History<number>(30);
    let cur = 0;
    for (let i = 1; i <= 40; i++) {
      h.push(cur);
      cur = i;
    }
    expect(h.size).toBe(30);
    let steps = 0;
    while (h.canUndo()) {
      cur = h.undo(cur)!;
      steps++;
    }
    expect(steps).toBe(30);
    expect(cur).toBe(10);
    cur = h.redo(cur)!;
    expect(cur).toBe(11);
  });
});

describe('validation', () => {
  it('rejects NaN/Infinity, out-of-range ratios, and inconsistent slot count', () => {
    const t = structuredClone(BUILTIN_TEMPLATES[0]!) as unknown as { slots: { rect: { x: number } }[]; requiredAssetCount: number };
    t.slots[0]!.rect.x = Number.NaN;
    expect(templateSchema.safeParse(t).success).toBe(false);
    const t2 = structuredClone(BUILTIN_TEMPLATES[0]!);
    t2.requiredAssetCount = 4;
    expect(templateSchema.safeParse(t2).success).toBe(false);
    const t3 = structuredClone(BUILTIN_TEMPLATES[0]!);
    t3.slots[0]!.durationMs = 12345;
    expect(templateSchema.safeParse(t3).success).toBe(false);
  });

  it('rejects broken JSON and dangling references; flags missing assets', () => {
    expect(validateProject({ hello: 'world' }).ok).toBe(false);
    const t = BUILTIN_TEMPLATES[0]!;
    let p = createProjectFromTemplate(t);
    p = assignAssetsInOrder(p, ids.slice(0, 5)).project;
    const assets = new Map(ids.slice(0, 4).map((id) => [id, asset(id)]));
    const res = validateProject(p, assets);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.message.includes('素材が見つかりません'))).toBe(true);
    assets.set(ids[4]!, asset(ids[4]!));
    expect(validateProject(p, assets).ok).toBe(true);
    const bad = { ...p, texts: [{ ...addText(p, { value: 'x' }, null) }] };
    expect(projectSchema.safeParse(bad).success).toBe(false);
  });

  it('text time must fit in D; audio out must fit in the source', () => {
    const t = BUILTIN_TEMPLATES[0]!;
    let p = createProjectFromTemplate(t);
    const a = addText(p, { value: 'x' }, null);
    if ('error' in a) throw new Error(a.error);
    p = { ...a.project, texts: a.project.texts.map((x) => ({ ...x, endMs: 20000 })) };
    expect(validateProject(p).issues.some((i) => i.path.endsWith('endMs'))).toBe(true);
    const audioId = ids[5]!;
    const p2 = { ...createProjectFromTemplate(t), audio: { assetId: audioId, sourceInMs: 0, sourceOutMs: 30000, volume: 0.7, fadeOutMs: 1000 } };
    const assets = new Map([[audioId, asset(audioId, 'audio', 20000)]]);
    expect(validateProject(p2, assets).issues.some((i) => i.path === 'audio.sourceOutMs')).toBe(true);
    const p3 = { ...p2, audio: { ...p2.audio, sourceOutMs: 20000 } };
    expect(validateProject(p3, assets).ok).toBe(true);
  });
});
