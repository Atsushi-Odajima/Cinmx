import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Template } from '@cinemix/core';
import { createProjectFromTemplate, totalDurationMs } from '@cinemix/core';
import type { TemplateListItem } from '@cinemix/platform';
import { AppHeader } from '../components/AppHeader';
import { TemplateHero } from '../components/TemplateCard';
import { Notice } from '../components/Notice';
import { projectStore } from '../services';
import { builtinMedia, resolveTemplate, toListItem } from '../services/template-catalog';
import { localTemplateStore } from '../services';
import { fmtSec } from '../services/format';

export function TemplateDetailScreen() {
  const { id } = useParams();
  const nav = useNavigate();
  const [tpl, setTpl] = useState<{ template: Template; item: TemplateListItem } | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!id) return setTpl(null);
      const r = await resolveTemplate(id);
      if (!alive) return;
      if (!r) return setTpl(null);
      let media: { coverUrl?: string; previewUrl?: string } = builtinMedia(id) ?? {};
      if (r.source === 'local' || r.source === 'imported') {
        const row = await localTemplateStore.get(id);
        if (row?.coverBlob) media = { coverUrl: URL.createObjectURL(row.coverBlob), ...(row.previewBlob ? { previewUrl: URL.createObjectURL(row.previewBlob) } : {}) };
      }
      setTpl({ template: r.template, item: toListItem(r.template, r.source, media) });
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const start = async () => {
    if (!tpl) return;
    setBusy(true);
    setError(null);
    try {
      const p = createProjectFromTemplate(tpl.template);
      await projectStore.save(p);
      nav(`/projects/${p.id}/media`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (tpl === undefined) return <main className="page"><AppHeader back="/templates" /><p className="muted">読み込み中…</p></main>;
  if (tpl === null)
    return (
      <main className="page">
        <AppHeader back="/templates" />
        <Notice kind="warning" title="テンプレートが見つかりません">同梱テンプレートは「テンプレート」から選べます。</Notice>
      </main>
    );
  const t = tpl.template;
  return (
    <main className="page">
      <AppHeader back="/templates" />
      <TemplateHero item={tpl.item} />
      <section className="detail">
        <h2>必要なもの</h2>
        <ul className="plainlist">
          <li>写真または動画 <strong className="tnum">{t.requiredAssetCount}</strong> 点（枠の数は固定です。多くても少なくても作れません）</li>
          <li>完成の長さ <strong className="tnum">{fmtSec(totalDurationMs(t), 1)}</strong> 秒 · 縦 9:16 · 720×1280</li>
          <li>文字（任意、最大 10 個）と音楽（任意、1 曲）</li>
        </ul>
        <h2>枠ごとの時間</h2>
        <ol className="slotlist tnum">
          {[...t.slots].sort((a, b) => a.index - b.index).map((s) => (
            <li key={s.id}>
              {String(s.index + 1).padStart(2, '0')} — {fmtSec(s.durationMs)} 秒
            </li>
          ))}
        </ol>
        <p className="meta">素材は端末内で処理され、動画合成のためにサーバーへ送信されません。動画素材の元の音声は使わず、音楽 1 曲だけが入ります。</p>
        {error ? <Notice kind="error" title="下書きを作成できませんでした">{error}</Notice> : null}
      </section>
      <div className="cta-bar">
        <button type="button" className="btn btn--primary btn--block" onClick={() => void start()} disabled={busy}>
          {busy ? '準備しています…' : 'このテンプレートを使う'}
        </button>
      </div>
    </main>
  );
}
