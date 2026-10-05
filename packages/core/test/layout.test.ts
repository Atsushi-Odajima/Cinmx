import { describe, it, expect } from 'vitest';
import { layoutText, clampTextCenter, computeCoverSourceRect, clampCropCenter, canvasFontString, containsEmoji, containsNonLatin } from '../src';

/** 等幅の疑似 measure: 和文 20px / 欧文 10px / 空白 5px */
const measure = (s: string) => [...s].reduce((w, ch) => w + (/[　-鿿]/.test(ch) ? 20 : ch === ' ' ? 5 : 10), 0);

describe('layoutText', () => {
  it('respects explicit line breaks', () => {
    const l = layoutText('ab\ncd', measure, 1000, 40, 1.3);
    expect(l.lines.map((x) => x.text)).toEqual(['ab', 'cd']);
    expect(l.height).toBeCloseTo(40 * 1.3 * 2);
    expect(l.width).toBe(20);
  });
  it('wraps Japanese per character and Latin per word', () => {
    const jp = layoutText('あいうえおかきくけこ', measure, 100, 40, 1.3); // 5 chars per line
    expect(jp.lines.map((x) => x.text)).toEqual(['あいうえお', 'かきくけこ']);
    const en = layoutText('hello brave new world', measure, 120, 40, 1.3);
    expect(en.lines.map((x) => x.text)).toEqual(['hello brave', 'new world']);
  });
  it('mixed cursive Latin + Japanese keeps order and breaks safely', () => {
    const l = layoutText('Summer 夏の記録', measure, 150, 40, 1.3);
    expect(l.lines.map((x) => x.text).join('')).toBe('Summer 夏の記録'.replace(/ (?=夏)/, ' '));
    expect(l.lines.length).toBeGreaterThanOrEqual(1);
    for (const line of l.lines) expect(measure(line.text)).toBeLessThanOrEqual(150);
  });
  it('splits an overlong Latin word per character instead of overflowing', () => {
    const l = layoutText('abcdefghijklmnop', measure, 50, 40, 1.3);
    for (const line of l.lines) expect(measure(line.text)).toBeLessThanOrEqual(50);
    expect(l.lines.map((x) => x.text).join('')).toBe('abcdefghijklmnop');
  });
  it('does not start a line with a Japanese closing punctuation', () => {
    const l = layoutText('あいうえお。', measure, 100, 40, 1.3);
    expect(l.lines[0]!.text).toBe('あいうえお。');
  });
});

describe('clampTextCenter', () => {
  it('keeps the bounding box inside the canvas', () => {
    expect(clampTextCenter(0, 0, 200, 100, 720, 1280)).toEqual({ centerX: 100 / 720, centerY: 50 / 1280 });
    expect(clampTextCenter(1, 1, 200, 100, 720, 1280)).toEqual({ centerX: 1 - 100 / 720, centerY: 1 - 50 / 1280 });
    expect(clampTextCenter(0.5, 0.5, 200, 100, 720, 1280)).toEqual({ centerX: 0.5, centerY: 0.5 });
  });
  it('a box wider than the canvas is centered', () => {
    expect(clampTextCenter(0.1, 0.5, 5000, 100, 720, 1280).centerX).toBe(0.5);
  });
});

describe('cover crop', () => {
  it('scale 1 covers the destination; no empty area when focus is at the edge', () => {
    const r = computeCoverSourceRect(4000, 3000, 720, 1280, { centerX: 0, centerY: 0.5, scale: 1 });
    expect(r.sh).toBeCloseTo(3000);
    expect(r.sw).toBeCloseTo((720 / 1280) * 3000);
    expect(r.sx).toBe(0);
  });
  it('scale 3 uses a third of the cover region and clamps the center', () => {
    const c = clampCropCenter(4000, 3000, 720, 1280, { centerX: 1, centerY: 1, scale: 3 });
    expect(c.centerX).toBeLessThan(1);
    expect(c.centerY).toBeLessThan(1);
    const r = computeCoverSourceRect(4000, 3000, 720, 1280, c);
    expect(r.sx + r.sw).toBeLessThanOrEqual(4000 + 1e-6);
    expect(r.sy + r.sh).toBeLessThanOrEqual(3000 + 1e-6);
    expect(r.sh).toBeCloseTo(1000);
  });
});

describe('fonts', () => {
  it('font string is weight + px + stack; cursive falls back to Noto Sans JP', () => {
    expect(canvasFontString('caveat', 39.6)).toBe('700 39.6px "Caveat", "Noto Sans JP", sans-serif');
    expect(canvasFontString('noto-serif-jp', 40)).toContain('"Noto Serif JP"');
  });
  it('detects emoji and non-latin text', () => {
    expect(containsEmoji('夏の記録')).toBe(false);
    expect(containsEmoji('夏 ☀️')).toBe(true);
    expect(containsNonLatin('Summer')).toBe(false);
    expect(containsNonLatin('Summer 夏')).toBe(true);
  });
});
