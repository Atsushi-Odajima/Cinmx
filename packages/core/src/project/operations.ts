import type { Project, SlotBinding, TextItem, AudioSettings, FontId } from '../schema/project';
import type { Template } from '../schema/template';
import type { Crop } from '../schema/common';
import { LIMITS, SCHEMA_VERSION } from '../schema/limits';
import { computeSlotRanges, totalDurationMs } from '../timeline/slots';
import { normalizeTextRange } from '../timeline/text-time';
import { newId, nowIso } from './ids';

/** テンプレートからプロジェクトを作る。テンプレートはスナップショットとして保存（作者更新で壊れない）。 */
export function createProjectFromTemplate(template: Template, title?: string): Project {
  const ts = nowIso();
  return {
    id: newId(),
    schemaVersion: SCHEMA_VERSION,
    title: title ?? template.name,
    templateSnapshot: structuredClone(template),
    slotBindings: [],
    texts: [],
    createdAt: ts,
    updatedAt: ts,
  };
}

function touch(p: Project): Project {
  return { ...p, updatedAt: nowIso() };
}

export function defaultCrop(): Crop {
  return { centerX: 0.5, centerY: 0.5, scale: LIMITS.crop.scale.default };
}

/** 枠に素材を割り当てる（差し替え） */
export function assignAsset(p: Project, slotId: string, assetId: string, kind: 'image' | 'video'): Project {
  const binding: SlotBinding = { slotId, assetId, sourceInMs: 0, crop: defaultCrop(), shortVideoPolicy: 'hold' };
  void kind;
  const others = p.slotBindings.filter((b) => b.slotId !== slotId);
  return touch({ ...p, slotBindings: [...others, binding] });
}

/** 未割当の枠に順番に素材を入れる。戻り値は入れられなかった素材 id */
export function assignAssetsInOrder(p: Project, assetIds: string[]): { project: Project; overflow: string[] } {
  const bound = new Set(p.slotBindings.map((b) => b.slotId));
  const free = [...p.templateSnapshot.slots].sort((a, b) => a.index - b.index).filter((s) => !bound.has(s.id));
  let next = p;
  const overflow: string[] = [];
  for (const [i, assetId] of assetIds.entries()) {
    const slot = free[i];
    if (!slot) {
      overflow.push(assetId);
      continue;
    }
    next = assignAsset(next, slot.id, assetId, 'image');
  }
  return { project: next, overflow };
}

export function removeBinding(p: Project, slotId: string): Project {
  return touch({ ...p, slotBindings: p.slotBindings.filter((b) => b.slotId !== slotId) });
}

/** 枠 a と枠 b の素材を入れ替える（番号付き並べ替え） */
export function swapBindings(p: Project, slotIdA: string, slotIdB: string): Project {
  if (slotIdA === slotIdB) return p;
  const a = p.slotBindings.find((b) => b.slotId === slotIdA);
  const b = p.slotBindings.find((x) => x.slotId === slotIdB);
  const rest = p.slotBindings.filter((x) => x.slotId !== slotIdA && x.slotId !== slotIdB);
  const out = [...rest];
  if (a) out.push({ ...a, slotId: slotIdB });
  if (b) out.push({ ...b, slotId: slotIdA });
  return touch({ ...p, slotBindings: out });
}

/** 枠 index を 1 つ前／後へ移動（素材だけ入れ替える。枠の時間は固定） */
export function moveBinding(p: Project, slotId: string, direction: -1 | 1): Project {
  const sorted = [...p.templateSnapshot.slots].sort((a, b) => a.index - b.index);
  const i = sorted.findIndex((s) => s.id === slotId);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= sorted.length) return p;
  return swapBindings(p, sorted[i]!.id, sorted[j]!.id);
}

export function updateBinding(p: Project, slotId: string, patch: Partial<Omit<SlotBinding, 'slotId' | 'assetId'>>): Project {
  return touch({ ...p, slotBindings: p.slotBindings.map((b) => (b.slotId === slotId ? { ...b, ...patch } : b)) });
}

export function defaultTextRangeForSlot(p: Project, slotId: string | null): { startMs: number; endMs: number } {
  const D = totalDurationMs(p.templateSnapshot);
  const ranges = computeSlotRanges(p.templateSnapshot);
  const r = slotId ? ranges.find((x) => x.slotId === slotId) : undefined;
  if (r) return { startMs: r.startMs, endMs: r.endMs };
  return { startMs: 0, endMs: D };
}

