import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { TemplateListItem } from '@cinemix/platform';
import { fmtSec } from '../services/format';

function sourceLabel(s: TemplateListItem['source']): string {
  return s === 'builtin' ? '同梱' : s === 'local' ? 'この端末' : s === 'imported' ? '読み込み' : 'オンライン';
}

/** 動く見本。自動再生は画面内の1件（hero）だけ。低電力・自動再生不可時は静止画＋再生ボタン。 */
export function TemplateHero({ item }: { item: TemplateListItem }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [failed, setFailed] = useState(false);
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    const v = ref.current;
    if (!v || !item.previewUrl || reduce) return;
    const p = v.play();
    if (p && typeof p.catch === 'function') p.catch(() => setNeedsTap(true));
  }, [item.previewUrl, reduce]);
  return (
    <article className="hero">
      <div className="hero__media">
        {item.previewUrl && !failed ? (
          <video ref={ref} className="hero__video" src={item.previewUrl} poster={item.coverUrl} muted playsInline loop preload="metadata" onError={() => setFailed(true)} aria-label={`${item.name} の見本動画`} />
        ) : item.coverUrl ? (
          <img className="hero__video" src={item.coverUrl} alt={`${item.name} の表紙`} />
        ) : (
          <div className="hero__placeholder" aria-hidden="true" />
        )}
        {(needsTap || reduce) && item.previewUrl && !failed ? (
          <button type="button" className="btn btn--primary hero__play" onClick={() => void ref.current?.play().then(() => setNeedsTap(false))}>
            見本を再生
          </button>
        ) : null}
      </div>
      <div className="hero__text">
        <p className="eyebrow">{sourceLabel(item.source)} · {item.styleLabel ?? 'テンプレート'}</p>
        <h2 className="hero__title">{item.name}</h2>
        <p className="hero__desc">{item.description}</p>
        <p className="meta tnum">
          必要な素材 <strong>{item.requiredAssetCount}</strong> 点 · {fmtSec(item.durationMs, 0)} 秒 · 縦 {item.aspectRatio}
        </p>
        <Link to={`/templates/${item.id}`} className="btn btn--primary">
          このテンプレートを見る
        </Link>
      </div>
    </article>
  );
}

export function TemplateCard({ item, size = 'm' }: { item: TemplateListItem; size?: 's' | 'm' }) {
  return (
    <Link to={`/templates/${item.id}`} className={`tcard tcard--${size}`}>
      <div className="tcard__media">{item.coverUrl ? <img src={item.coverUrl} alt="" loading="lazy" /> : <div className="hero__placeholder" aria-hidden="true" />}</div>
      <div className="tcard__text">
        <span className="eyebrow">{sourceLabel(item.source)}</span>
        <strong className="tcard__title">{item.name}</strong>
        <span className="meta tnum">
          {item.requiredAssetCount} 点 · {fmtSec(item.durationMs, 0)} 秒
        </span>
        {item.cloud ? <span className="meta">{item.cloud.visibility === 'public' ? (item.cloud.moderationStatus === 'approved' ? '公開中' : item.cloud.moderationStatus === 'pending' ? '審査中' : '却下') : '非公開'}</span> : null}
      </div>
    </Link>
  );
}
