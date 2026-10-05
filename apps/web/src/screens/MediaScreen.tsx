import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Asset, Slot } from '@cinemix/core';
import { assignAsset, assignAssetsInOrder, isProjectComplete, moveBinding, removeBinding, swapBindings, updateBinding, computeSlotRanges } from '@cinemix/core';
import type { ImportItemResult } from '@cinemix/platform';
import { AppHeader } from '../components/AppHeader';
import { Notice } from '../components/Notice';
import { SaveStatus } from '../components/SaveStatus';
import { CropSheet } from '../components/CropSheet';
import { useEditor } from '../state/use-editor';
import { loadBlob, mediaAdapter } from '../services';
import { fmtSec } from '../services/format';

/** サムネイル（Blob URL はセッション一時値） */
function useThumb(asset: Asset | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!asset) return setUrl(null);
    let alive = true;
    let u: string | null = null;
    loadBlob(asset.id).then((b) => {
      if (!b || !alive) return;
      u = URL.createObjectURL(b);
      setUrl(u);
    });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [asset]);
  return url;
}

function SlotTile({ slot, asset, startMs, onTap, selected, dragging, onDragStart }: { slot: Slot; asset: Asset | undefined; startMs: number; onTap: () => void; selected: boolean; dragging: boolean; onDragStart: (e: React.PointerEvent) => void }) {
  const thumb = useThumb(asset);
  return (
    <div className={`slot ${asset ? 'slot--filled' : 'slot--empty'} ${selected ? 'slot--selected' : ''} ${dragging ? 'slot--dragging' : ''}`} data-slot-id={slot.id}>
      <button type="button" className="slot__tap" onClick={onTap} aria-label={`${slot.index + 1} 番の枠 ${asset ? '（素材あり）' : '（空）'}`}>
        {thumb ? asset?.kind === 'video' ? <video src={thumb} muted playsInline preload="metadata" className="slot__img" /> : <img src={thumb} alt="" className="slot__img" /> : <span className="slot__plus" aria-hidden="true">＋</span>}
        <span className="slot__num tnum">{slot.index + 1}</span>
        <span className="slot__dur tnum">{fmtSec(startMs, 1)}s–{fmtSec(startMs + slot.durationMs, 1)}s</span>
        {asset?.kind === 'video' ? <span className="slot__badge">動画</span> : null}
      </button>
      {asset ? (
        <button type="button" className="slot__handle" aria-label="ドラッグで並べ替え" onPointerDown={onDragStart} style={{ touchAction: 'none' }}>
          ⋮⋮
        </button>
      ) : null}
    </div>
  );
}

