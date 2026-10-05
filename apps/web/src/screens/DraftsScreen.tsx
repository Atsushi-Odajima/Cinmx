import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { nowIso, newId, type Project } from '@cinemix/core';
import { buildProjectBackup, readProjectBackup, type ProjectSummary, type QuarantineRow, StorageError, PROJECT_BACKUP_EXTENSION } from '@cinemix/storage';
import { AppHeader } from '../components/AppHeader';
import { Notice } from '../components/Notice';
import { assetStore, projectStore, shareAdapter } from '../services';
import { fmtDateTime, fmtSec } from '../services/format';

export function DraftsScreen() {
  const nav = useNavigate();
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [quarantine, setQuarantine] = useState<QuarantineRow[]>([]);
  const [msg, setMsg] = useState<{ kind: 'info' | 'success' | 'warning' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    setList(await projectStore.list());
    setQuarantine(await projectStore.listQuarantine());
  };
  useEffect(() => void reload(), []);

  const duplicate = async (id: string) => {
    setBusy(id);
    try {
      const r = await projectStore.load(id);
      if (r.status !== 'ok') throw new Error('下書きを開けません');
      const copy: Project = { ...r.project, id: newId(), title: `${r.project.title} のコピー`, createdAt: nowIso(), updatedAt: nowIso() };
      await projectStore.save(copy);
      await reload();
      setMsg({ kind: 'success', text: '複製しました。' });
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('この下書きを削除しますか？この操作は取り消せません。')) return;
    setBusy(id);
    try {
      await projectStore.delete(id);
      await projectStore.collectOrphanAssets();
      await reload();
      setMsg({ kind: 'success', text: '削除しました。' });
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const backup = async (id: string) => {
    setBusy(id);
    try {
      const r = await projectStore.load(id);
      if (r.status !== 'ok') throw new Error('下書きを開けません');
      const ids = new Set<string>([...r.project.slotBindings.map((b) => b.assetId), ...(r.project.audio ? [r.project.audio.assetId] : []), ...(r.project.templateSnapshot.backgroundAssetId ? [r.project.templateSnapshot.backgroundAssetId] : [])]);
      const assets = [];
      for (const aid of ids) {
        const meta = await assetStore.get(aid);
        const blob = await assetStore.getBlob(aid);
        if (meta && blob) assets.push({ meta, blob });
      }
      if (!confirm('バックアップには、あなたの写真・動画・音楽（私的素材）がそのまま含まれます。書き出しますか？')) return;
      const zip = await buildProjectBackup({ project: r.project, assets });
      const name = `${r.project.title || 'cinemix'}${PROJECT_BACKUP_EXTENSION}`.replace(/[\\/:*?"<>|]/g, '_');
      const file = new File([zip], name, { type: 'application/zip' });
      if (shareAdapter.canShare(file)) {
        const out = await shareAdapter.shareFile(file, 'CinemiX バックアップ');
        if (out === 'unsupported' || out === 'failed') shareAdapter.download(zip, name);
      } else shareAdapter.download(zip, name);
      setMsg({ kind: 'success', text: `バックアップを書き出しました（${name}）。` });
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const restore = async (file: File) => {
    setBusy('restore');
    try {
      const contents = readProjectBackup(new Uint8Array(await file.arrayBuffer()));
      for (const a of contents.assets) await assetStore.putWithId(a.meta, new Blob([a.data as BlobPart], { type: a.meta.mime }));
      const existing = await projectStore.load(contents.project.id);
      const project = existing.status === 'ok' ? { ...contents.project, id: newId(), title: `${contents.project.title}（復元）` } : contents.project;
      await projectStore.save(project);
      await reload();
      setMsg({ kind: contents.warnings.length ? 'warning' : 'success', text: `復元しました。${contents.warnings.join(' ')}` });
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof StorageError ? e.message : `復元できません: ${(e as Error).message}` });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <main className="page">
      <AppHeader back="/templates" title="下書き" />
      <h1>下書き</h1>
      <p className="meta">下書きはこの端末のブラウザ内に保存されます。Safari のデータ削除やプライベートブラウズでは消えることがあります。大切な作品はバックアップしてください。</p>
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
      {list === null ? <p className="muted">読み込み中…</p> : null}
      {list && list.length === 0 ? (
        <div className="empty">
          <p>まだ下書きがありません</p>
          <Link to="/templates" className="btn btn--primary">テンプレートを選ぶ</Link>
        </div>
      ) : null}
      <ul className="drafts">
        {list?.map((d) => (
          <li key={d.id} className="draft">
            <button type="button" className="draft__main" onClick={() => nav(`/projects/${d.id}/${d.complete ? 'edit' : 'media'}`)}>
              <strong>{d.title || '（無題）'}</strong>
              <span className="meta">
                {d.templateName} · <span className="tnum">{fmtSec(d.durationMs, 0)}</span> 秒 · {d.complete ? '素材そろい' : '素材が足りません'}
              </span>
              <span className="meta tnum">更新 {fmtDateTime(d.updatedAt)}</span>
            </button>
            <div className="draft__actions">
              <button type="button" className="btn btn--small" onClick={() => nav(`/projects/${d.id}/${d.complete ? 'edit' : 'media'}`)}>再開</button>
              <button type="button" className="btn btn--small" onClick={() => void duplicate(d.id)} disabled={busy === d.id}>複製</button>
              <button type="button" className="btn btn--small" onClick={() => void backup(d.id)} disabled={busy === d.id}>バックアップ</button>
              <button type="button" className="btn btn--small btn--danger" onClick={() => void remove(d.id)} disabled={busy === d.id}>削除</button>
            </div>
          </li>
        ))}
      </ul>
      {quarantine.length > 0 ? (
        <section>
          <h2>隔離した下書き</h2>
          <p className="meta">読み込めなかったデータです。他の下書きには影響しません。</p>
          <ul className="drafts">
            {quarantine.map((q) => (
              <li key={q.id} className="draft">
                <div className="draft__main">
                  <strong>{q.id.slice(0, 8)}…</strong>
                  <span className="meta">{q.reason}</span>
                </div>
                <div className="draft__actions">
                  <button type="button" className="btn btn--small btn--danger" onClick={() => void projectStore.deleteQuarantine(q.id).then(reload)}>削除</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="restore">
        <h2>バックアップから復元</h2>
        <input ref={fileRef} data-testid="restore-input" type="file" accept=".zip,application/zip" className="visually-hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void restore(f); }} />
        <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={busy === 'restore'}>
          {busy === 'restore' ? '復元しています…' : '.cinemix-project.zip を選ぶ'}
        </button>
      </section>
    </main>
  );
}
