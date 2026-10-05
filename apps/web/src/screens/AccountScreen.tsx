import { useEffect, useState } from 'react';
import type { RenderCapabilities } from '@cinemix/platform';
import { estimateStorage } from '@cinemix/storage';
import { AppHeader } from '../components/AppHeader';
import { Notice } from '../components/Notice';
import { assetStore, cloudClient, isCloudConfigured, projectStore, purchaseService, renderAdapter } from '../services';
import { fmtBytes } from '../services/format';
import { Link } from 'react-router-dom';

export function AccountScreen() {
  const [caps, setCaps] = useState<RenderCapabilities | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean | null } | null>(null);
  const [assetsBytes, setAssetsBytes] = useState(0);
  const [msg, setMsg] = useState<{ kind: 'info' | 'success' | 'warning' | 'error'; text: string } | null>(null);
  const [user, setUser] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [purchaseMsg, setPurchaseMsg] = useState<string | null>(null);

  const refresh = async () => {
    setStorage(await estimateStorage());
    setAssetsBytes(await assetStore.totalBytes());
  };
  useEffect(() => {
    void renderAdapter.capabilities().then(setCaps);
    void refresh();
    const cc = cloudClient;
    if (cc) {
      void cc.getSession().then((s) => setUser(s?.user.email ?? null));
      void cc.isAdmin().then(setIsAdmin);
      return cc.onAuthChange((s) => {
        setUser(s?.user.email ?? null);
        void cc.isAdmin().then(setIsAdmin);
      });
    }
    return undefined;
  }, []);

  const login = async (mode: 'password' | 'magic' | 'signup') => {
    if (!cloudClient) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = mode === 'password' ? await cloudClient.signInWithPassword(email, password) : mode === 'signup' ? await cloudClient.signUp(email, password) : await cloudClient.signInWithMagicLink(email, location.origin + '/account');
      if (!r.ok) setMsg({ kind: 'error', text: `ログインできません: ${r.message}。ローカルの編集はそのまま使えます。` });
      else setMsg({ kind: 'success', text: mode === 'magic' ? 'ログイン用のメールを送りました。' : mode === 'signup' && 'needsConfirmation' in r && r.needsConfirmation ? '確認メールを送りました。' : 'ログインしました。' });
    } finally {
      setBusy(false);
    }
  };

  const wipe = async () => {
    if (!confirm('この端末に保存した下書き・素材・テンプレート・書き出した動画をすべて削除します。元に戻せません。続けますか？')) return;
    const { Dexie } = await import('dexie');
    await Dexie.delete('cinemix');
    setMsg({ kind: 'success', text: 'すべてのデータを削除しました。ページを再読み込みしてください。' });
  };

  return (
    <main className="page">
      <AppHeader back="/templates" title="設定" />
      <h1 className="h2">設定・診断</h1>
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}

      <section>
        <h2>アカウント（テンプレート投稿用）</h2>
        {!isCloudConfigured ? (
          <Notice kind="info" title="オンライン共有は未接続">
            サーバー設定（Supabase の URL と publishable key）が未設定のため、投稿・オンライン一覧は使えません。閲覧・ローカル制作・動画の書き出しはログイン不要で使えます。設定方法は docs/SETUP_CLOUD.txt。
          </Notice>
        ) : user ? (
          <div className="btn-col">
            <p>ログイン中: <strong>{user}</strong>{isAdmin ? '（管理者）' : ''}</p>
            {isAdmin ? <Link to="/admin" className="btn">管理画面（審査）</Link> : null}
            <button type="button" className="btn" onClick={() => void cloudClient?.signOut()}>ログアウト</button>
          </div>
        ) : (
          <form className="textform" onSubmit={(e) => { e.preventDefault(); void login('password'); }}>
            <label className="field"><span className="field__label">メール</span><input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="field"><span className="field__label">パスワード</span><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            <div className="btn-row wrap">
              <button type="submit" className="btn btn--primary" disabled={busy}>ログイン</button>
              <button type="button" className="btn" disabled={busy} onClick={() => void login('signup')}>新規登録</button>
              <button type="button" className="btn" disabled={busy} onClick={() => void login('magic')}>メールのリンクでログイン</button>
            </div>
            <p className="meta">ログインは投稿時だけ必要です。閲覧とローカル制作はログイン不要。</p>
          </form>
        )}
      </section>

      <section>
        <h2>ストレージ</h2>
        <p className="tnum">
          素材 {fmtBytes(assetsBytes)}{storage ? ` · ブラウザ使用量 ${fmtBytes(storage.usage)} / 目安 ${fmtBytes(storage.quota)}${storage.persisted === false ? '（永続化なし: Safari のデータ削除で消えることがあります）' : ''}` : ''}
        </p>
        <div className="btn-row wrap">
          <button type="button" className="btn btn--small" onClick={() => void projectStore.collectOrphanAssets().then((r) => { setMsg({ kind: 'success', text: `未使用の素材を ${r.removed} 件（${fmtBytes(r.bytes)}）削除しました。` }); void refresh(); })}>未使用の素材を削除</button>
          <button type="button" className="btn btn--small btn--danger" onClick={() => void wipe()}>すべてのデータを削除</button>
        </div>
        <p className="meta">下書きと素材はこの端末のブラウザ内（IndexedDB）に保存され、サーバーには送られません。</p>
      </section>

      <section>
        <h2>広告と広告解除</h2>
        <p>この Web 試作には広告・課金はありません。将来の iPhone アプリ版では、上部の広告枠・書き出し時の広告と、月額 500 円の広告解除を予定しています。</p>
        <button type="button" className="btn btn--small" onClick={() => void purchaseService.purchaseAdFree().then((r) => setPurchaseMsg(r.message))}>広告解除について</button>
        {purchaseMsg ? <p className="meta">{purchaseMsg}</p> : null}
      </section>

      <section>
        <h2>能力診断</h2>
        {caps ? (
          <>
            <ul className="plainlist">
              <li>HTTPS（secure context）: {caps.secureContext ? 'はい' : 'いいえ'}</li>
              <li>WebCodecs H.264 エンコード: {caps.webcodecs.avc ? '可' : '不可'} / AAC: {caps.webcodecs.aac ? '可' : '不可'}{caps.webcodecs.mp3Fallback ? ' / MP3 代替: 可' : ''}</li>
              <li>MediaRecorder: {caps.mediaRecorder.available ? `あり（MP4 ${caps.mediaRecorder.mp4 ? '可' : '不可'} / WebM ${caps.mediaRecorder.webm ? '可' : '不可'}）` : 'なし'}</li>
              <li>推奨経路: {caps.recommendedPath ?? '動画保存不可'} · 音声: {caps.audioSupport}</li>
              <li>共有シート（ファイル）: {caps.share.files ? '可' : '不可'} · Wake Lock: {caps.wakeLock ? '可' : '不可'}</li>
            </ul>
            {caps.notes.length ? <p className="meta">{caps.notes.join(' ')}</p> : null}
            <details>
              <summary>診断の詳細（JSON）</summary>
              <pre className="pre">{JSON.stringify({ ...caps, userAgent: navigator.userAgent, version: __APP_VERSION__ }, null, 2)}</pre>
            </details>
          </>
        ) : (
          <p className="muted">検査しています…</p>
        )}
      </section>

      <section>
        <h2>利用条件・プライバシー（草稿）</h2>
        <p className="meta">
          素材は端末内で処理され、動画合成のためにサーバーへ送信されません。オンライン共有を使う場合、テンプレート定義・表紙・背景写真だけがサーバーへ送られます。診断ログには素材のサイズ・形式・エラーコードのみを記録します。全文は docs/ の利用規約・プライバシー草稿を参照してください。
        </p>
      </section>
    </main>
  );
}
