/**
 * A task's tabs, live: fetched once, then kept current by main's
 * `workspace:tabs-changed` pushes (BrowserPool coalesces them per burst).
 */
import { useEffect, useState } from 'react';

export function useWorkspaceTabs(sessionId: string, enabled: boolean): WorkspaceTab[] {
  const [tabs, setTabs] = useState<WorkspaceTab[]>([]);

  useEffect(() => {
    const api = window.electronAPI?.workspace;
    if (!api || !enabled) {
      setTabs([]);
      return;
    }
    let live = true;
    api.tabs(sessionId).then((list) => { if (live) setTabs(list); }).catch(() => { /* no browser yet */ });
    const off = api.onTabsChanged((id, list) => {
      if (id === sessionId) setTabs(list);
    });
    return () => {
      live = false;
      off();
    };
  }, [sessionId, enabled]);

  return tabs;
}
