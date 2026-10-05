import type { Project, TextItem } from '../schema/project';
import type { Template } from '../schema/template';
import { LIMITS } from '../schema/limits';
import { computeSlotRanges, totalDurationMs, type SlotRange } from '../timeline/slots';
import { canvasFontString } from '../layout/fonts';
import { layoutText, textFontPx, textMaxWidthPx, type MeasureFn, type TextLayout } from '../layout/text-layout';

export type TextPlan = { text: TextItem; layout: TextLayout; font: string; padPx: number; strokePx: number };

export type RenderPlan = {
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  template: Template;
  ranges: SlotRange[];
  bindings: Map<string, Project['slotBindings'][number]>;
  texts: TextPlan[];
};

export type MeasureFactory = (font: string) => MeasureFn;

/**
 * 描画計画を事前計算する。文字の改行は共通 layout 関数で確定し、行配列を保持する。
 * measureFor(font) は canvas の measureText を返す（表示と出力で同じもの）。
 */
export function buildRenderPlan(project: Project, measureFor: MeasureFactory, size = LIMITS.canvas): RenderPlan {
  const W = size.width;
  const H = size.height;
  const template = project.templateSnapshot;
  const texts = [...project.texts]
    .sort((a, b) => a.zOrder - b.zOrder)
    .map((text) => {
      const fontPx = textFontPx(text, W);
      const font = canvasFontString(text.fontId, fontPx);
      const measure = measureFor(font);
      const layout = layoutText(text.value, measure, textMaxWidthPx(W), fontPx, text.lineHeight);
      const padPx = text.background ? text.background.paddingRatio * W : 0;
      const strokePx = text.stroke ? text.stroke.widthRatio * W : 0;
      return { text, layout, font, padPx, strokePx };
    });
  return {
    width: W,
    height: H,
    fps: size.fps,
    durationMs: totalDurationMs(template),
    template,
    ranges: computeSlotRanges(template),
    bindings: new Map(project.slotBindings.map((b) => [b.slotId, b])),
    texts,
  };
}
