import { describe, it, expect } from 'vitest';
import {
  BUILTIN_TEMPLATES,
  computeSlotRanges,
  totalDurationMs,
  findSlotAt,
  fadeLengthMs,
  frameCount,
  frameTimeMs,
  frameDurationSec,
  easeInOutCubic,
  linear,
  computeAudioPlan,
  gainAt,
  resolveVideoFrame,
  isTextVisibleAt,
  normalizeTextRange,
  computeSlotTransform,
  snapMs,
} from '../src';

describe('slot ranges', () => {
  it('5 x 3000ms = 15000ms, half-open intervals', () => {
    const t = BUILTIN_TEMPLATES[0]!;
    const ranges = computeSlotRanges(t);
    expect(totalDurationMs(t)).toBe(15000);
    expect(ranges.map((r) => [r.startMs, r.endMs])).toEqual([
      [0, 3000],
      [3000, 6000],
      [6000, 9000],
      [9000, 12000],
      [12000, 15000],
    ]);
    expect(findSlotAt(ranges, 0)?.index).toBe(0);
    expect(findSlotAt(ranges, 2999.9)?.index).toBe(0);
    expect(findSlotAt(ranges, 3000)?.index).toBe(1); // ちょうど境界は次の枠
    expect(findSlotAt(ranges, 14999)?.index).toBe(4);
    expect(findSlotAt(ranges, 15000)).toBeNull(); // 動画末尾
  });

  it('4s→1s slot change keeps ordering and total', () => {
    const t = structuredClone(BUILTIN_TEMPLATES[1]!);
    t.slots[1]!.durationMs = 4000;
    t.slots[2]!.durationMs = 1000;
    const ranges = computeSlotRanges(t);
    expect(ranges[1]).toMatchObject({ startMs: 3000, endMs: 7000 });
    expect(ranges[2]).toMatchObject({ startMs: 7000, endMs: 8000 });
    expect(totalDurationMs(t)).toBe(3000 + 4000 + 1000 + 3000 + 3000);
    expect(fadeLengthMs(1000)).toBe(250);
    expect(fadeLengthMs(800)).toBe(200); // min(250, dur/4)
  });

  it('frame math: count = ceil(D*30/1000), time = k*1000/30, last frame within one frame of D', () => {
    expect(frameCount(15000)).toBe(450);
    expect(frameCount(15010)).toBe(451);
    expect(frameTimeMs(0)).toBe(0);
    expect(frameTimeMs(449)).toBeCloseTo(14966.666, 2);
    const total = Array.from({ length: frameCount(15010) }, (_, k) => frameDurationSec(k, 15010)).reduce((a, b) => a + b, 0);
    expect(Math.abs(total * 1000 - 15010)).toBeLessThan(1000 / 30);
    const total15 = Array.from({ length: 450 }, (_, k) => frameDurationSec(k, 15000)).reduce((a, b) => a + b, 0);
    expect(total15).toBeCloseTo(15, 6);
  });

  it('snapMs rounds to 100ms and clamps', () => {
    expect(snapMs(1234)).toBe(1200);
    expect(snapMs(1250)).toBe(1300);
    expect(snapMs(-5)).toBe(0);
    expect(snapMs(99999, 100, 15000)).toBe(15000);
    expect(snapMs(Number.NaN)).toBe(0);
  });
});

describe('easing', () => {
  it('linear and easeInOutCubic are clamped and symmetric', () => {
    expect(linear(-1)).toBe(0);
    expect(linear(2)).toBe(1);
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 9);
    expect(easeInOutCubic(0.25)).toBeCloseTo(4 * 0.25 ** 3, 9);
    expect(easeInOutCubic(Number.NaN)).toBe(0);
  });
});

describe('slot transforms', () => {
  it('zoomSlow goes 1.00 -> 1.05 and fades in/out within the slot', () => {
    const slot = BUILTIN_TEMPLATES[0]!.slots[0]!;
    expect(computeSlotTransform(slot, 0)).toMatchObject({ scale: 1, alpha: 0 });
    expect(computeSlotTransform(slot, 1500).scale).toBeCloseTo(1.025, 6);
    expect(computeSlotTransform(slot, 2999).scale).toBeCloseTo(1.05, 3);
    expect(computeSlotTransform(slot, 250).alpha).toBe(1);
    expect(computeSlotTransform(slot, 2750).alpha).toBe(1);
    expect(computeSlotTransform(slot, 2999).alpha).toBeLessThan(0.01);
  });
  it('postcard slides up 12px-equivalent in the first 250ms, fades out in the last 250ms', () => {
    const slot = BUILTIN_TEMPLATES[1]!.slots[0]!;
    expect(computeSlotTransform(slot, 0).dy).toBeCloseTo(12 / 1280, 9);
    expect(computeSlotTransform(slot, 250).dy).toBe(0);
    expect(computeSlotTransform(slot, 1000)).toEqual({ alpha: 1, scale: 1, dx: 0, dy: 0 });
    expect(computeSlotTransform(slot, 2875).alpha).toBeCloseTo(0.5, 6);
  });
  it('contact strip enters from the right and has no exit fade', () => {
    const slot = BUILTIN_TEMPLATES[2]!.slots[0]!;
    expect(computeSlotTransform(slot, 0).dx).toBeCloseTo(0.06, 9);
    expect(computeSlotTransform(slot, 2999).alpha).toBe(1);
  });
});

