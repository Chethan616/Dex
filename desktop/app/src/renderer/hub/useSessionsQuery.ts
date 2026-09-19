import { useQuery, useQueryClient, QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { AgentSession } from './types';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

const SESSIONS_KEY = ['sessions'] as const;

export function useSessionsQuery() {
  const qc = useQueryClient();

  const query = useQuery<AgentSession[]>({
    queryKey: SESSIONS_KEY,
    queryFn: async () => {
      const api = window.electronAPI;
      if (!api) return [];
      return api.sessions.listAll();
    },
  });

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    // 'session-updated' is a coarse, occasional broadcast (status changes,
    // cost rollups, navigation) — it is NOT fired for ordinary tool_call /
    // artifact / screenshot / confirmation / task_state events, because doing
    // so would mean sending the whole session object on every thinking-token
    // delta. Those instead arrive one at a time over 'session-output' (below).
    // So an existing session's `output` array is owned entirely by that
    // incremental stream; keep it as-is here rather than overwriting it with
    // whatever snapshot happened to be attached to this broadcast, or every
    // event it carried would double up the moment both listeners fire for the
    // same underlying appendOutput call.
    const unsubUpdate = api.on.sessionUpdated((session) => {
      qc.setQueryData<AgentSession[]>(SESSIONS_KEY, (prev = []) => {
        const idx = prev.findIndex((s) => s.id === session.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = {
            ...prev[idx],
            ...session,
            output: prev[idx].output,
            hasBrowser: session.hasBrowser ?? prev[idx].hasBrowser,
          };
          return next;
        }
        return [...prev, session];
      });
    });

    // The live feed the deck, the confirmation card and the activity stats
    // actually depend on. Without this, AgentSession.output is frozen at
    // whatever it was on the last full fetch/broadcast — which for a
    // long-running session with no status change is "whatever it was when
    // the pane first mounted" — so plans, screenshots and (critically) a
    // dex-registry confirmation card never appear while the app is open,
    // even though the same event is streaming correctly into the separate
    // floating Logs window the whole time.
    const unsubOutput = api.on.sessionOutput((id, event) => {
      qc.setQueryData<AgentSession[]>(SESSIONS_KEY, (prev = []) => {
        const idx = prev.findIndex((s) => s.id === id);
        if (idx < 0) return prev;
        const next = [...prev];
        next[idx] = { ...prev[idx], output: [...prev[idx].output, event] };
        return next;
      });
    });

    return () => {
      unsubUpdate();
      unsubOutput();
    };
  }, [qc]);

  return query;
}

export function useUpdateSession() {
  const qc = useQueryClient();
  return (id: string, update: Partial<AgentSession>) => {
    qc.setQueryData<AgentSession[]>(SESSIONS_KEY, (prev = []) =>
      prev.map((s) => (s.id === id ? { ...s, ...update } : s)),
    );
  };
}

export function useHydrateSession(id: string | null) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!id) return;
    const api = window.electronAPI;
    if (!api) return;

    const cached = qc.getQueryData<AgentSession[]>(SESSIONS_KEY);
    const existing = cached?.find((s) => s.id === id);
    if (existing && existing.output.length > 0) return;

    api.sessions.get(id).then((full) => {
      if (!full || full.output.length === 0) return;
      qc.setQueryData<AgentSession[]>(SESSIONS_KEY, (prev = []) =>
        prev.map((s) => (s.id === id ? { ...s, output: full.output } : s)),
      );
    }).catch(() => {});
  }, [id, qc]);
}
