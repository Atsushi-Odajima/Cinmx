import type { MeasureFactory } from '@cinemix/core';

let shared: CanvasRenderingContext2D | null = null;

/** 表示と出力で共通の measureText。 */
export function getMeasureFactory(): MeasureFactory {
  if (!shared) {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D を初期化できません');
    shared = ctx;
  }
  const ctx = shared;
  return (font: string) => (text: string) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
}
