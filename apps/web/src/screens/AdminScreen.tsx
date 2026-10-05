import { useEffect, useState } from 'react';
import type { RemoteTemplateRow } from '@cinemix/platform';
import { AppHeader } from '../components/AppHeader';
import { Notice } from '../components/Notice';
import { cloudClient, cloudTemplates } from '../services';

export function AdminScreen() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [pending, setPending] = useState<RemoteTemplateRow[]>([]);
  const [reports, setReports] = useState<{ id: string; template_id: string; reason: string; detail: string; created_at: string; status: string }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = async () => {
    if (!cloudTemplates) return;
    setPending(await cloudTemplates.listPending());
    setReports(await cloudTemplates.listReports().catch(() => []));
  };
  useEffect(() => {
    if (!cloudClient) return setAllowed(false);
    void cloudClient.isAdmin().then((ok) => {
      setAllowed(ok);
      if (ok) void reload();
    });
  }, []);

  if (allowed === null) return <main className="page"><AppHeader back="/account" title="管理" /><p className="muted">権限を確認しています…</p></main>;
  if (!allowed)
    return (
      <main className="page">
        <AppHeader back="/account" title="管理" />
        <Notice kind="warning" title="権限がありません">管理者ロールはサーバー側（profiles.role）で確認します。クライアントからは変更できません。</Notice>
      </main>
    );
  return (
    <main className="page">
      <AppHeader back="/account" title="管理" />
      <h1 className="h2">公開申請の審査</h1>
      {msg ? <Notice kind="info">{msg}</Notice> : null}
      {pending.length === 0 ? <p className="meta">審査待ちはありません。</p> : null}
      <ul className="drafts">
        {pending.map((t) => (
          <li key={t.id} className="draft">
            <div className="draft__main">
              <strong>{t.name}</strong>
              <span className="meta">{t.description}</span>
              <span className="meta tnum">v{t.version} · {t.visibility} · 作者 {t.owner_id.slice(0, 8)}…</span>
            </div>
            <div className="draft__actions">
              <button type="button" className="btn btn--small btn--primary" onClick={() => void cloudTemplates?.moderate(t.id, 'approved', '').then(() => { setMsg('承認しました'); void reload(); })}>承認</button>
              <button type="button" className="btn btn--small btn--danger" onClick={() => { const note = prompt('却下理由'); if (note !== null) void cloudTemplates?.moderate(t.id, 'rejected', note).then(() => { setMsg('却下しました'); void reload(); }); }}>却下</button>
            </div>
          </li>
        ))}
      </ul>
      <h2>通報</h2>
      {reports.length === 0 ? <p className="meta">通報はありません。</p> : null}
      <ul className="drafts">
        {reports.map((r) => (
          <li key={r.id} className="draft">
            <div className="draft__main">
              <strong>{r.reason}</strong>
              <span className="meta">{r.detail}</span>
              <span className="meta tnum">テンプレート {r.template_id.slice(0, 8)}… · {r.status} · {r.created_at}</span>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
