import type { AutosaveStatus } from '@cinemix/storage';

export function SaveStatus({ status, onRetry }: { status: AutosaveStatus; onRetry: () => void }) {
  if (status.state === 'error') {
    return (
      <span className="save-status save-status--error" role="alert">
        保存できません
        <button type="button" className="btn btn--small btn--ghost" onClick={onRetry}>
          再試行
        </button>
      </span>
    );
  }
  const label = status.state === 'saved' ? '保存済み' : status.state === 'saving' || status.state === 'pending' ? '保存中…' : '';
  return (
    <span className="save-status" aria-live="polite">
      {label}
    </span>
  );
}