describe('text visibility', () => {
  it('uses [start, end)', () => {
    const t = { startMs: 3000, endMs: 6000 };
    expect(isTextVisibleAt(t, 2999)).toBe(false);
    expect(isTextVisibleAt(t, 3000)).toBe(true);
    expect(isTextVisibleAt(t, 5999)).toBe(true);
    expect(isTextVisibleAt(t, 6000)).toBe(false);
  });
  it('normalizeTextRange enforces 0 <= start < end <= D', () => {
    expect(normalizeTextRange(-100, 20000, 15000)).toEqual({ startMs: 0, endMs: 15000 });
    expect(normalizeTextRange(5000, 5000, 15000)).toEqual({ startMs: 5000, endMs: 5100 });
    expect(normalizeTextRange(15000, 15000, 15000)).toEqual({ startMs: 14900, endMs: 15000 });
    expect(normalizeTextRange(1234, 5678, 15000)).toEqual({ startMs: 1200, endMs: 5700 });
  });
});

describe('short video policy', () => {
  it('hold keeps the last frame after the playable range', () => {
    expect(resolveVideoFrame(0, 0, 2000, 'hold')).toMatchObject({ sourceMs: 0, alpha: 1, state: 'playing' });
    expect(resolveVideoFrame(1999, 0, 2000, 'hold')).toMatchObject({ sourceMs: 1999, state: 'playing' });
    expect(resolveVideoFrame(2000, 0, 2000, 'hold')).toMatchObject({ sourceMs: 1999, alpha: 1, state: 'hold' });
    expect(resolveVideoFrame(2999, 0, 2000, 'hold')).toMatchObject({ state: 'hold' });
  });
  it('fade fades out during the last 300ms of the playable range, then background', () => {
    expect(resolveVideoFrame(1699, 0, 2000, 'fade').alpha).toBe(1);
    expect(resolveVideoFrame(1850, 0, 2000, 'fade').alpha).toBeCloseTo(0.5, 6);
    expect(resolveVideoFrame(2000, 0, 2000, 'fade')).toMatchObject({ alpha: 0, state: 'gone' });
  });
  it('uses half of the playable range when shorter than 300ms', () => {
    // 400ms source, start at 200ms -> 200ms available -> fade 100ms from local 100
    expect(resolveVideoFrame(99, 200, 400, 'fade').alpha).toBe(1);
    expect(resolveVideoFrame(150, 200, 400, 'fade').alpha).toBeCloseTo(0.5, 6);
  });
  it('long video uses sourceIn + local time only', () => {
    expect(resolveVideoFrame(2999, 5000, 20000, 'hold')).toMatchObject({ sourceMs: 7999, alpha: 1, state: 'playing' });
  });
});

describe('audio plan', () => {
  const D = 15000;
  it('longer source is cut at the video end; fade uses last 1s', () => {
    const plan = computeAudioPlan({ assetId: 'x', sourceInMs: 2000, sourceOutMs: 60000, volume: 0.7, fadeOutMs: 1000 }, D);
    expect(plan.usedMs).toBe(15000);
    expect(plan.silentTailMs).toBe(0);
    expect(plan.fade).toEqual({ startMs: 14000, endMs: 15000 });
    expect(gainAt(plan, 0)).toBeCloseTo(0.7);
    expect(gainAt(plan, 14500)).toBeCloseTo(0.35);
    expect(gainAt(plan, 15000)).toBe(0);
  });
  it('shorter source leaves a silent tail; fade ends at the source end', () => {
    const plan = computeAudioPlan({ assetId: 'x', sourceInMs: 0, sourceOutMs: 8000, volume: 1, fadeOutMs: 1000 }, D);
    expect(plan.usedMs).toBe(8000);
    expect(plan.silentTailMs).toBe(7000);
    expect(plan.fade).toEqual({ startMs: 7000, endMs: 8000 });
    expect(gainAt(plan, 7999)).toBeCloseTo(0.001, 3);
    expect(gainAt(plan, 9000)).toBe(0);
  });
  it('fade OFF keeps constant volume; segments shorter than 1s fade over their whole length', () => {
    const off = computeAudioPlan({ assetId: 'x', sourceInMs: 0, sourceOutMs: 8000, volume: 0.5, fadeOutMs: 0 }, D);
    expect(off.fade).toBeNull();
    expect(gainAt(off, 7999)).toBe(0.5);
    const short = computeAudioPlan({ assetId: 'x', sourceInMs: 0, sourceOutMs: 400, volume: 1, fadeOutMs: 1000 }, D);
    expect(short.fade).toEqual({ startMs: 0, endMs: 400 });
  });
});
