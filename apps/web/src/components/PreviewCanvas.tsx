import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project, Asset, TextItem } from '@cinemix/core';
import { LIMITS, buildRenderPlan, clampTextCenter, isTextVisibleAt, textBoxPx, updateText } from '@cinemix/core';
import { PreviewPlayer, getMeasureFactory, type PreviewState } from '@cinemix/render-web';
import { loadBlob } from '../services';

type Props = {
  project: Project;
  assets: ReadonlyMap<string, Asset>;
  selectedTextId: string | null;
  onSelectText: (id: string | null) => void;
  onTextPreview: (next: Project) => void;
  onTextCommit: (base: Project) => void;
  onState: (s: PreviewState) => void;
  playerRef: React.MutableRefObject<PreviewPlayer | null>;
  reduceMotion: boolean;
};

/**
 * 9:16 プレビュー。Canvas が正式結果。文字の DOM オーバーレイはドラッグ／ピンチの入力補助だけで、描画は renderFrame に任せる。
 */
export function PreviewCanvas({ project, assets, selectedTextId, onSelectText, onTextPreview, onTextCommit, onState, playerRef, reduceMotion }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [time, setTime] = useState(0);
  const [size, setSize] = useState({ w: 270, h: 480 });
  const gesture = useRef<{ base: Project; id: string; x: number; y: number; centerX: number; centerY: number; dist: number; ratio: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const player = new PreviewPlayer(c, project, assets, loadBlob);
    playerRef.current = player;
    const unsub = player.subscribe((s) => {
      setTime(s.timeMs);
      onState(s);
    });
    return () => {
      unsub();
      player.dispose();
      playerRef.current = null;
    };
    // 初期化は一度だけ。更新は下の effect で。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    playerRef.current?.update(project, assets);
  }, [project, assets, playerRef]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plan = useMemo(() => buildRenderPlan(project, getMeasureFactory()), [project]);
  const scale = size.w / LIMITS.canvas.width;
  const visibleTexts = plan.texts.filter((tp) => isTextVisibleAt(tp.text, time) || tp.text.id === selectedTextId);

  const startGesture = (e: React.PointerEvent, text: TextItem) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    onSelectText(text.id);
    const pts = [...pointers.current.values()];
    gesture.current = { base: project, id: text.id, x: e.clientX, y: e.clientY, centerX: text.centerX, centerY: text.centerY, dist: pts.length >= 2 ? Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) : 0, ratio: text.fontSizeRatio };
  };
  const moveGesture = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const cur = playerRef.current ? project : project;
    const text = cur.texts.find((t) => t.id === g.id);
    if (!text) return;
    if (pts.length >= 2 && g.dist > 0) {
      const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      const ratio = Math.min(LIMITS.text.fontSizeRatio.max, Math.max(LIMITS.text.fontSizeRatio.min, g.ratio * (d / g.dist)));
      onTextPreview(updateText(cur, g.id, { fontSizeRatio: ratio }));
      return;
    }
    const dx = (e.clientX - g.x) / size.w;
    const dy = (e.clientY - g.y) / size.h;
    const tp = plan.texts.find((t) => t.text.id === g.id);
    const boxW = (tp?.layout.width ?? 0) + (tp?.padPx ?? 0) * 2;
    const boxH = (tp?.layout.height ?? 0) + (tp?.padPx ?? 0) * 2;
    const c = clampTextCenter(g.centerX + dx, g.centerY + dy, boxW, boxH, LIMITS.canvas.width, LIMITS.canvas.height);
    onTextPreview(updateText(cur, g.id, { centerX: c.centerX, centerY: c.centerY }));
  };
  const endGesture = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0 && gesture.current) {
      const base = gesture.current.base;
      gesture.current = null;
      onTextCommit(base);
    }
  };

  return (
    <div className="preview" ref={wrapRef} style={{ aspectRatio: '9 / 16' }}>
      <canvas ref={canvasRef} className="preview__canvas" aria-label="動画のプレビュー" />
      {/* SNS セーフエリアのガイド（配置は強制しない） */}
      <div className="preview__safe" aria-hidden="true" />
      <div className="preview__overlay" onClick={() => onSelectText(null)} role="presentation">
        {visibleTexts.map((tp) => {
          const box = textBoxPx(tp.text, tp.layout, LIMITS.canvas.width, LIMITS.canvas.height, tp.padPx);
          const c = clampTextCenter(tp.text.centerX, tp.text.centerY, box.w, box.h, LIMITS.canvas.width, LIMITS.canvas.height);
          const left = (c.centerX * LIMITS.canvas.width - box.w / 2) * scale;
          const top = (c.centerY * LIMITS.canvas.height - box.h / 2) * scale;
          const sel = tp.text.id === selectedTextId;
          return (
            <div
              key={tp.text.id}
              className={`text-handle ${sel ? 'text-handle--selected' : ''} ${isTextVisibleAt(tp.text, time) ? '' : 'text-handle--hidden'}`}
              style={{ left, top, width: Math.max(44, box.w * scale), height: Math.max(44, box.h * scale), touchAction: 'none' }}
              role="button"
              tabIndex={0}
              aria-label={`文字「${tp.text.value.slice(0, 20)}」を選択・移動`}
              onPointerDown={(e) => startGesture(e, tp.text)}
              onPointerMove={moveGesture}
              onPointerUp={endGesture}
              onPointerCancel={endGesture}
              onClick={(e) => {
                e.stopPropagation();
                onSelectText(tp.text.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectText(tp.text.id);
                }
              }}
            />
          );
        })}
      </div>
      {reduceMotion ? <span className="visually-hidden">操作アニメーションは軽減されています（動画の演出は変わりません）</span> : null}
    </div>
  );
}
