import { Link, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';

export function AppHeader({ back, title, right }: { back?: string | (() => void) | undefined; title?: string | undefined; right?: ReactNode }) {
  const nav = useNavigate();
  return (
    <header className="app-header">
      <div className="app-header__left">
        {back !== undefined ? (
          <button type="button" className="btn btn--ghost btn--icon" aria-label="戻る" onClick={() => (typeof back === 'function' ? back() : nav(back))}>
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M14 4 7 11l7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        ) : null}
        <Link to="/templates" className="wordmark" aria-label="CinemiX トップへ">
          Cinemi<span className="wordmark__x">X</span>
        </Link>
        {title ? <span className="app-header__title">{title}</span> : null}
      </div>
      <div className="app-header__right">{right}</div>
    </header>
  );
}