export function MediaScreen() {
  const nav = useNavigate();
  const { project, assets, store, save } = useEditor();
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<ImportItemResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [sheetSlot, setSheetSlot] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [drag, setDrag] = useState<{ slotId: string; overId: string | null } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [notAdded, setNotAdded] = useState(0);

  const slots = useMemo(() => [...project.templateSnapshot.slots].sort((a, b) => a.index - b.index), [project.templateSnapshot.slots]);
  const ranges = useMemo(() => computeSlotRanges(project.templateSnapshot), [project.templateSnapshot]);
  const bindings = useMemo(() => new Map(project.slotBindings.map((b) => [b.slotId, b])), [project.slotBindings]);
  const { complete, missing } = isProjectComplete(project);
  const freeSlots = slots.filter((s) => !bindings.has(s.id));

  const importFiles = async (files: File[], targetSlot: string | null) => {
    if (files.length === 0) return;
    setBusy(true);
    setNotAdded(0);
    try {
      let picked = files;
      if (!targetSlot && files.length > freeSlots.length) {
        setNotAdded(files.length - freeSlots.length);
        picked = files.slice(0, freeSlots.length);
      }
      const res = await mediaAdapter.import(picked, ['image', 'video']);
      setResults(res.filter((r) => !r.result.ok));
      const ok = res.filter((r) => r.asset).map((r) => r.asset!);
      if (ok.length === 0) return;
      if (targetSlot) {
        store.commit(assignAsset(project, targetSlot, ok[0]!.id, ok[0]!.kind as 'image' | 'video'), { refreshAssets: true });
      } else {
        store.commit(assignAssetsInOrder(project, ok.map((a) => a.id)).project, { refreshAssets: true });
      }
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
      if (replaceRef.current) replaceRef.current.value = '';
    }
  };

  // ドラッグ並べ替え（ハンドルから）。ページ全体の誤スクロールを防ぐため touch-action: none。
  const onDragStart = (slotId: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ slotId, overId: null });
    const move = (ev: PointerEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-slot-id]') as HTMLElement | null;
      setDrag((d) => (d ? { ...d, overId: el?.dataset['slotId'] ?? null } : d));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-slot-id]') as HTMLElement | null;
      const overId = el?.dataset['slotId'];
      setDrag(null);
      if (overId && overId !== slotId) store.commit(swapBindings(store.current, slotId, overId));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const sheetBinding = sheetSlot ? bindings.get(sheetSlot) ?? null : null;
  const sheetAsset = sheetBinding ? assets.get(sheetBinding.assetId) ?? null : null;
  const sheetSlotObj = slots.find((s) => s.id === sheetSlot);

  return (
    <main className="page page--media">
      <AppHeader back="/templates" title="素材" right={<SaveStatus status={save} onRetry={() => store.retrySave()} />} />
      <h1 className="h2">素材を枠に入れる</h1>
      <p className="meta">
        番号の順に再生されます。{complete ? '素材がそろいました。' : <strong>あと {missing} 点選んでください。</strong>}
        {' '}読み込み後に番号付き一覧で順番を確定できます（並べ替えはハンドルをドラッグ、または「前へ／次へ」）。
      </p>
      <p className="meta">写真は JPEG/PNG（20MB・36MP まで）、動画は MP4/MOV（50MB・30 秒・1080p 程度まで）。動画の元の音声はミュートされ、音楽 1 曲だけが入ります。</p>
      <input ref={fileRef} data-testid="media-file-input" type="file" accept="image/*,video/*" multiple className="visually-hidden" onChange={(e) => void importFiles([...(e.target.files ?? [])], null)} />
      <input ref={replaceRef} data-testid="media-replace-input" type="file" accept="image/*,video/*" className="visually-hidden" onChange={(e) => void importFiles([...(e.target.files ?? [])], sheetSlot)} />
      {notAdded > 0 ? <Notice kind="warning">枠の数を超えたため、{notAdded} 点は追加しませんでした。差し替えたい枠をタップして入れ替えられます。</Notice> : null}
      {results.length > 0 ? (
        <Notice kind="error" title="追加できなかったファイルがあります" actions={<button type="button" className="btn btn--small" onClick={() => setResults([])}>閉じる</button>}>
          <ul className="plainlist">
            {results.map((r, i) => (
              <li key={i}>
                <strong>{r.fileName}</strong>: {!r.result.ok ? `${r.result.message} — ${r.result.hint}` : ''}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}
      <div className="slot-grid" ref={gridRef}>
        {slots.map((s, i) => (
          <SlotTile
            key={s.id}
            slot={s}
            asset={bindings.get(s.id) ? assets.get(bindings.get(s.id)!.assetId) : undefined}
            startMs={ranges[i]?.startMs ?? 0}
            selected={drag?.overId === s.id}
            dragging={drag?.slotId === s.id}
            onDragStart={onDragStart(s.id)}
            onTap={() => {
              if (bindings.has(s.id)) setSheetSlot(s.id);
              else {
                setSheetSlot(s.id);
                replaceRef.current?.click();
              }
            }}
          />
        ))}
      </div>
      <div className="btn-row">
        <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={busy || freeSlots.length === 0}>
          {busy ? '確認しています…' : `写真・動画を選ぶ（あと ${freeSlots.length} 点）`}
        </button>
      </div>
      <div className="cta-bar">
        <button type="button" className="btn btn--primary btn--block" disabled={!complete} onClick={() => nav(`/projects/${project.id}/edit`)} aria-disabled={!complete}>
          {complete ? '文字と音楽で仕上げる' : `あと ${missing} 点選ぶと次へ進めます`}
        </button>
      </div>

      {sheetSlot && sheetBinding && sheetSlotObj ? (
        <div className="sheet-backdrop" onClick={() => setSheetSlot(null)} role="presentation">
          <div className="sheet" role="dialog" aria-modal="true" aria-label={`${sheetSlotObj.index + 1} 番の枠`} onClick={(e) => e.stopPropagation()}>
            <div className="sheet__head">
              <h2 className="sheet__title tnum">{sheetSlotObj.index + 1} 番の枠 · {fmtSec(sheetSlotObj.durationMs)} 秒</h2>
              <button type="button" className="btn btn--ghost" onClick={() => setSheetSlot(null)}>閉じる</button>
            </div>
            <div className="sheet__body btn-col">
              <button type="button" className="btn" onClick={() => setCropOpen(true)}>{sheetAsset?.kind === 'video' ? '開始位置・表示を調整' : '位置と大きさを調整'}</button>
              <button type="button" className="btn" onClick={() => replaceRef.current?.click()}>差し替える</button>
              <div className="btn-row">
                <button type="button" className="btn" disabled={sheetSlotObj.index === 0} onClick={() => store.commit(moveBinding(project, sheetSlot, -1))}>前へ</button>
                <button type="button" className="btn" disabled={sheetSlotObj.index === slots.length - 1} onClick={() => store.commit(moveBinding(project, sheetSlot, 1))}>次へ</button>
              </div>
              <button type="button" className="btn btn--danger" onClick={() => { if (confirm('この枠の素材を外しますか？（ファイル自体は削除されません）')) { store.commit(removeBinding(project, sheetSlot)); setSheetSlot(null); } }}>この枠から外す</button>
            </div>
          </div>
        </div>
      ) : null}
      <CropSheet
        open={cropOpen && !!sheetBinding}
        asset={sheetAsset}
        binding={sheetBinding}
        rect={sheetSlotObj?.rect ?? { x: 0, y: 0, w: 1, h: 1 }}
        slotDurationMs={sheetSlotObj?.durationMs ?? 3000}
        onChange={(patch, commit) => {
          if (!sheetSlot) return;
          const next = updateBinding(store.current, sheetSlot, patch);
          if (commit) store.commit(next);
          else store.preview(next);
        }}
        onClose={() => setCropOpen(false)}
      />
    </main>
  );
}
