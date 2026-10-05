import type { ReactNode } from 'react';

export function Notice({ kind, title, children, actions }: { kind: 'info' | 'success' | 'warning' | 'error'; title?: string; children?: ReactNode; actions?: ReactNode }) {
  const icon = kind === 'error' ? '✕' : kind === 'warning' ? '!' : kind === 'success' ? '✓' : 'i';
  const label = kind === 'error' ? 'エラー' : kind === 'warning' ? '注意' : kind === 'success' ? '完了' : '情報';
  return (
    <div className={`notice notice--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span className="notice__icon" aria-label={label}>
        {icon}
      </span>
      <div className="notice__body">
        {title ? <strong className="notice__title">{title}</strong> : null}
        {children ? <div className="notice__text">{children}</div> : null}
        {actions ? <div className="notice__actions">{actions}</div> : null}
      </div>
    </div>
  );
}
