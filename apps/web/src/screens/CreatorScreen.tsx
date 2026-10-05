import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Asset, BaseLayoutId, Project, Template } from '@cinemix/core';
import { BASE_LAYOUTS, LIMITS, assignAssetsInOrder, clampCropCenter, createProjectFromTemplate, getBaseLayout, makeSlots, newId, templateSchema, totalDurationMs } from '@cinemix/core';
import { buildTemplatePackage, readTemplatePackage, TEMPLATE_PACKAGE_EXTENSION, StorageError } from '@cinemix/storage';
import { PreviewPlayer, reencodeJpeg, renderStill, type PreviewState } from '@cinemix/render-web';
import { AppHeader } from '../components/AppHeader';
import { Notice } from '../components/Notice';
import { NumberField } from '../components/NumberField';
import { assetStore, cloudClient, cloudTemplates, isCloudConfigured, loadBlob, localTemplateStore, mediaAdapter } from '../services';
import { fmtSec } from '../services/format';

const LICENSES_TEXT = `CinemiX template package
template.json: このテンプレートの定義（枠・時間・色）。作者がローカルで作成。
cover.png / preview.mp4: CinemiX 同梱の中立サンプル素材と同じ描画エンジンで生成。
background.jpg（任意）: 作者が提供した背景写真。EXIF/GPS は除去済み。再配布の許諾は作者が確認すること。
`;

const SAMPLE_FILES = ['sample-01.jpg', 'sample-02.jpg', 'sample-03.jpg', 'sample-04.jpg', 'sample-05.jpg'];

function emptyTemplate(base: BaseLayoutId): Template {
  const b = getBaseLayout(base);
  return {
    id: newId(),
    version: 1,
    name: `マイ ${b.label}`,
    description: '',
    baseLayoutId: base,
    aspectRatio: '9:16',
    canvasBackground: b.defaultBackground,
    backgroundTransform: { centerX: 0.5, centerY: 0.5, scale: 1 },
    slots: makeSlots(b, Array.from({ length: LIMITS.defaultSlotCount }, () => LIMITS.defaultSlotDurationMs), () => newId()),
    frameStyle: b.frameStyle,
    requiredAssetCount: LIMITS.defaultSlotCount,
  };
}

/** 中立サンプル素材でプレビュー用プロジェクトを作る（私的素材は使わない） */
async function sampleProjectFor(template: Template): Promise<{ project: Project; assets: Map<string, Asset> }> {
  const ids: string[] = [];
  for (let i = 0; i < template.slots.length; i++) {
    const name = SAMPLE_FILES[i % SAMPLE_FILES.length]!;
    const key = `sample-asset:${name}`;
    let id = sessionStorage.getItem(key);
    if (!id || !(await assetStore.get(id))) {
      const blob = await (await fetch(`/samples/${name}`)).blob();
      const [r] = await mediaAdapter.import([new File([blob], name, { type: 'image/jpeg' })], ['image']);
      if (!r?.asset) throw new Error('サンプル素材を読み込めません');
      id = r.asset.id;
      sessionStorage.setItem(key, id);
    }
    ids.push(id);
  }
  let project = assignAssetsInOrder(createProjectFromTemplate(template, 'preview'), ids).project;
  project = { ...project, templateSnapshot: template };
  const assets = await assetStore.getMany([...ids, ...(template.backgroundAssetId ? [template.backgroundAssetId] : [])]);
  return { project, assets };
}

