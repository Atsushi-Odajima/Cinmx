import { BrowserRouter, Routes, Route, Navigate, useParams, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { Project } from '@cinemix/core';
import { EditorStore } from './state/editor-store';
import { EditorContext } from './state/use-editor';
import { projectStore } from './services';
import { TemplatesScreen } from './screens/TemplatesScreen';
import { TemplateDetailScreen } from './screens/TemplateDetailScreen';
import { MediaScreen } from './screens/MediaScreen';
import { EditScreen } from './screens/EditScreen';
import { ExportScreen } from './screens/ExportScreen';
import { DraftsScreen } from './screens/DraftsScreen';
import { CreatorScreen } from './screens/CreatorScreen';
import { AccountScreen } from './screens/AccountScreen';
import { AdminScreen } from './screens/AdminScreen';
import { AppHeader } from './components/AppHeader';
import { Notice } from './components/Notice';
import { Link } from 'react-router-dom';
import './styles/app.css';

function ProjectLoader() {
  const { id } = useParams();
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ready'; store: EditorStore } | { status: 'missing' } | { status: 'corrupt'; reason: string }>({ status: 'loading' });

  useEffect(() => {
    let store: EditorStore | null = null;
    let cancelled = false;
    (async () => {
      if (!id) return setState({ status: 'missing' });
      const res = await projectStore.load(id);
      if (cancelled) return;
      if (res.status === 'ok') {
        store = new EditorStore(res.project as Project);
        await store.init();
        if (cancelled) {
          store.dispose();
          return;
        }
        setState({ status: 'ready', store });
      } else if (res.status === 'corrupt') setState({ status: 'corrupt', reason: res.reason });
      else setState({ status: 'missing' });
    })();
    return () => {
      cancelled = true;
      store?.dispose();
    };
  }, [id]);

  if (state.status === 'loading') return <main className="page"><AppHeader back="/drafts" /><p className="muted">下書きを開いています…</p></main>;
  if (state.status === 'missing')
    return (
      <main className="page">
        <AppHeader back="/drafts" />
        <Notice kind="warning" title="下書きが見つかりません">
          削除されたか、別の端末・ブラウザで作成された下書きです。<br />
          <Link to="/drafts" className="btn btn--primary" style={{ marginTop: 8 }}>下書き一覧へ</Link>
        </Notice>
      </main>
    );
  if (state.status === 'corrupt')
    return (
      <main className="page">
        <AppHeader back="/drafts" />
        <Notice kind="error" title="この下書きは壊れていたため隔離しました">
          {state.reason}
          <br />
          他の下書きは引き続き開けます。隔離した下書きは「下書き」画面から削除できます。
          <br />
          <Link to="/drafts" className="btn btn--primary" style={{ marginTop: 8 }}>下書き一覧へ</Link>
        </Notice>
      </main>
    );
  return (
    <EditorContext.Provider value={state.store}>
      <Outlet />
    </EditorContext.Provider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/templates" replace />} />
        <Route path="/templates" element={<TemplatesScreen />} />
        <Route path="/templates/:id" element={<TemplateDetailScreen />} />
        <Route path="/projects/:id" element={<ProjectLoader />}>
          <Route index element={<Navigate to="media" replace />} />
          <Route path="media" element={<MediaScreen />} />
          <Route path="edit" element={<EditScreen />} />
          <Route path="export" element={<ExportScreen />} />
        </Route>
        <Route path="/drafts" element={<DraftsScreen />} />
        <Route path="/creator" element={<CreatorScreen />} />
        <Route path="/creator/:id" element={<CreatorScreen />} />
        <Route path="/account" element={<AccountScreen />} />
        <Route path="/settings" element={<AccountScreen />} />
        <Route path="/admin" element={<AdminScreen />} />
        <Route path="*" element={<Navigate to="/templates" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