export function addText(p: Project, init: Partial<TextItem> & { value: string }, currentSlotId: string | null): { project: Project; text: TextItem } | { error: string } {
  if (p.texts.length >= LIMITS.text.maxCount) return { error: `文字は ${LIMITS.text.maxCount} 個までです` };
  const range = defaultTextRangeForSlot(p, currentSlotId);
  const zOrder = p.texts.reduce((m, t) => Math.max(m, t.zOrder), -1) + 1;
  const text: TextItem = {
    id: newId(),
    value: init.value,
    fontId: init.fontId ?? ('noto-sans-jp' satisfies FontId),
    color: init.color ?? '#FFFCF4',
    fontSizeRatio: init.fontSizeRatio ?? LIMITS.text.fontSizeRatio.default,
    lineHeight: init.lineHeight ?? LIMITS.text.lineHeight.default,
    align: init.align ?? 'center',
    centerX: init.centerX ?? 0.5,
    centerY: init.centerY ?? 0.78,
    startMs: init.startMs ?? range.startMs,
    endMs: init.endMs ?? range.endMs,
    zOrder,
    ...(init.background ? { background: init.background } : {}),
    ...(init.stroke ? { stroke: init.stroke } : {}),
  };
  return { project: touch({ ...p, texts: [...p.texts, text] }), text };
}

export function updateText(p: Project, textId: string, patch: Partial<TextItem>): Project {
  const D = totalDurationMs(p.templateSnapshot);
  return touch({
    ...p,
    texts: p.texts.map((t) => {
      if (t.id !== textId) return t;
      const next = { ...t, ...patch } as TextItem;
      if (patch.startMs !== undefined || patch.endMs !== undefined) {
        const r = normalizeTextRange(next.startMs, next.endMs, D, LIMITS.text.timeStepMs);
        next.startMs = r.startMs;
        next.endMs = r.endMs;
      }
      if (patch.background === undefined && 'background' in patch) delete (next as Partial<TextItem>).background;
      if (patch.stroke === undefined && 'stroke' in patch) delete (next as Partial<TextItem>).stroke;
      return next;
    }),
  });
}

export function removeText(p: Project, textId: string): Project {
  return touch({ ...p, texts: p.texts.filter((t) => t.id !== textId) });
}

/** 文字同士の前面／背面（zOrder を隣と入れ替える） */
export function reorderText(p: Project, textId: string, direction: 'forward' | 'backward'): Project {
  const sorted = [...p.texts].sort((a, b) => a.zOrder - b.zOrder);
  const i = sorted.findIndex((t) => t.id === textId);
  const j = direction === 'forward' ? i + 1 : i - 1;
  if (i < 0 || j < 0 || j >= sorted.length) return p;
  const a = sorted[i]!;
  const b = sorted[j]!;
  const za = a.zOrder;
  const zb = b.zOrder;
  return touch({ ...p, texts: p.texts.map((t) => (t.id === a.id ? { ...t, zOrder: zb } : t.id === b.id ? { ...t, zOrder: za } : t)) });
}

export function setAudio(p: Project, audio: AudioSettings | undefined): Project {
  const next = { ...p };
  if (audio) next.audio = audio;
  else delete next.audio;
  return touch(next);
}

/** 動画総時間が変わったとき、文字の時間を [0,D] に収める（テンプレ変更・枠秒数変更後も壊れない） */
export function clampTextsToDuration(p: Project): Project {
  const D = totalDurationMs(p.templateSnapshot);
  let changed = false;
  const texts = p.texts.map((t) => {
    const r = normalizeTextRange(t.startMs, t.endMs, D, LIMITS.text.timeStepMs);
    if (r.startMs !== t.startMs || r.endMs !== t.endMs) {
      changed = true;
      return { ...t, ...r };
    }
    return t;
  });
  return changed ? touch({ ...p, texts }) : p;
}

/** 背景画像を差し替える（テンプレートスナップショットのみ変更。文字・素材は保持） */
export function setBackground(p: Project, backgroundAssetId: string | undefined, transform?: Crop): Project {
  const snap = { ...p.templateSnapshot };
  if (backgroundAssetId) snap.backgroundAssetId = backgroundAssetId;
  else delete snap.backgroundAssetId;
  if (transform) snap.backgroundTransform = transform;
  return touch({ ...p, templateSnapshot: snap });
}

export function setTitle(p: Project, title: string): Project {
  return touch({ ...p, title: title.slice(0, 80) });
}

/** 使用中の素材 id 一覧 */
export function referencedAssetIds(p: Project): Set<string> {
  const ids = new Set<string>();
  for (const b of p.slotBindings) ids.add(b.assetId);
  if (p.audio) ids.add(p.audio.assetId);
  if (p.templateSnapshot.backgroundAssetId) ids.add(p.templateSnapshot.backgroundAssetId);
  return ids;
}
