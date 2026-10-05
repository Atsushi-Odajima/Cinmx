import { describe, it, expect } from 'vitest';
import {
  BUILTIN_TEMPLATES,
  buildRenderPlan,
  renderFrame,
  createProjectFromTemplate,
  assignAssetsInOrder,
  addText,
  type Canvas2D,
  type FrameResources,
  type Drawable,
} from '../src';

type Op = { op: string; args: unknown[] };

function mockCtx(W = 720, H = 1280): Canvas2D & { ops: Op[] } {
  const ops: Op[] = [];
  const rec = (op: string) => (...args: unknown[]) => void ops.push({ op, args });
  const ctx = {
    ops,
    canvas: { width: W, height: H },
    fillStyle: '#000000' as string,
    strokeStyle: '#000000' as string,
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    lineJoin: 'miter' as CanvasLineJoin,
    save: rec('save'),
    restore: rec('restore'),
    fillRect: (...a: unknown[]) => ops.push({ op: 'fillRect', args: [ctx.fillStyle, ctx.globalAlpha, ...a] }),
    strokeRect: rec('strokeRect'),
    clearRect: rec('clearRect'),
    beginPath: rec('beginPath'),
    rect: rec('rect'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    stroke: rec('stroke'),
    clip: rec('clip'),
    fillText: (...a: unknown[]) => ops.push({ op: 'fillText', args: [ctx.font, ctx.fillStyle, ...a] }),
    strokeText: rec('strokeText'),
    measureText: (s: string) => ({ width: [...s].length * 20 }),
    drawImage: (...a: unknown[]) => ops.push({ op: 'drawImage', args: [ctx.globalAlpha, ...a] }),
    translate: rec('translate'),
    scale: rec('scale'),
    setLineDash: rec('setLineDash'),
  };
  return ctx;
}

const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'];
const drawable: Drawable = { image: {} as CanvasImageSource, width: 1600, height: 1200 };
const resources: FrameResources = { prepare: async () => {}, get: (id) => (ids.includes(id) ? drawable : null) };
const info = (id: string) => (ids.includes(id) ? { kind: 'image' as const } : undefined);

describe('renderFrame', () => {
  it('draws background, the current slot image, then text on top — deterministic', () => {
    const t = BUILTIN_TEMPLATES[0]!;
    let p = createProjectFromTemplate(t);
    p = assignAssetsInOrder(p, ids).project;
    const added = addText(p, { value: '夏の記録', fontId: 'caveat', color: '#FFFCF4' }, t.slots[1]!.id);
    if ('error' in added) throw new Error(added.error);
    p = added.project;
    const plan = buildRenderPlan(p, () => (s) => [...s].length * 20);

    const ctx = mockCtx();
    renderFrame(ctx, plan, 4000, resources, info);
    const seq = ctx.ops.map((o) => o.op).filter((o) => ['fillRect', 'drawImage', 'fillText'].includes(o));
    expect(seq[0]).toBe('fillRect');
    expect(seq.indexOf('drawImage')).toBeGreaterThan(seq.indexOf('fillRect'));
    expect(seq.indexOf('fillText')).toBeGreaterThan(seq.indexOf('drawImage'));
    const text = ctx.ops.find((o) => o.op === 'fillText')!;
    expect(text.args[0]).toContain('"Caveat", "Noto Sans JP"');
    expect(text.args[1]).toBe('#FFFCF4');
    expect(text.args[2]).toBe('夏の記録');

    // 同じ入力は同じ描画列
    const ctx2 = mockCtx();
    renderFrame(ctx2, plan, 4000, resources, info);
    expect(JSON.stringify(ctx2.ops)).toBe(JSON.stringify(ctx.ops));
  });

  it('text is not drawn outside its [start,end) and no slot image after the end of the video', () => {
    const t = BUILTIN_TEMPLATES[0]!;
    let p = createProjectFromTemplate(t);
    p = assignAssetsInOrder(p, ids).project;
    const added = addText(p, { value: 'Hi' }, t.slots[1]!.id); // 3000..6000
    if ('error' in added) throw new Error(added.error);
    p = added.project;
    const plan = buildRenderPlan(p, () => (s) => [...s].length * 20);
    const at = (ms: number) => {
      const ctx = mockCtx();
      renderFrame(ctx, plan, ms, resources, info);
      return ctx.ops.map((o) => o.op);
    };
    expect(at(2999)).not.toContain('fillText');
    expect(at(3000)).toContain('fillText');
    expect(at(5999)).toContain('fillText');
    expect(at(6000)).not.toContain('fillText');
    expect(at(15000)).not.toContain('drawImage');
    expect(at(14999)).toContain('drawImage');
  });

  it('video binding: hold keeps drawing, fade stops drawing after playable range', () => {
    const t = BUILTIN_TEMPLATES[0]!;
    let p = createProjectFromTemplate(t);
    p = assignAssetsInOrder(p, ids).project;
    const vinfo = (id: string) => (id === ids[0] ? { kind: 'video' as const, durationMs: 1000 } : info(id));
    const plan = buildRenderPlan(p, () => (s) => [...s].length * 20);
    const ctxHold = mockCtx();
    renderFrame(ctxHold, plan, 2000, resources, vinfo);
    expect(ctxHold.ops.map((o) => o.op)).toContain('drawImage');
    p = { ...p, slotBindings: p.slotBindings.map((b) => (b.assetId === ids[0] ? { ...b, shortVideoPolicy: 'fade' as const } : b)) };
    const plan2 = buildRenderPlan(p, () => (s) => [...s].length * 20);
    const ctxFade = mockCtx();
    renderFrame(ctxFade, plan2, 2000, resources, vinfo);
    expect(ctxFade.ops.map((o) => o.op)).not.toContain('drawImage');
  });

  it('frame style is drawn above the slot image and below text', () => {
    const t = BUILTIN_TEMPLATES[2]!; // contact strip
    let p = createProjectFromTemplate(t);
    p = assignAssetsInOrder(p, ids).project;
    const added = addText(p, { value: 'A' }, null);
    if ('error' in added) throw new Error(added.error);
    p = added.project;
    const plan = buildRenderPlan(p, () => (s) => [...s].length * 20);
    const ctx = mockCtx();
    renderFrame(ctx, plan, 100, resources, info);
    const ops = ctx.ops;
    const img = ops.findIndex((o) => o.op === 'drawImage');
    const number = ops.findIndex((o) => o.op === 'fillText' && o.args[2] === '01');
    const userText = ops.findIndex((o) => o.op === 'fillText' && o.args[2] === 'A');
    expect(img).toBeGreaterThan(-1);
    expect(number).toBeGreaterThan(img);
    expect(userText).toBeGreaterThan(number);
  });
});
