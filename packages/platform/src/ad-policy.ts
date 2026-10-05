/**
 * 広告表示の判断（将来仕様 10 章）。試作では端末ローカル日付・端末間同期なし。
 * - 書き出し待ち広告と日3回目の全画面広告は同じ回に重複させない
 * - 同一ジョブの再試行で再表示しない
 * - 500円契約者は全枠非表示
 */
export type AdDecisionInput = {
  adFree: boolean;
  /** 本日（端末ローカル日付）成功した書き出し回数 */
  successfulExportsToday: number;
  jobId: string;
  /** 既に広告を表示したジョブ id */
  shownJobIds: ReadonlySet<string>;
};

export type AdDecision = { placement: 'none' } | { placement: 'export-wait' } | { placement: 'daily-third-interstitial' };

export function decideExportAd(input: AdDecisionInput): AdDecision {
  if (input.adFree) return { placement: 'none' };
  if (input.shownJobIds.has(input.jobId)) return { placement: 'none' };
  // 3回目の試行の前に表示する場合: 既に 2 回成功していれば今回が 3 回目
  if (input.successfulExportsToday === 2) return { placement: 'daily-third-interstitial' };
  return { placement: 'export-wait' };
}

export function localDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
