import type { Project } from './project';
import type { Asset } from './asset';
import { projectSchema } from './project';
import { templateSchema } from './template';
import { computeSlotRanges, totalDurationMs } from '../timeline/slots';

export type ValidationIssue = { path: string; message: string; severity: 'error' | 'warning' };

export type ProjectValidationResult = { ok: boolean; issues: ValidationIssue[] };

/**
 * JSON の構造検証（Zod）に加えて、参照整合性・期間整合性を検査する。
 * assets は参照確認に使う（省略時は参照確認をスキップ）。
 */
export function validateProject(input: unknown, assets?: ReadonlyMap<string, Asset>): ProjectValidationResult {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message, severity: 'error' as const })),
    };
  }
  const p = parsed.data;
  const issues: ValidationIssue[] = [];
  const D = totalDurationMs(p.templateSnapshot);
  const ranges = computeSlotRanges(p.templateSnapshot);
  const slotIds = new Set(ranges.map((r) => r.slotId));

  const seenSlots = new Set<string>();
  for (const [i, b] of p.slotBindings.entries()) {
    if (!slotIds.has(b.slotId)) issues.push({ path: `slotBindings.${i}.slotId`, message: '存在しない枠を参照しています', severity: 'error' });
    if (seenSlots.has(b.slotId)) issues.push({ path: `slotBindings.${i}.slotId`, message: '同じ枠に複数の素材が割り当てられています', severity: 'error' });
    seenSlots.add(b.slotId);
    if (assets && !assets.has(b.assetId)) issues.push({ path: `slotBindings.${i}.assetId`, message: '素材が見つかりません', severity: 'error' });
    const a = assets?.get(b.assetId);
    if (a && a.kind === 'audio') issues.push({ path: `slotBindings.${i}.assetId`, message: '音声素材は枠に割り当てられません', severity: 'error' });
    if (a && a.kind === 'video' && a.durationMs !== undefined && b.sourceInMs >= a.durationMs) {
      issues.push({ path: `slotBindings.${i}.sourceInMs`, message: '開始位置が動画の長さを超えています', severity: 'error' });
    }
  }

  for (const [i, t] of p.texts.entries()) {
    if (t.endMs > D) issues.push({ path: `texts.${i}.endMs`, message: '終了時刻が動画の総時間を超えています', severity: 'error' });
    if (t.startMs >= D) issues.push({ path: `texts.${i}.startMs`, message: '開始時刻が動画の総時間以上です', severity: 'error' });
  }

  if (p.audio) {
    if (assets && !assets.has(p.audio.assetId)) issues.push({ path: 'audio.assetId', message: '音源が見つかりません', severity: 'error' });
    const a = assets?.get(p.audio.assetId);
    if (a && a.kind !== 'audio') issues.push({ path: 'audio.assetId', message: '音源の種類が不正です', severity: 'error' });
    if (a?.durationMs !== undefined && p.audio.sourceOutMs > a.durationMs) {
      issues.push({ path: 'audio.sourceOutMs', message: '終了位置が音源の長さを超えています', severity: 'error' });
    }
  }

  if (p.templateSnapshot.backgroundAssetId && assets && !assets.has(p.templateSnapshot.backgroundAssetId)) {
    issues.push({ path: 'templateSnapshot.backgroundAssetId', message: '背景画像が見つかりません', severity: 'warning' });
  }

  return { ok: issues.every((i) => i.severity !== 'error'), issues };
}

export function validateTemplate(input: unknown): { ok: boolean; issues: ValidationIssue[] } {
  const parsed = templateSchema.safeParse(input);
  if (parsed.success) return { ok: true, issues: [] };
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message, severity: 'error' as const })),
  };
}

export function isProjectComplete(p: Project): { complete: boolean; missing: number } {
  const bound = new Set(p.slotBindings.map((b) => b.slotId));
  const missing = p.templateSnapshot.slots.filter((s) => !bound.has(s.id)).length;
  return { complete: missing === 0, missing };
}
