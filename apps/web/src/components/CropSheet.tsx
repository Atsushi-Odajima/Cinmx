import { useEffect, useRef, useState } from 'react';
import type { Asset, Crop, Rect, SlotBinding } from '@cinemix/core';
import { LIMITS, clampCropCenter, computeCoverSourceRect, snapMs } from '@cinemix/core';
import { decodeImage } from '@cinemix/render-web';
import { BottomSheet } from './BottomSheet';
import { NumberField } from './NumberField';
import { loadBlob } from '../services';
import { fmtSec } from '../services/format';

type Props = {
  open: boolean;
  asset: Asset | null;
  binding: SlotBinding | null;
  rect: Rect;
  slotDurationMs: number;
  onChange: (patch: Partial<Omit<SlotBinding, 'slotId' | 'assetId'>>, commit: boolean) => void;
  onClose: () => void;
};

/**
 * 素材の調整シート。画像: cover + 焦点（ドラッグ）+ 倍率（ピンチ／スライダー）。
 * 動画: 使い始める位置（0.1秒）と短い動画の処理（hold/fade）。元ファイルは変更しない。
 */
export function CropSheet({ open, asset, binding, rect, slotDurationMs, onChange, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [img, setImg] = useState<ImageBitmap | HTMLImageElement | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ crop: Crop; dist: number; x: number; y: number } | null>(null);
  const crop = binding?.crop ?? { centerX: 0.5, centerY: 0.5, scale: 1 };
  const W = LIMITS.canvas.width * rect.w;
  const H = LIMITS.canvas.height * rect.h;
  const boxW = 300;
  const boxH = Math.round((boxW * H) / W);

  useEffect(() => {
    if (!open || !asset) return;
    let alive = true;
    (async () => {
      const blob = await loadBlob(asset.id);
      if (!blob || !alive) return;
      if (asset.kind === 'image') {
        const bmp = await decodeImage(blob);
        if (alive) setImg(bmp);
      } else {
        setVideoUrl(URL.createObjectURL(blob));
      }
    })();
    return () => {
      alive = false;
      setImg((cur) => {
        if (cur && 'close' in cur) (cur as ImageBitmap).close();
        return null;
      });
      setVideoUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
    };
  }, [open, asset]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !asset) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    c.width = boxW;
    c.height = boxH;
    ctx.fillStyle = '#c8cdc2';
    ctx.fillRect(0, 0, boxW, boxH);
    const src: CanvasImageSource | null = asset.kind === 'image' ? img : videoRef.current;
    const sw = asset.kind === 'image' ? img?.width : videoRef.current?.videoWidth;
    const sh = asset.kind === 'image' ? img?.height : videoRef.current?.videoHeight;
    if (!src || !sw || !sh) return;
    const r = computeCoverSourceRect(sw, sh, W, H, crop);
    ctx.drawImage(src, r.sx, r.sy, r.sw, r.sh, 0, 0, boxW, boxH);
  }, [img, crop, asset, W, H, boxW, boxH, videoUrl, binding?.sourceInMs]);

  if (!asset || !binding) return null;
  const srcW = asset.width ?? 1;
  const srcH = asset.height ?? 1;

  const setCrop = (next: Crop, commit: boolean) => onChange({ crop: clampCropCenter(srcW, srcH, W, H, next) }, commit);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    gesture.current = { crop, dist: pts.length >= 2 ? Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) : 0, x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!gesture.current || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const g = gesture.current;
    if (pts.length >= 2) {
      const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      if (g.dist > 0) setCrop({ ...g.crop, scale: Math.min(3, Math.max(1, g.crop.scale * (d / g.dist))) }, false);
      return;
    }
    // ドラッグ: 画面上の移動量を元画像比率へ（表示倍率を考慮）
    const r = computeCoverSourceRect(srcW, srcH, W, H, g.crop);
    const dx = ((e.clientX - g.x) / boxW) * r.sw;
    const dy = ((e.clientY - g.y) / boxH) * r.sh;
    setCrop({ ...g.crop, centerX: g.crop.centerX - dx / srcW, centerY: g.crop.centerY - dy / srcH }, false);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0 && gesture.current) {
      gesture.current = null;
      onChange({ crop }, true);
    }
  };

  return (
    <BottomSheet open={open} title={asset.kind === 'image' ? '写真の位置と大きさ' : '動画の調整'} onClose={onClose}>
      {asset.kind === 'video' && videoUrl ? (
        <video
          ref={videoRef}
          src={videoUrl}
          muted
          playsInline
          preload="auto"
          className="visually-hidden"
          onLoadedData={(e) => {
            e.currentTarget.currentTime = binding.sourceInMs / 1000;
          }}
          onSeeked={() => setImg((x) => x)}
        />
      ) : null}
      <div className="crop">
        <canvas
          ref={canvasRef}
          className="crop__canvas"
          style={{ width: boxW, height: boxH, touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-label="ドラッグで位置、ピンチで大きさを調整"
        />
        <p className="meta">ドラッグで焦点を移動。ピンチまたはスライダーで拡大（1〜3倍）。元の写真は変更されません。</p>
        <label className="field">
          <span className="field__label">倍率 <span className="tnum">{crop.scale.toFixed(2)}×</span></span>
          <input type="range" min={1} max={3} step={0.01} value={crop.scale} onChange={(e) => setCrop({ ...crop, scale: Number(e.target.value) }, false)} onPointerUp={() => onChange({ crop }, true)} onKeyUp={() => onChange({ crop }, true)} aria-label="倍率" />
        </label>
        <div className="btn-row">
          <button type="button" className="btn btn--small" onClick={() => setCrop({ centerX: 0.5, centerY: 0.5, scale: 1 }, true)}>中央・等倍に戻す</button>
        </div>
        {asset.kind === 'video' ? (
          <>
            <NumberField
              id="source-in"
              label="使い始める位置（秒）"
              value={binding.sourceInMs / 1000}
              min={0}
              max={Math.max(0, ((asset.durationMs ?? 0) - 100) / 1000)}
              step={0.1}
              unit="秒"
              onChange={(v) => {
                const ms = snapMs(v * 1000, 100, Math.max(0, (asset.durationMs ?? 0) - 100));
                onChange({ sourceInMs: ms }, true);
                if (videoRef.current) videoRef.current.currentTime = ms / 1000;
              }}
            />
            <p className="meta tnum">
              動画の長さ {fmtSec(asset.durationMs ?? 0)} 秒 / この枠は {fmtSec(slotDurationMs)} 秒。
              {(asset.durationMs ?? 0) - binding.sourceInMs < slotDurationMs ? ` 動画が ${fmtSec(slotDurationMs - ((asset.durationMs ?? 0) - binding.sourceInMs))} 秒足りません。` : ' 指定位置から枠の時間分だけ使います。'}
            </p>
            <fieldset className="field">
              <legend className="field__label">動画が枠より短いとき</legend>
              <label className="radio"><input type="radio" name="svp" checked={binding.shortVideoPolicy === 'hold'} onChange={() => onChange({ shortVideoPolicy: 'hold' }, true)} /> 最後のコマを残す（標準）</label>
              <label className="radio"><input type="radio" name="svp" checked={binding.shortVideoPolicy === 'fade'} onChange={() => onChange({ shortVideoPolicy: 'fade' }, true)} /> 最後の 0.3 秒で背景へフェード</label>
            </fieldset>
            <p className="meta">元の動画の音声は使いません（音楽 1 曲だけが入ります）。</p>
          </>
        ) : null}
      </div>
    </BottomSheet>
  );
}
