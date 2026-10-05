import type { FontId } from '../schema/project';

export type FontDefinition = {
  id: FontId;
  label: string;
  /** 利用者向けの注記 */
  note: string;
  family: string;
  /** canvas / CSS で使うフォントスタック。欧文筆記体は和文を Noto Sans JP へ文字単位でフォールバック */
  cssStack: string;
  weight: 400 | 600 | 700;
  script: 'jp' | 'latin';
  license: 'OFL-1.1';
};

export const FONT_CATALOG: readonly FontDefinition[] = [
  { id: 'noto-sans-jp', label: 'Noto Sans JP（ゴシック）', note: '日本語・欧文・数字', family: 'Noto Sans JP', cssStack: '"Noto Sans JP", sans-serif', weight: 700, script: 'jp', license: 'OFL-1.1' },
  { id: 'noto-serif-jp', label: 'Noto Serif JP（明朝）', note: '日本語・欧文・数字', family: 'Noto Serif JP', cssStack: '"Noto Serif JP", "Noto Sans JP", serif', weight: 600, script: 'jp', license: 'OFL-1.1' },
  { id: 'caveat', label: 'Caveat（欧文筆記体）', note: '欧文用。日本語は Noto Sans JP で表示', family: 'Caveat', cssStack: '"Caveat", "Noto Sans JP", sans-serif', weight: 700, script: 'latin', license: 'OFL-1.1' },
  { id: 'allura', label: 'Allura（欧文筆記体）', note: '欧文用。日本語は Noto Sans JP で表示', family: 'Allura', cssStack: '"Allura", "Noto Sans JP", sans-serif', weight: 400, script: 'latin', license: 'OFL-1.1' },
];

export function getFont(id: FontId): FontDefinition {
  const f = FONT_CATALOG.find((x) => x.id === id);
  if (!f) throw new Error(`unknown font: ${id}`);
  return f;
}

/** canvas の ctx.font 文字列。表示と出力で同じ関数を使う。 */
export function canvasFontString(fontId: FontId, px: number): string {
  const f = getFont(fontId);
  return `${f.weight} ${Math.max(1, Math.round(px * 100) / 100)}px ${f.cssStack}`;
}

/** 絵文字（試作では非対応）を含むか。黙って欠落させず入力時に明示する。 */
export function containsEmoji(value: string): boolean {
  return /\p{Extended_Pictographic}/u.test(value);
}

/** 欧文筆記体フォントで表示した場合に、Noto Sans JP へフォールバックする文字を含むか */
export function containsNonLatin(value: string): boolean {
  return /[^\u0000-ɏ -⁯₠-⃏\s]/u.test(value);
}
