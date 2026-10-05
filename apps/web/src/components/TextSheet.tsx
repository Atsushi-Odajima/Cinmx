import { useMemo } from 'react';
import type { Project, TextItem, FontId } from '@cinemix/core';
import { FONT_CATALOG, LIMITS, addText, containsEmoji, containsNonLatin, computeSlotRanges, findSlotAt, removeText, reorderText, snapMs, totalDurationMs, updateText } from '@cinemix/core';
import { NumberField } from './NumberField';
import { fmtSec } from '../services/format';

const COLOR_PRESETS = ['#FFFCF4', '#25382E', '#D7E583', '#F3F0E7', '#963E35', '#805A14', '#315C41', '#000000'];

type Props = {
  project: Project;
  selectedId: string | null;
  currentTimeMs: number;
  onSelect: (id: string | null) => void;
  onCommit: (next: Project) => void;
  onPreview: (next: Project) => void;
  onCommitFrom: (base: Project) => void;
};

export function TextSheet({ project, selectedId, currentTimeMs, onSelect, onCommit, onPreview, onCommitFrom }: Props) {
  const D = totalDurationMs(project.templateSnapshot);
  const ranges = useMemo(() => computeSlotRanges(project.templateSnapshot), [project.templateSnapshot]);
  const currentSlot = findSlotAt(ranges, currentTimeMs);
  const texts = [...project.texts].sort((a, b) => b.zOrder - a.zOrder);
  const sel = project.texts.find((t) => t.id === selectedId) ?? null;

  const add = () => {
    const r = addText(project, { value: 'ここに文字' }, currentSlot?.slotId ?? null);
    if ('error' in r) return alert(r.error);
    onCommit(r.project);
    onSelect(r.text.id);
  };
  const patch = (p: Partial<TextItem>, commit = true) => {
    if (!sel) return;
    const next = updateText(project, sel.id, p);
    if (commit) onCommit(next);
    else onPreview(next);
  };
  const nudge = (dx: number, dy: number) => sel && patch({ centerX: Math.min(1, Math.max(0, sel.centerX + dx)), centerY: Math.min(1, Math.max(0, sel.centerY + dy)) });

  return (
    <div className="panel">
      <div className="panel__head">
        <span className="tnum">文字 {project.texts.length}/{LIMITS.text.maxCount}</span>
        <button type="button" className="btn btn--small btn--primary" onClick={add} disabled={project.texts.length >= LIMITS.text.maxCount}>文字を追加</button>
      </div>
      {texts.length > 0 ? (
        <ul className="textlist" aria-label="文字の一覧（前面が上）">
          {texts.map((t) => (
            <li key={t.id}>
              <button type="button" className={`textlist__item ${t.id === selectedId ? 'is-selected' : ''}`} onClick={() => onSelect(t.id === selectedId ? null : t.id)} aria-pressed={t.id === selectedId}>
                <span className="textlist__value">{t.value || '（空）'}</span>
                <span className="meta tnum">{fmtSec(t.startMs)}–{fmtSec(t.endMs)} 秒</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="meta">文字はまだありません。「文字を追加」で現在の写真の間に表示される文字を置けます。</p>
      )}
      {sel ? (
        <form className="textform" onSubmit={(e) => e.preventDefault()}>
          <label className="field">
            <span className="field__label">本文（{sel.value.length}/{LIMITS.text.maxChars}・{LIMITS.text.maxLines} 行まで）</span>
            <textarea
              className="input"
              rows={2}
              maxLength={LIMITS.text.maxChars}
              value={sel.value}
              onChange={(e) => {
                const v = e.target.value.split('\n').slice(0, LIMITS.text.maxLines).join('\n');
                patch({ value: v }, false);
              }}
              onBlur={() => onCommitFrom(project)}
              aria-describedby="text-notes"
            />
          </label>
          <p id="text-notes" className="meta">
            {containsEmoji(sel.value) ? <strong className="warn">絵文字はこの試作では非対応です（端末によって表示が変わるため、動画には正しく入らないことがあります）。</strong> : null}
            {FONT_CATALOG.find((f) => f.id === sel.fontId)?.script === 'latin' && containsNonLatin(sel.value) ? ' 筆記体は欧文用です。日本語は Noto Sans JP で表示されます。' : null}
          </p>
          <label className="field">
            <span className="field__label">書体</span>
            <select className="input" value={sel.fontId} onChange={(e) => patch({ fontId: e.target.value as FontId })}>
              {FONT_CATALOG.map((f) => (
                <option key={f.id} value={f.id}>{f.label} — {f.note}</option>
              ))}
            </select>
          </label>
          <div className="field">
            <span className="field__label">色</span>
            <div className="swatches">
              {COLOR_PRESETS.map((c) => (
                <button key={c} type="button" className={`swatch ${sel.color.toUpperCase() === c ? 'is-selected' : ''}`} style={{ background: c }} aria-label={`色 ${c}`} onClick={() => patch({ color: c })} />
              ))}
              <input className="input input--hex" type="text" inputMode="text" pattern="#[0-9a-fA-F]{6}" value={sel.color} aria-label="HEX 色" onChange={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && patch({ color: e.target.value })} />
            </div>
          </div>
          <label className="field">
            <span className="field__label">大きさ <span className="tnum">{Math.round(sel.fontSizeRatio * LIMITS.canvas.width)}px</span></span>
            <input type="range" min={LIMITS.text.fontSizeRatio.min} max={LIMITS.text.fontSizeRatio.max} step={0.001} value={sel.fontSizeRatio} onChange={(e) => patch({ fontSizeRatio: Number(e.target.value) }, false)} onPointerUp={() => onCommitFrom(project)} onKeyUp={() => onCommitFrom(project)} aria-label="文字の大きさ" />
          </label>
          <div className="field">
            <span className="field__label">揃え</span>
            <div className="seg" role="group" aria-label="揃え">
              {(['left', 'center', 'right'] as const).map((a) => (
                <button key={a} type="button" className={`seg__btn ${sel.align === a ? 'is-selected' : ''}`} aria-pressed={sel.align === a} onClick={() => patch({ align: a })}>
                  {a === 'left' ? '左' : a === 'center' ? '中央' : '右'}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field__label">位置（ドラッグでも移動できます）</span>
            <div className="btn-row wrap">
              <button type="button" className="btn btn--small" onClick={() => patch({ centerX: 0.5 })}>左右中央</button>
              <button type="button" className="btn btn--small" onClick={() => patch({ centerY: 0.5 })}>上下中央</button>
              <button type="button" className="btn btn--small" aria-label="少し上へ" onClick={() => nudge(0, -0.01)}>↑</button>
              <button type="button" className="btn btn--small" aria-label="少し下へ" onClick={() => nudge(0, 0.01)}>↓</button>
              <button type="button" className="btn btn--small" aria-label="少し左へ" onClick={() => nudge(-0.01, 0)}>←</button>
              <button type="button" className="btn btn--small" aria-label="少し右へ" onClick={() => nudge(0.01, 0)}>→</button>
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={!!sel.background} onChange={(e) => patch({ background: e.target.checked ? { color: '#25382E', opacity: 0.6, paddingRatio: 0.02 } : undefined })} /> 背景帯
          </label>
          {sel.background ? (
            <div className="field field--inline">
              <input type="color" value={sel.background.color} aria-label="帯の色" onChange={(e) => patch({ background: { ...sel.background!, color: e.target.value.toUpperCase() } })} />
              <input type="range" min={0.1} max={1} step={0.05} value={sel.background.opacity} aria-label="帯の不透明度" onChange={(e) => patch({ background: { ...sel.background!, opacity: Number(e.target.value) } }, false)} onPointerUp={() => onCommitFrom(project)} />
            </div>
          ) : null}
          <label className="check">
            <input type="checkbox" checked={!!sel.stroke} onChange={(e) => patch({ stroke: e.target.checked ? { color: '#25382E', widthRatio: 0.004 } : undefined })} /> 縁取り
          </label>
          {sel.stroke ? (
            <div className="field field--inline">
              <input type="color" value={sel.stroke.color} aria-label="縁取りの色" onChange={(e) => patch({ stroke: { ...sel.stroke!, color: e.target.value.toUpperCase() } })} />
            </div>
          ) : null}
          <fieldset className="field">
            <legend className="field__label">表示時間（半開区間：開始 ≦ t ＜ 終了）</legend>
            <div className="btn-row wrap">
              <button type="button" className="btn btn--small" onClick={() => patch({ startMs: snapMs(currentTimeMs, 100, D) })}>ここから表示</button>
              <button type="button" className="btn btn--small" onClick={() => patch({ endMs: snapMs(currentTimeMs, 100, D) })}>ここまで表示</button>
              <button type="button" className="btn btn--small" disabled={!currentSlot} onClick={() => currentSlot && patch({ startMs: currentSlot.startMs, endMs: currentSlot.endMs })}>この写真の間だけ</button>
              <button type="button" className="btn btn--small" onClick={() => patch({ startMs: 0, endMs: D })}>最初から最後まで</button>
            </div>
            <div className="field__row">
              <NumberField id="t-start" label="開始（秒）" value={sel.startMs / 1000} min={0} max={(D - 100) / 1000} step={0.1} onChange={(v) => patch({ startMs: snapMs(v * 1000, 100, D) })} />
              <NumberField id="t-end" label="終了（秒）" value={sel.endMs / 1000} min={0.1} max={D / 1000} step={0.1} onChange={(v) => patch({ endMs: snapMs(v * 1000, 100, D) })} />
            </div>
            <div className="rangeband" aria-hidden="true">
              <div className="rangeband__fill" style={{ left: `${(sel.startMs / D) * 100}%`, width: `${((sel.endMs - sel.startMs) / D) * 100}%` }} />
            </div>
          </fieldset>
          <div className="btn-row wrap">
            <button type="button" className="btn btn--small" onClick={() => onCommit(reorderText(project, sel.id, 'forward'))}>前面へ</button>
            <button type="button" className="btn btn--small" onClick={() => onCommit(reorderText(project, sel.id, 'backward'))}>背面へ</button>
            <button type="button" className="btn btn--small btn--danger" onClick={() => { onCommit(removeText(project, sel.id)); onSelect(null); }}>この文字を削除</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
