import { useRef, useState } from 'react';
import type { Project, Asset } from '@cinemix/core';
import { LIMITS, computeAudioPlan, setAudio, snapMs, totalDurationMs } from '@cinemix/core';
import { Notice } from './Notice';
import { NumberField } from './NumberField';
import { mediaAdapter } from '../services';
import { fmtSec } from '../services/format';

type Props = { project: Project; assets: ReadonlyMap<string, Asset>; onCommit: (next: Project, refresh?: boolean) => void; onPreview: (next: Project) => void; onCommitFrom: (base: Project) => void };

export function AudioSheet({ project, assets, onCommit, onPreview, onCommitFrom }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const D = totalDurationMs(project.templateSnapshot);
  const audio = project.audio;
  const asset = audio ? assets.get(audio.assetId) : undefined;
  const srcLen = asset?.durationMs ?? 0;
  const plan = audio ? computeAudioPlan(audio, D) : null;

  const importAudio = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const [r] = await mediaAdapter.import([file], ['audio']);
      if (!r || !r.result.ok || !r.asset) {
        setError(r && !r.result.ok ? `${r.result.message} — ${r.result.hint}` : '音源を読み込めません');
        return;
      }
      const len = r.asset.durationMs ?? 0;
      onCommit(setAudio(project, { assetId: r.asset.id, sourceInMs: 0, sourceOutMs: Math.max(100, Math.min(len, D)), volume: LIMITS.audio.volume.default, fadeOutMs: LIMITS.audio.fadeOutMs }), true);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const useSample = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/samples/cinemix-sample-bgm.mp3');
      const blob = await res.blob();
      await importAudio(new File([blob], 'cinemix-sample-bgm.mp3', { type: 'audio/mpeg' }));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const patch = (p: Partial<NonNullable<Project['audio']>>, commit = true) => {
    if (!audio) return;
    let next = { ...audio, ...p };
    next.sourceInMs = snapMs(next.sourceInMs, 100, Math.max(0, srcLen - 100));
    next.sourceOutMs = snapMs(next.sourceOutMs, 100, srcLen);
    if (next.sourceOutMs <= next.sourceInMs) next = { ...next, sourceOutMs: Math.min(srcLen, next.sourceInMs + 100) };
    const np = setAudio(project, next);
    if (commit) onCommit(np);
    else onPreview(np);
  };

  return (
    <div className="panel">
      <input ref={fileRef} data-testid="audio-file-input" type="file" accept="audio/*,.mp3,.m4a,.wav" className="visually-hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importAudio(f); }} />
      {!audio ? (
        <>
          <p className="meta">音楽は 1 曲だけ。あなたが権利を持つ MP3 / M4A / WAV を選んでください。音楽なしでも完成できます。</p>
          <div className="btn-row wrap">
            <button type="button" className="btn btn--primary" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? '確認しています…' : '音楽ファイルを選ぶ'}</button>
            <button type="button" className="btn" onClick={() => void useSample()} disabled={busy}>同梱の試聴用音源を使う</button>
          </div>
          <p className="meta">同梱音源は CinemiX 自作（CC0 相当）。他のサービスの楽曲カタログは取得しません。</p>
        </>
      ) : (
        <>
          <p className="meta">
            音源 <strong>{asset?.label ?? '（音源）'}</strong> · 長さ <span className="tnum">{fmtSec(srcLen)}</span> 秒。選んだ区間は動画の 0 秒から再生されます。
          </p>
          <div className="field__row">
            <NumberField id="a-in" label="音源の開始（秒）" value={audio.sourceInMs / 1000} min={0} max={Math.max(0, (srcLen - 100) / 1000)} step={0.1} onChange={(v) => patch({ sourceInMs: v * 1000 })} />
            <NumberField id="a-out" label="音源の終了（秒）" value={audio.sourceOutMs / 1000} min={0.1} max={srcLen / 1000} step={0.1} onChange={(v) => patch({ sourceOutMs: v * 1000 })} />
          </div>
          <div className="rangeband" aria-hidden="true">
            <div className="rangeband__fill" style={{ left: `${srcLen ? (audio.sourceInMs / srcLen) * 100 : 0}%`, width: `${srcLen ? ((audio.sourceOutMs - audio.sourceInMs) / srcLen) * 100 : 0}%` }} />
          </div>
          {plan ? (
            <p className="meta tnum">
              使う長さ {fmtSec(plan.usedMs)} 秒。
              {plan.silentTailMs > 0 ? ` 残り ${fmtSec(plan.silentTailMs)} 秒は無音です。` : audio.sourceOutMs - audio.sourceInMs > D ? ` 動画の終わり（${fmtSec(D)} 秒）で切られます。` : ''}
              {plan.fade ? ` 最後の ${fmtSec(plan.fade.endMs - plan.fade.startMs)} 秒でフェードアウト。` : ''}
            </p>
          ) : null}
          <label className="field">
            <span className="field__label">音量 <span className="tnum">{Math.round(audio.volume * 100)}%</span></span>
            <input type="range" min={0} max={100} step={1} value={Math.round(audio.volume * 100)} onChange={(e) => patch({ volume: Number(e.target.value) / 100 }, false)} onPointerUp={() => onCommitFrom(project)} onKeyUp={() => onCommitFrom(project)} aria-label="音量" />
          </label>
          <label className="check">
            <input type="checkbox" checked={audio.fadeOutMs > 0} onChange={(e) => patch({ fadeOutMs: e.target.checked ? LIMITS.audio.fadeOutMs : 0 })} /> 最後をフェードアウト（最大 1 秒）
          </label>
          <div className="btn-row wrap">
            <button type="button" className="btn btn--small" onClick={() => fileRef.current?.click()}>別の音源にする</button>
            <button type="button" className="btn btn--small btn--danger" onClick={() => onCommit(setAudio(project, undefined))}>音楽なしにする</button>
          </div>
          <p className="meta">音楽を変えても写真の切り替え時刻は変わりません。</p>
        </>
      )}
      {error ? <Notice kind="error" title="音源を使えません">{error}</Notice> : null}
    </div>
  );
}
