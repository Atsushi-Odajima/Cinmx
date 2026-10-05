import { createContext, useContext, useSyncExternalStore } from 'react';
import type { EditorSnapshot, EditorStore } from './editor-store';

export const EditorContext = createContext<EditorStore | null>(null);

export function useEditorStore(): EditorStore {
  const s = useContext(EditorContext);
  if (!s) throw new Error('EditorContext がありません');
  return s;
}

export function useEditor(): EditorSnapshot & { store: EditorStore } {
  const store = useEditorStore();
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...snap, store };
}
