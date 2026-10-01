/**
 * A task's document tabs, live (docs/unify/PLAN.md §3.9): fetched once, then
 * kept current by main's `workspace:docs-changed` pushes. `focus` is the tab
 * someone just opened (you from a file card, or the agent with `dex-open`),
 * for the pane to put in front; `revisions` counts file changes per tab so a
 * viewer reloads when the agent rewrites its file.
 */
import { useEffect, useState } from 'react';

export interface WorkspaceDocs {
  docs: WorkspaceDoc[];
  /** Bumped with a doc id each time one should come to the front. */
  focus: { id: string; seq: number } | null;
  revisions: Record<string, number>;
}

const EMPTY: WorkspaceDocs = { docs: [], focus: null, revisions: {} };

export function useWorkspaceDocs(sessionId: string): WorkspaceDocs {
  const [state, setState] = useState<WorkspaceDocs>(EMPTY);

  useEffect(() => {
    const api = window.electronAPI?.workspace;
    setState(EMPTY);
    if (!api?.docs) return;
    let live = true;
    api.docs(sessionId).then((docs) => { if (live) setState((s) => ({ ...s, docs })); }).catch(() => { /* none */ });
    const offList = api.onDocsChanged((id, docs, focusId) => {
      if (id !== sessionId) return;
      setState((s) => ({
        ...s,
        docs,
        focus: focusId ? { id: focusId, seq: (s.focus?.seq ?? 0) + 1 } : s.focus,
      }));
    });
    const offFile = api.onDocChanged((id, docId) => {
      if (id !== sessionId) return;
      setState((s) => ({ ...s, revisions: { ...s.revisions, [docId]: (s.revisions[docId] ?? 0) + 1 } }));
    });
    return () => {
      live = false;
      offList();
      offFile();
    };
  }, [sessionId]);

  return state;
}
