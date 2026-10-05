import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { computeSlotRanges, findSlotAt, isProjectComplete, totalDurationMs } from '@cinemix/core';
import type { PreviewPlayer, PreviewState } from '@cinemix/render-web';
import { AppHeader } from '../components/AppHeader';
import { PreviewCanvas } from '../components/PreviewCanvas';
import { TextSheet } from '../components/TextSheet';
import { AudioSheet } from '../components/AudioSheet';
import { SaveStatus } from '../components/SaveStatus';
import { Notice } from '../components/Notice';
import { useEditor } from '../state/use-editor';
import { fmtClock, fmtSec } from '../services/format';

type Tab = 'text' | 'audio' | 'media';

export function EditScreen() {
  const nav = useNavigate();
  const { project, assets, store, save, canUndo, canRedo, selectedTextId } = useEditor();
  const playerRef = useRef<PreviewPlayer | null>(null);
  const [pstate, setPstate] = useState<PreviewState>({ playing: false, timeMs: 0, durationMs: 0, ready: false, error: null });
  const [tab, setTab] = useState<Tab>('text');
  const D = totalDurationMs(project.templateSnapshot);
  const ranges = useMemo(() => computeSlotRanges(project.templateSnapshot), [project.templateSnapshot]);
  const current = findSlotAt(ranges, pstate.timeMs);
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const { complete, missing } = isProjectComplete(project);

  useEffect(() => {
    store.setCurrentSlot(current?.slotId ?? null);
  }, [current?.slotId, store]);

  // キーボード表示時にプレビューを縮める（visualViewport）
  const [kb, setKb] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const on = () => setKb(window.innerHeight - vv.height > 120);
    vv.addEventListener('resize', on);
    return () => vv.removeEventListener('resize', on);
  }, []);

  return (
    <main className={`page page--edit ${kb ? 'kb-open' : ''}`}>
      <AppHeader
        back={`/projects/${project.id}/media`}
        title="仕上げ"
        right={
          <>
            <button type="button" className="btn btn--ghost btn--icon" onClick={() => store.undo()} disabled={!canUndo} aria-label="元に戻す" title="元に戻す">
              <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M8 5 4 9l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 9h8a5 5 0 0 1 0 10h-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
            <button type="button" className="btn btn--ghost btn--icon" onClick={() => store.redo()} disabled={!canRedo} aria-label="やり直し" title="やり直し">
              <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="m14 5 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M18 9h-8a5 5 0 0 0 0 10h2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
            <SaveStatus status={save} onRetry={() => store.retrySave()} />
          </>
        }
      />
      {!complete ? (
        <Notice kind="warning" title={`素材があと ${missing} 点足りません`} actions={<Link to={`/projects/${project.id}/media`} className="btn btn--small">素材へ戻る</Link>}>
          文字と音楽の編集は保存されます。
        </Notice>
      ) : null}
      {save.state === 'error' && save.error ? <Notice kind="error" title="下書きを保存できません">{save.error.message}</Notice> : null}
      {pstate.error ? <Notice kind="warning" title="プレビューに表示できない素材があります">{pstate.error}</Notice> : null}

      <section className="editor">
        <div className="editor__preview">
          <PreviewCanvas
            project={project}
            assets={assets}
            selectedTextId={selectedTextId}
            onSelectText={(id) => store.selectText(id)}
            onTextPreview={(p) => store.preview(p)}
            onTextCommit={(base) => store.commitFrom(base)}
            onState={setPstate}
            playerRef={playerRef}
            reduceMotion={reduceMotion}
          />
        </div>
        <div className="transport">
          <button type="button" className="btn btn--icon" aria-label={pstate.playing ? '一時停止' : '再生'} onClick={() => (pstate.playing ? playerRef.current?.pause() : void playerRef.current?.play())} disabled={!pstate.ready}>
            {pstate.playing ? '⏸' : '▶'}
          </button>
          <span className="tnum transport__time" aria-live="off">
            {fmtClock(pstate.timeMs)} / {fmtSec(D)}
          </span>
          <input
            type="range"
            className="transport__scrub"
            min={0}
            max={Math.max(0, D - 1)}
            step={33}
            value={Math.min(pstate.timeMs, D - 1)}
            onChange={(e) => void playerRef.current?.seek(Number(e.target.value))}
            aria-label="再生位置"
          />
        </div>
        <div className="slotmarks" role="group" aria-label="枠へ移動">
          {ranges.map((r) => (
            <button key={r.slotId} type="button" className={`slotmark tnum ${current?.slotId === r.slotId ? 'is-current' : ''}`} style={{ flex: r.durationMs }} onClick={() => void playerRef.current?.seek(r.startMs)} aria-current={current?.slotId === r.slotId ? 'true' : undefined}>
              {r.index + 1}
            </button>
          ))}
        </div>
        <div className="tabs" role="tablist" aria-label="仕上げ">
          {(['text', 'audio', 'media'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'is-selected' : ''}`} onClick={() => (t === 'media' ? nav(`/projects/${project.id}/media`) : setTab(t))}>
              {t === 'text' ? '文字' : t === 'audio' ? '音楽' : '素材'}
            </button>
          ))}
        </div>
        <div className="editor__panel" role="tabpanel">
          {tab === 'text' ? (
            <TextSheet
              project={project}
              selectedId={selectedTextId}
              currentTimeMs={pstate.timeMs}
              onSelect={(id) => store.selectText(id)}
              onCommit={(p) => store.commit(p)}
              onPreview={(p) => store.preview(p)}
              onCommitFrom={(base) => store.commitFrom(base)}
            />
          ) : (
            <AudioSheet project={project} assets={assets} onCommit={(p, refresh) => store.commit(p, { refreshAssets: !!refresh })} onPreview={(p) => store.preview(p)} onCommitFrom={(base) => store.commitFrom(base)} />
          )}
        </div>
      </section>
      <div className="cta-bar">
        <button type="button" className="btn btn--primary btn--block" disabled={!complete} onClick={async () => { playerRef.current?.pause(); await store.flush(); nav(`/projects/${project.id}/export`); }}>
          {complete ? '動画を書き出す' : `あと ${missing} 点の素材が必要です`}
        </button>
      </div>
    </main>
  );
}
