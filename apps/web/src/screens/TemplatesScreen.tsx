import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { TemplateListItem } from '@cinemix/platform';
import { AppHeader } from '../components/AppHeader';
import { TemplateCard, TemplateHero } from '../components/TemplateCard';
import { Notice } from '../components/Notice';
import { loadCatalog } from '../services/template-catalog';

export function TemplatesScreen() {
  const [items, setItems] = useState<TemplateListItem[] | null>(null);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [onlineConfigured, setOnlineConfigured] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    loadCatalog().then((r) => {
      if (!alive) return;
      setItems(r.items);
      setOnlineError(r.onlineError);
      setOnlineConfigured(r.onlineConfigured);
    });
    return () => {
      alive = false;
    };
  }, [tick]);

  const hero = items?.[0];
  const rest = items?.slice(1) ?? [];
  return (
    <main className="page page--list">
      <AppHeader
        right={
          <nav className="topnav" aria-label="主な入口">
            <Link to="/templates" aria-current="page">テンプレート</Link>
            <Link to="/drafts">下書き</Link>
            <Link to="/creator">作る</Link>
          </nav>
        }
      />
      <section className="intro">
        <h1 className="intro__title">写真を選んで、見本のような動画に。</h1>
        <p className="intro__sub">テンプレートを選ぶ。素材を並べる。文字と音楽で仕上げる。</p>
      </section>
      {items === null ? <p className="muted">テンプレートを読み込んでいます…</p> : null}
      {hero ? <TemplateHero item={hero} /> : null}
      {onlineError ? (
        <Notice kind="warning" title="オンラインのテンプレートを読み込めませんでした" actions={<button type="button" className="btn btn--small" onClick={() => setTick((t) => t + 1)}>再試行</button>}>
          同梱のテンプレートは使えます。{onlineError}
        </Notice>
      ) : null}
      {rest.length > 0 ? (
        <section className="grid-async" aria-label="その他の見本">
          {rest.map((it, i) => (
            <TemplateCard key={it.id} item={it} size={i % 3 === 0 ? 'm' : 's'} />
          ))}
        </section>
      ) : null}
      <section className="entry-row">
        <Link to="/drafts" className="btn">下書きを開く</Link>
        <Link to="/creator" className="btn">自分のテンプレートを作る</Link>
        <Link to="/account" className="btn btn--ghost">設定・診断</Link>
      </section>
      {!onlineConfigured ? <p className="meta">オンライン共有は未接続です（同梱と端末内のテンプレートのみ表示）。</p> : null}
    </main>
  );
}