export function CreatorScreen() {
  const nav = useNavigate();
  const { id } = useParams();
  const [tpl, setTpl] = useState<Template | null>(null);
  const [step, setStep] = useState<'base' | 'edit'>('base');
  const [msg, setMsg] = useState<{ kind: 'info' | 'success' | 'warning' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'none' | 'background' | 'durations' | 'publish'>('none');
  const [preview, setPreview] = useState<{ project: Project; assets: Map<string, Asset> } | null>(null);
  const [pstate, setPstate] = useState<PreviewState | null>(null);
  const [cloudSaved, setCloudSaved] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<PreviewPlayer | null>(null);
  const bgRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    void localTemplateStore.get(id).then((row) => {
      if (row) {
        setTpl(row.template);
        setStep('edit');
        if (row.cloud) setCloudSaved(`${row.cloud.visibility === 'public' ? '公開' : '非公開'} / ${row.cloud.moderationStatus}`);
      }
    });
  }, [id]);

  // プレビュー（サンプル素材）
  useEffect(() => {
    if (!tpl || step !== 'edit') return;
    let alive = true;
    void sampleProjectFor(tpl).then((p) => alive && setPreview(p)).catch((e) => setMsg({ kind: 'error', text: (e as Error).message }));
    return () => {
      alive = false;
    };
  }, [tpl, step]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !preview) return;
    if (!playerRef.current) {
      playerRef.current = new PreviewPlayer(c, preview.project, preview.assets, loadBlob);
      playerRef.current.subscribe(setPstate);
    } else playerRef.current.update(preview.project, preview.assets);
  }, [preview]);
  useEffect(() => () => playerRef.current?.dispose(), []);

  const total = tpl ? totalDurationMs(tpl) : 0;
  const validation = useMemo(() => (tpl ? templateSchema.safeParse(tpl) : null), [tpl]);
  const issues = validation && !validation.success ? validation.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) : [];

  const update = (patch: Partial<Template>) => setTpl((t) => (t ? { ...t, ...patch } : t));
  const setSlotCount = (n: number) => {
    if (!tpl) return;
    const b = getBaseLayout(tpl.baseLayoutId);
    const durations = Array.from({ length: n }, (_, i) => tpl.slots[i]?.durationMs ?? LIMITS.defaultSlotDurationMs);
    update({ slots: makeSlots(b, durations, (i) => tpl.slots[i]?.id ?? newId()), requiredAssetCount: n });
  };
  const setDuration = (i: number, sec: number) => {
    if (!tpl) return;
    const ms = Math.round(sec * 10) * 100;
    update({ slots: tpl.slots.map((s) => (s.index === i ? { ...s, durationMs: Math.min(LIMITS.maxSlotDurationMs, Math.max(LIMITS.minSlotDurationMs, ms)) } : s)) });
  };

  const pickBackground = async (file: File) => {
    if (!tpl) return;
    setBusy('bg');
    try {
      const [r] = await mediaAdapter.import([file], ['image']);
      if (!r?.asset) {
        setMsg({ kind: 'error', text: r && !r.result.ok ? `${r.result.message} — ${r.result.hint}` : '背景を読み込めません' });
        return;
      }
      update({ backgroundAssetId: r.asset.id, backgroundTransform: { centerX: 0.5, centerY: 0.5, scale: 1 } });
      setMsg({ kind: 'info', text: '背景写真を設定しました。公開パッケージに含める場合、この写真は再エンコード（EXIF/GPS 除去）されて他の利用者に配布されます。' });
    } finally {
      setBusy(null);
      if (bgRef.current) bgRef.current.value = '';
    }
  };

  const makeCover = async (): Promise<Blob> => {
    if (!preview) throw new Error('プレビューが準備できていません');
    return renderStill(preview.project, preview.assets, loadBlob, Math.min(1500, total - 1), { width: 360, type: 'image/png' });
  };

  const saveLocal = async () => {
    if (!tpl || !validation?.success) return;
    setBusy('save');
    try {
      const cover = await makeCover();
      await localTemplateStore.save(validation.data, { origin: 'local', coverBlob: cover, ...(tpl.backgroundAssetId ? { backgroundAssetId: tpl.backgroundAssetId } : {}) });
      setMsg({ kind: 'success', text: `この端末に保存しました（${isCloudConfigured ? 'オンライン共有は「投稿」から' : 'オンライン共有は未接続'}）。テンプレート一覧に表示されます。` });
      if (!id) nav(`/creator/${tpl.id}`, { replace: true });
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const exportPackage = async () => {
    if (!tpl || !validation?.success) return;
    const files = ['template.json', 'cover.png', 'licenses.txt', ...(tpl.backgroundAssetId ? ['background.jpg（あなたの背景写真・公開されます）'] : [])];
    if (!confirm(`次のファイルをパッケージに含めます:\n${files.join('\n')}\n\nあなたの写真・動画素材、文字、BGM は含まれません。続けますか？`)) return;
    setBusy('zip');
    try {
      const cover = await makeCover();
      let backgroundJpeg: Blob | undefined;
      if (tpl.backgroundAssetId) {
        const b = await loadBlob(tpl.backgroundAssetId);
        if (b) backgroundJpeg = (await reencodeJpeg(b)).blob;
      }
      const zip = await buildTemplatePackage({ template: validation.data, coverPng: cover, licensesText: LICENSES_TEXT, ...(backgroundJpeg ? { backgroundJpeg } : {}) });
      const name = `${tpl.name}${TEMPLATE_PACKAGE_EXTENSION}`.replace(/[\\/:*?"<>|]/g, '_');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(zip);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      setMsg({ kind: 'success', text: `パッケージを書き出しました（${name}）。` });
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const importPackage = async (file: File) => {
    setBusy('import');
    try {
      const contents = readTemplatePackage(new Uint8Array(await file.arrayBuffer()));
      let template = { ...contents.template, id: newId(), version: 1 };
      if (contents.background) {
        const [r] = await mediaAdapter.import([new File([contents.background as BlobPart], 'background.jpg', { type: 'image/jpeg' })], ['image']);
        if (r?.asset) template = { ...template, backgroundAssetId: r.asset.id };
      }
      await localTemplateStore.save(template, { origin: 'imported', coverBlob: new Blob([contents.cover as BlobPart], { type: 'image/png' }), ...(contents.preview ? { previewBlob: new Blob([contents.preview as BlobPart], { type: 'video/mp4' }) } : {}) });
      setMsg({ kind: 'success', text: `「${template.name}」を読み込みました。テンプレート一覧から使えます。` });
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof StorageError ? `読み込めません: ${e.message}` : (e as Error).message });
    } finally {
      setBusy(null);
      if (importRef.current) importRef.current.value = '';
    }
  };

  const publish = async () => {
    if (!tpl || !validation?.success || !cloudTemplates || !cloudClient) return;
    setBusy('publish');
    try {
      const session = await cloudClient.getSession();
      if (!session) {
        setMsg({ kind: 'warning', text: '投稿にはログインが必要です。設定画面からログインしてください。' });
        nav('/account');
        return;
      }
      const cover = await makeCover();
      let backgroundJpeg: Blob | undefined;
      if (tpl.backgroundAssetId) {
        const b = await loadBlob(tpl.backgroundAssetId);
        if (b) backgroundJpeg = (await reencodeJpeg(b)).blob;
      }
      const r = await cloudTemplates.publish({ template: validation.data, coverPng: cover, licensesText: LICENSES_TEXT, visibility, ...(backgroundJpeg ? { backgroundJpeg } : {}) });
      if ('status' in r) {
        setMsg({ kind: 'warning', text: 'ログインが必要です。' });
        return;
      }
      await localTemplateStore.save(validation.data, { cloud: { remoteId: r.remoteId, version: r.version, visibility: r.visibility, moderationStatus: r.moderationStatus, syncedAt: new Date().toISOString() } });
      setCloudSaved(`${r.visibility === 'public' ? '公開' : '非公開'} / ${r.moderationStatus}`);
      setMsg({ kind: 'success', text: r.visibility === 'public' ? `投稿しました（バージョン ${r.version}）。公開は審査後です（現在: 審査中）。` : `非公開で保存しました（バージョン ${r.version}）。` });
      setSheet('none');
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  if (step === 'base' || !tpl) {
    return (
      <main className="page">
        <AppHeader back="/templates" title="作る" />
        <h1 className="h2">自分のテンプレートを作る</h1>
        <p className="meta">既定のレイアウトを選びます。枠の形と演出は固定で、名前・説明・各枠の秒数・背景（色または写真）を変えられます。独自の効果をプログラムすることはできません。</p>
        {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
        <div className="btn-col">
          {BASE_LAYOUTS.map((b) => (
            <button key={b.id} type="button" className="basecard" onClick={() => { setTpl(emptyTemplate(b.id)); setStep('edit'); }}>
              <strong>{b.label}</strong>
              <span className="meta">{b.description}</span>
            </button>
          ))}
        </div>
        <section className="restore">
          <h2>パッケージを読み込む</h2>
          <input ref={importRef} data-testid="template-import-input" type="file" accept=".zip,application/zip" className="visually-hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importPackage(f); }} />
          <button type="button" className="btn" onClick={() => importRef.current?.click()} disabled={busy === 'import'}>{busy === 'import' ? '確認しています…' : '.cinemix-template.zip を選ぶ'}</button>
          <p className="meta">読み込み時に、ファイル名・種類・サイズ（25MB・100 ファイル未満）・JSON の内容を検証します。スクリプトや HTML は受け付けません。</p>
        </section>
      </main>
    );
  }

  const base = getBaseLayout(tpl.baseLayoutId);
  return (
    <main className="page page--creator">
      <AppHeader back={() => (id ? nav('/templates') : setStep('base'))} title="作る" />
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
      <section className="editor">
        <div className="editor__preview">
          <div className="preview" style={{ aspectRatio: '9 / 16' }}>
            <canvas ref={canvasRef} className="preview__canvas" aria-label="テンプレートの見本（中立なサンプル素材）" />
          </div>
        </div>
        <div className="transport">
          <button type="button" className="btn btn--icon" aria-label={pstate?.playing ? '一時停止' : '再生'} onClick={() => (pstate?.playing ? playerRef.current?.pause() : void playerRef.current?.play())} disabled={!pstate?.ready}>
            {pstate?.playing ? '⏸' : '▶'}
          </button>
          <span className="tnum">合計 {fmtSec(total)} 秒 / 上限 {LIMITS.maxDurationMs / 1000} 秒</span>
        </div>
      </section>
      <form className="textform" onSubmit={(e) => e.preventDefault()}>
        <p className="meta">ベース: {base.label}（枠の形・演出は固定）</p>
        <label className="field">
          <span className="field__label">テンプレート名（{tpl.name.length}/40）</span>
          <input className="input" maxLength={40} value={tpl.name} onChange={(e) => update({ name: e.target.value })} />
        </label>
        <label className="field">
          <span className="field__label">説明（{tpl.description.length}/200）</span>
          <textarea className="input" rows={2} maxLength={200} value={tpl.description} onChange={(e) => update({ description: e.target.value })} />
        </label>
        <div className="btn-row wrap">
          <button type="button" className="btn" onClick={() => setSheet('durations')}>枠の数と秒数</button>
          <button type="button" className="btn" onClick={() => setSheet('background')}>背景</button>
        </div>
        {issues.length > 0 ? <Notice kind="error" title="修正が必要です">{issues.join(' / ')}</Notice> : null}
        {total > LIMITS.maxDurationMs ? <Notice kind="error">合計が 30 秒を超えています（{fmtSec(total)} 秒）。修正するまで保存・投稿できません。</Notice> : null}
        <div className="btn-col">
          <button type="button" className="btn btn--primary btn--block" onClick={() => void saveLocal()} disabled={!validation?.success || busy !== null}>{busy === 'save' ? '保存しています…' : 'この端末に保存'}</button>
          <button type="button" className="btn btn--block" onClick={() => void exportPackage()} disabled={!validation?.success || busy !== null}>パッケージを書き出す（.cinemix-template.zip）</button>
          {isCloudConfigured ? (
            <button type="button" className="btn btn--block" onClick={() => setSheet('publish')} disabled={!validation?.success || busy !== null}>投稿（オンライン共有）</button>
          ) : (
            <button type="button" className="btn btn--block" disabled aria-disabled="true" title="オンライン共有は未接続">オンライン共有は未接続</button>
          )}
          {cloudSaved ? <p className="meta">オンライン: {cloudSaved}</p> : null}
        </div>
      </form>

      {sheet === 'durations' ? (
        <div className="sheet-backdrop" onClick={() => setSheet('none')} role="presentation">
          <div className="sheet" role="dialog" aria-modal="true" aria-label="枠の数と秒数" onClick={(e) => e.stopPropagation()}>
            <div className="sheet__head"><h2 className="sheet__title">枠の数と秒数</h2><button type="button" className="btn btn--ghost" onClick={() => setSheet('none')}>閉じる</button></div>
            <div className="sheet__body">
              <NumberField id="slot-count" label={`枠の数（${LIMITS.minSlots}〜${LIMITS.maxSlots}）`} value={tpl.slots.length} min={LIMITS.minSlots} max={LIMITS.maxSlots} step={1} onChange={(v) => setSlotCount(Math.round(v))} />
              <p className="tnum">合計 {fmtSec(total)} 秒 / 30 秒</p>
              {[...tpl.slots].sort((a, b) => a.index - b.index).map((s) => (
                <NumberField key={s.id} id={`dur-${s.index}`} label={`${String(s.index + 1).padStart(2, '0')} の秒数（1〜8）`} value={s.durationMs / 1000} min={1} max={8} step={0.1} unit="秒" onChange={(v) => setDuration(s.index, v)} />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {sheet === 'background' ? (
        <div className="sheet-backdrop" onClick={() => setSheet('none')} role="presentation">
          <div className="sheet" role="dialog" aria-modal="true" aria-label="背景" onClick={(e) => e.stopPropagation()}>
            <div className="sheet__head"><h2 className="sheet__title">背景</h2><button type="button" className="btn btn--ghost" onClick={() => setSheet('none')}>閉じる</button></div>
            <div className="sheet__body">
              <div className="field">
                <span className="field__label">背景色</span>
                <div className="swatches">
                  {['#25382E', '#59665D', '#F3F0E7', '#FFFCF4', '#C8CDC2', '#315C41', '#805A14', '#963E35'].map((c) => (
                    <button key={c} type="button" className={`swatch ${tpl.canvasBackground.toUpperCase() === c ? 'is-selected' : ''}`} style={{ background: c }} aria-label={c} onClick={() => update({ canvasBackground: c })} />
                  ))}
                  <input className="input input--hex" value={tpl.canvasBackground} aria-label="HEX" onChange={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && update({ canvasBackground: e.target.value })} />
                </div>
              </div>
              <input ref={bgRef} data-testid="background-input" type="file" accept="image/*" className="visually-hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickBackground(f); }} />
              <div className="btn-row wrap">
                <button type="button" className="btn" onClick={() => bgRef.current?.click()} disabled={busy === 'bg'}>背景写真を選ぶ</button>
                {tpl.backgroundAssetId ? <button type="button" className="btn btn--danger" onClick={() => { const t = { ...tpl }; delete t.backgroundAssetId; setTpl(t); }}>背景写真を外す</button> : null}
              </div>
              {tpl.backgroundAssetId ? (
                <>
                  <label className="field"><span className="field__label">位置 X</span><input type="range" min={0} max={1} step={0.01} value={tpl.backgroundTransform.centerX} onChange={(e) => update({ backgroundTransform: clampCropCenter(1600, 1000, 720, 1280, { ...tpl.backgroundTransform, centerX: Number(e.target.value) }) })} /></label>
                  <label className="field"><span className="field__label">位置 Y</span><input type="range" min={0} max={1} step={0.01} value={tpl.backgroundTransform.centerY} onChange={(e) => update({ backgroundTransform: { ...tpl.backgroundTransform, centerY: Number(e.target.value) } })} /></label>
                  <label className="field"><span className="field__label">倍率 <span className="tnum">{tpl.backgroundTransform.scale.toFixed(2)}×</span></span><input type="range" min={1} max={3} step={0.01} value={tpl.backgroundTransform.scale} onChange={(e) => update({ backgroundTransform: { ...tpl.backgroundTransform, scale: Number(e.target.value) } })} /></label>
                </>
              ) : null}
              <p className="meta">背景写真は公開パッケージ・投稿に含まれます（EXIF/GPS は除去）。利用者の素材・文字・BGM は含まれません。</p>
            </div>
          </div>
        </div>
      ) : null}

      {sheet === 'publish' ? (
        <div className="sheet-backdrop" onClick={() => setSheet('none')} role="presentation">
          <div className="sheet" role="dialog" aria-modal="true" aria-label="投稿" onClick={(e) => e.stopPropagation()}>
            <div className="sheet__head"><h2 className="sheet__title">投稿（オンライン共有）</h2><button type="button" className="btn btn--ghost" onClick={() => setSheet('none')}>閉じる</button></div>
            <div className="sheet__body">
              <p>含まれるもの: template.json、cover.png、licenses.txt{tpl.backgroundAssetId ? '、background.jpg（あなたの背景写真）' : ''}。</p>
              <fieldset className="field">
                <legend className="field__label">公開範囲</legend>
                <label className="radio"><input type="radio" checked={visibility === 'private'} onChange={() => setVisibility('private')} /> 非公開（自分だけ）</label>
                <label className="radio"><input type="radio" checked={visibility === 'public'} onChange={() => setVisibility('public')} /> 公開（審査後に他の利用者が使えます）</label>
              </fieldset>
              <p className="meta">公開から非公開へ変更しても、すでにダウンロードされたコピーは回収できません。投稿は上書きではなくバージョンとして保存され、既存の下書きには影響しません。</p>
              <button type="button" className="btn btn--primary btn--block" onClick={() => void publish()} disabled={busy !== null}>{busy === 'publish' ? '送信しています…' : '投稿する'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
