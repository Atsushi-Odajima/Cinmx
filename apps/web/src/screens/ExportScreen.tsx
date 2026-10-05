import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { isProjectComplete, totalDurationMs } from '@cinemix/core';
import type { ExportProgress, ExportResult, RenderCapabilities } from '@cinemix/platform';
import { ExportError, decideExportAd, localDateKey } from '@cinemix/platform';
import type { ExportRow } from '@cinemix/storage';
import { AppHeader } from '../components/AppHeader';
import { Notice } from '../components/Notice';
import { useEditor } from '../state/use-editor';
import { adService, exportStore, purchaseService, renderAdapter, settingsStore, shareAdapter } from '../services';
import { fmtBytes, fmtDateTime, fmtSec } from '../services/format';

type Phase = { kind: 'idle' } | { kind: 'running'; progress: ExportProgress } | { kind: 'done'; result: ExportResult; url: string } | { kind: 'error'; error: ExportError; canRetryWithoutAudio: boolean };

export function ExportScreen() {
  const nav = useNavigate();
  const { project, assets, store } = useEditor();
  const [caps, setCaps] = useState<RenderCapabilities | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [previous, setPrevious] = useState<{ row: ExportRow; url: string } | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [adNotice, setAdNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const jobIdRef = useRef<string>(crypto.randomUUID());
  const D = totalDurationMs(project.templateSnapshot);
  const { complete, missing } = isProjectComplete(project);

  useEffect(() => {
    void renderAdapter.capabilities().then(setCaps);
    void exportStore.get(project.id).then((row) => {
      if (row) setPrevious({ row, url: URL.createObjectURL(row.blob) });
    });
    return () => {
      abortRef.current?.abort();
    };
  }, [project.id]);

  useEffect(() => () => {
    if (phase.kind === 'done') URL.revokeObjectURL(phase.url);
  }, [phase]);

  const run = async (withoutAudio: boolean) => {
    if (!complete) return;
    await store.flush();
    const ac = new AbortController();
    abortRef.current = ac;
    setShareMsg(null);
    setPhase({ kind: 'running', progress: { phase: 'preparing', ratio: 0, framesDone: 0, framesTotal: 0, message: '準備しています' } });
    // 将来の広告（試作では NoOp／開発時のみ「テスト広告」）。失敗しても書き出しは止めない。
    try {
      const adFree = await purchaseService.hasAdFree();
      const key = `exports:${localDateKey()}`;
      const count = await settingsStore.get<number>(key, 0);
      const shown = new Set(await settingsStore.get<string[]>('ads:shownJobs', []));
      const decision = decideExportAd({ adFree, successfulExportsToday: count, jobId: jobIdRef.current, shownJobIds: shown });
      if (decision.placement !== 'none' && adService.mode !== 'noop') {
        const r = await adService.show(decision.placement, { jobId: jobIdRef.current });
        if (r === 'shown') {
          setAdNotice(`テスト広告（${decision.placement}）を表示しました。実広告 SDK は接続していません。`);
          await settingsStore.set('ads:shownJobs', [...shown, jobIdRef.current].slice(-50));
        }
      }
    } catch {
      /* 広告の失敗で動画作成を止めない */
    }
    try {
      const result = await renderAdapter.export(project, assets, (p) => setPhase({ kind: 'running', progress: p }), ac.signal, { withoutAudio });
      const url = URL.createObjectURL(result.blob);
      setPhase({ kind: 'done', result, url });
      try {
        await exportStore.put({ projectId: project.id, blob: result.blob, mime: result.mime, extension: result.extension, createdAt: new Date().toISOString(), durationMs: result.durationMs, hasAudio: result.hasAudio, width: result.width, height: result.height, path: result.path });
        const key = `exports:${localDateKey()}`;
        await settingsStore.set(key, (await settingsStore.get<number>(key, 0)) + 1);
      } catch {
        /* 保存に失敗しても動画自体は共有できる */
      }
    } catch (e) {
      const err = e instanceof ExportError ? e : new ExportError('unknown', (e as Error)?.message ?? String(e), e);
      const canRetryWithoutAudio = !!project.audio && !withoutAudio && (err.code === 'audio' || err.code === 'unsupported' || err.code === 'encoder');
      setPhase({ kind: 'error', error: err, canRetryWithoutAudio });
    } finally {
      abortRef.current = null;
    }
  };

  const share = async (blob: Blob, ext: string) => {
    const name = `${(project.title || 'cinemix').replace(/[\\/:*?"<>|]/g, '_')}.${ext}`;
    const file = new File([blob], name, { type: blob.type });
    if (shareAdapter.canShare(file)) {
      const out = await shareAdapter.shareFile(file, project.title);
      if (out === 'shared') setShareMsg('共有シートを開きました。「ビデオを保存」で写真アプリに保存できます（端末により表示が異なります）。');
      else if (out === 'cancelled') setShareMsg('共有をキャンセルしました。動画はそのまま残っています。');
      else {
        shareAdapter.download(blob, name);
        setShareMsg('共有に対応していないため、ダウンロードしました。');
      }
    } else {
      shareAdapter.download(blob, name);
      setShareMsg('この環境では共有シートが使えないため、ダウンロードしました。Safari では「ダウンロード」→ファイルを開き、共有から「ビデオを保存」を選びます。');
    }
  };

  const audioLabel = !project.audio ? '音楽なし' : caps?.audioSupport === 'aac' ? '音楽あり（AAC）' : caps?.audioSupport === 'mp3' ? '音楽あり（この端末では MP3 で保存）' : caps?.audioSupport === 'platform' ? '音楽あり' : caps ? '音楽あり（この端末では音声を保存できません）' : '音楽あり';

  return (
    <main className="page">
      <AppHeader back={`/projects/${project.id}/edit`} title="保存" />
      <h1 className="h2">動画を書き出す</h1>
      <ul className="plainlist">
        <li>720×1280・30fps・MP4（H.264）・長さ <span className="tnum">{fmtSec(D)}</span> 秒</li>
        <li>{audioLabel}</li>
        <li>素材は端末内で処理され、サーバーへ送信されません。</li>
      </ul>
      {!complete ? <Notice kind="warning" title={`素材があと ${missing} 点足りません`} actions={<Link to={`/projects/${project.id}/media`} className="btn btn--small">素材へ</Link>} /> : null}
      {caps && caps.recommendedPath === null ? (
        <Notice kind="error" title="この端末では動画を保存できません">
          {caps.notes.join(' ')} 編集と下書き保存は使えます。別の端末（iOS 16.4 以降の Safari など）で下書きを開くには、下書き画面のバックアップをお使いください。
        </Notice>
      ) : null}
      {caps && caps.recommendedPath === 'media-recorder' ? <Notice kind="warning" title="実時間録画で書き出します">{caps.notes.join(' ')}</Notice> : null}
      {caps && caps.recommendedPath === 'webcodecs' && project.audio && caps.audioSupport === 'none' ? (
        <Notice kind="warning" title="この端末では音声付きで保存できません">「音声なしで保存」を明示的に選べます。音楽の設定は下書きに残ります。</Notice>
      ) : null}
      {adNotice ? <Notice kind="info">{adNotice}</Notice> : null}

      {phase.kind === 'idle' || phase.kind === 'error' ? (
        <div className="btn-col">
          <p className="meta">書き出し中はこの画面を開いたままお待ちください。画面ロックや他のアプリへの切り替えで中断されることがあります。</p>
          <button type="button" className="btn btn--primary btn--block" disabled={!complete || !caps || caps.recommendedPath === null || (!!project.audio && caps.audioSupport === 'none')} onClick={() => void run(false)}>
            {project.audio ? '音楽付きで書き出す' : '書き出す'}
          </button>
          {project.audio && caps && caps.recommendedPath !== null ? (
            <button type="button" className="btn btn--block" disabled={!complete} onClick={() => void run(true)}>
              音声なしで保存
            </button>
          ) : null}
        </div>
      ) : null}

      {phase.kind === 'running' ? (
        <section className="progress" aria-live="polite">
          <p>
            <strong>{phase.progress.message}</strong>
          </p>
          <progress className="progress__bar" max={1} value={phase.progress.ratio} aria-label="書き出しの進捗" />
          <p className="meta tnum">
            {phase.progress.framesTotal > 0 ? `${phase.progress.framesDone} / ${phase.progress.framesTotal} フレーム` : ''}
          </p>
          <button type="button" className="btn" onClick={() => abortRef.current?.abort()}>キャンセル</button>
        </section>
      ) : null}

      {phase.kind === 'error' ? (
        <Notice
          kind={phase.error.code === 'cancelled' ? 'info' : 'error'}
          title={phase.error.code === 'cancelled' ? 'キャンセルしました' : phase.error.code === 'interrupted' ? '中断されました' : '書き出しに失敗しました'}
          actions={
            <>
              <button type="button" className="btn btn--small" onClick={() => void run(false)}>もう一度試す</button>
              {phase.canRetryWithoutAudio ? <button type="button" className="btn btn--small" onClick={() => void run(true)}>音声なしで保存</button> : null}
              <Link to={`/projects/${project.id}/edit`} className="btn btn--small">編集へ戻る</Link>
            </>
          }
        >
          {phase.error.message}
          {phase.error.code === 'font' ? ' フォントの取得に失敗しています。通信状態を確認してください。' : ''}
          {phase.error.code === 'asset' ? ' 素材画面で該当の素材を差し替えてください。' : ''}
          <br />
          <span className="meta">下書きはそのまま残っています（エラーコード: {phase.error.code}）。</span>
        </Notice>
      ) : null}

      {phase.kind === 'done' ? (
        <section className="result">
          <Notice kind="success" title="動画ができました">
            {phase.result.width}×{phase.result.height} · {fmtSec(phase.result.durationMs)} 秒 · {fmtBytes(phase.result.blob.size)} · {phase.result.extension.toUpperCase()}
            {phase.result.hasAudio ? `（音声: ${phase.result.audioCodec === 'mp3' ? 'MP3' : phase.result.audioCodec === 'aac' ? 'AAC' : 'あり'}）` : '（音声なし）'} · 所要 {Math.round(phase.result.elapsedMs / 1000)} 秒
          </Notice>
          <video className="result__video" src={phase.url} controls playsInline preload="metadata" aria-label="書き出した動画" />
          <div className="btn-col">
            <button type="button" className="btn btn--primary btn--block" onClick={() => void share(phase.result.blob, phase.result.extension)}>共有／保存</button>
            <a className="btn btn--block" href={phase.url} download={`${(project.title || 'cinemix').replace(/[\\/:*?"<>|]/g, '_')}.${phase.result.extension}`}>ダウンロード</a>
            <Link to={`/projects/${project.id}/edit`} className="btn btn--block">編集へ戻る</Link>
          </div>
          {shareMsg ? <p className="meta">{shareMsg}</p> : null}
          <p className="meta">Safari から写真アプリへ自動保存はできません。共有シートの「ビデオを保存」をお使いください。</p>
        </section>
      ) : null}

      {previous && phase.kind === 'idle' ? (
        <section className="result">
          <h2>前回の書き出し</h2>
          <p className="meta tnum">{fmtDateTime(previous.row.createdAt)} · {fmtSec(previous.row.durationMs)} 秒 · {previous.row.hasAudio ? '音声あり' : '音声なし'} · {fmtBytes(previous.row.blob.size)}</p>
          <video className="result__video" src={previous.url} controls playsInline preload="metadata" />
          <div className="btn-row">
            <button type="button" className="btn btn--small" onClick={() => void share(previous.row.blob, previous.row.extension)}>共有／保存</button>
            <button type="button" className="btn btn--small btn--danger" onClick={() => void exportStore.delete(project.id).then(() => setPrevious(null))}>削除</button>
          </div>
        </section>
      ) : null}
      <p className="meta"><button type="button" className="linklike" onClick={() => nav('/account')}>能力診断を見る</button></p>
    </main>
  );
}
