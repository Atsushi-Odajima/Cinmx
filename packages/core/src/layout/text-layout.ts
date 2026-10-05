import type { TextItem } from '../schema/project';
import { LIMITS } from '../schema/limits';

export type MeasureFn = (text: string) => number;

export type LaidOutLine = { text: string; width: number };
export type TextLayout = {
  lines: LaidOutLine[];
  /** 最大行幅（px） */
  width: number;
  /** 行数 × 行送り（px） */
  height: number;
  fontPx: number;
  linePx: number;
};

const CJK = /[　-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/;
// 行頭禁則（簡易）
const NO_LINE_START = /^[、。，．・：；！？）」』】〕〉》］｝ー〜々ぁぃぅぇぉっゃゅょァィゥェォッャュョ]/;

/**
 * 共通の改行計算。明示改行を尊重し、各段落を maxWidthPx に収まるよう折り返す。
 * 欧文は単語単位、和文は文字単位で折り返す。表示と出力で同じ関数・同じ measure を使う。
 */
export function layoutText(value: string, measure: MeasureFn, maxWidthPx: number, fontPx: number, lineHeight: number): TextLayout {
  const paragraphs = value.replace(/\r\n?/g, '\n').split('\n');
  const lines: LaidOutLine[] = [];
  for (const para of paragraphs) {
    if (para.length === 0) {
      lines.push({ text: '', width: 0 });
      continue;
    }
    for (const line of wrapParagraph(para, measure, maxWidthPx)) lines.push({ text: line, width: measure(line) });
  }
  const linePx = fontPx * lineHeight;
  const width = lines.reduce((m, l) => Math.max(m, l.width), 0);
  return { lines, width, height: linePx * lines.length, fontPx, linePx };
}

function tokenize(para: string): string[] {
  // 欧文単語（+後続空白）と和文1文字を混在トークン化
  const tokens: string[] = [];
  let buf = '';
  for (const ch of para) {
    if (CJK.test(ch)) {
      if (buf) {
        tokens.push(buf);
        buf = '';
      }
      tokens.push(ch);
    } else if (ch === ' ') {
      buf += ch;
      tokens.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf) tokens.push(buf);
  return tokens;
}

function wrapParagraph(para: string, measure: MeasureFn, maxWidthPx: number): string[] {
  const out: string[] = [];
  let line = '';
  const trimmed = (s: string) => s.replace(/\s+$/, '');
  const push = () => {
    out.push(trimmed(line));
    line = '';
  };
  const isLatinWord = (t: string) => !CJK.test(t) && [...trimmed(t)].length > 1;
  /** 行頭に token を置く。長い欧文単語は文字単位で分割する。 */
  const startLineWith = (token: string) => {
    if (measure(trimmed(token)) > maxWidthPx && isLatinWord(token)) {
      for (const ch of token) {
        if (line !== '' && measure(trimmed(line + ch)) > maxWidthPx) push();
        line += ch;
      }
    } else {
      line = token;
    }
  };
  for (const token of tokenize(para)) {
    if (line === '') {
      startLineWith(token);
    } else if (measure(trimmed(line + token)) <= maxWidthPx || NO_LINE_START.test(token)) {
      line += token;
    } else {
      push();
      startLineWith(token);
    }
  }
  if (line !== '' || out.length === 0) push();
  return out;
}

export type TextBox = { x: number; y: number; w: number; h: number };

/** 文字の px サイズは動画幅比。fontSizeRatio × 動画幅。 */
export function textFontPx(text: Pick<TextItem, 'fontSizeRatio'>, canvasWidth: number): number {
  return text.fontSizeRatio * canvasWidth;
}

export function textMaxWidthPx(canvasWidth: number): number {
  return canvasWidth * LIMITS.text.maxWidthRatio;
}

/**
 * バウンディングボックスがキャンバス内に完全に収まるように中心をクランプする。
 * 動画の外に完全に消える配置は禁止（SNS セーフエリアはガイドのみ）。
 */
export function clampTextCenter(
  centerX: number,
  centerY: number,
  boxW: number,
  boxH: number,
  canvasW: number,
  canvasH: number,
): { centerX: number; centerY: number } {
  const halfW = Math.min(boxW / 2 / canvasW, 0.5);
  const halfH = Math.min(boxH / 2 / canvasH, 0.5);
  return {
    centerX: Math.min(Math.max(centerX, halfW), 1 - halfW),
    centerY: Math.min(Math.max(centerY, halfH), 1 - halfH),
  };
}

export function textBoxPx(text: Pick<TextItem, 'centerX' | 'centerY'>, layout: TextLayout, canvasW: number, canvasH: number, padPx = 0): TextBox {
  const w = layout.width + padPx * 2;
  const h = layout.height + padPx * 2;
  return { x: text.centerX * canvasW - w / 2, y: text.centerY * canvasH - h / 2, w, h };
}
