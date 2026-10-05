import { FONT_CATALOG, canvasFontString, getFont, type FontId } from '@cinemix/core';

export type FontLoadResult = { ok: boolean; failed: { fontId: FontId; reason: string }[] };

/** 文字列に欧文（ASCII/ラテン）が含まれるか */
function hasLatin(text: string): boolean {
  return /[A-Za-z0-9]/.test(text);
}
function hasJapanese(text: string): boolean {
  return /[　-ヿ㐀-䶿一-鿿＀-￯]/.test(text);
}

function loadedFacesFor(family: string): FontFace[] {
  const out: FontFace[] = [];
  document.fonts.forEach((f) => {
    if (f.family.replace(/["']/g, '') === family && f.status === 'loaded') out.push(f);
  });
  return out;
}

/**
 * 出力前に必要なフォントの読み込みを待つ。読み込み失敗は失敗として返す（黙って代替しない）。
 * 表示と出力で同じファイル（public/fonts）を使う。
 */
export async function ensureFontsLoaded(items: { fontId: FontId; text: string }[]): Promise<FontLoadResult> {
  if (typeof document === 'undefined' || !('fonts' in document)) return { ok: false, failed: items.map((i) => ({ fontId: i.fontId, reason: 'FontFace API が使えません' })) };
  const failed: { fontId: FontId; reason: string }[] = [];
  const byFont = new Map<FontId, string>();
  for (const it of items) byFont.set(it.fontId, (byFont.get(it.fontId) ?? '') + it.text);

  for (const [fontId, text] of byFont) {
    const def = getFont(fontId);
    const sample = text.trim().length > 0 ? text : 'Aa あ';
    try {
      await document.fonts.load(canvasFontString(fontId, 32), sample);
      // 筆記体は和文を Noto Sans JP へフォールバックするので、その分も読む
      if (def.script === 'latin' && hasJapanese(sample)) await document.fonts.load('700 32px "Noto Sans JP"', sample);
      if (def.script === 'latin' && !hasLatin(sample)) continue; // 筆記体で欧文が無ければ本体は不要
      const faces = loadedFacesFor(def.family);
      if (faces.length === 0) failed.push({ fontId, reason: `${def.family} を読み込めませんでした（通信状態を確認して再試行してください）` });
    } catch (e) {
      failed.push({ fontId, reason: `${def.family} の読み込みに失敗: ${(e as Error)?.message ?? String(e)}` });
    }
  }
  return { ok: failed.length === 0, failed };
}

/** UI 表示用（フォント選択のプレビュー）に全書体をまとめて先読みする。失敗は無視せず返す。 */
export async function preloadCatalog(sample = 'Summer 夏の記録 2026'): Promise<FontLoadResult> {
  return ensureFontsLoaded(FONT_CATALOG.map((f) => ({ fontId: f.id, text: sample })));
}
