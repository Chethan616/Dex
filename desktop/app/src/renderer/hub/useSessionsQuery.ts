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
      const fresh = await api.sessions.listAll();
      // sessions:list-all is deliberately a lightweight summary —
      // SessionManager.listSessions() hard-codes `output: []` on every
      // session so listing a hundred sessions doesn't ship a hundred full
      // event histories. That's fine for the initial load, but this query
      // *also* refetches on every window focus (react-query's default) and
      // from a few explicit .refetch() calls elsewhere — each of which was
      // silently wiping every session's live-accumulated `output` back to
      // empty, which is why a canvas document, a confirmation card, or a
      // file-search result would render once and then vanish the moment
      // you alt-tabbed away and back: the data backing it was gone, not
      // just hidden. Preserve whatever richer `output` the cache already
      // has for a session — the same "don't trust a coarse snapshot over
      // what's already been accumulated" rule the sessionUpdated and
      // sessionOutput handlers below already follow.
      const cached = qc.getQueryData<AgentSession[]>(SESSIONS_KEY);
      if (!cached || cached.length === 0) return fresh;
      const cachedById = new Map(cached.map((s) => [s.id, s]));
      return fresh.map((s) => {
        const prior = cachedById.get(s.id);
        return prior && prior.output.length > 0 ? { ...s, output: prior.output } : s;
      });
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

/**
 * Load a session's full history into the cache. The list arrives with empty
 * `output`s and only live events are appended after that, so a task that ran
 * before this window opened — or started while it was reloading — would show
 * a partial conversation. Replaces the cached output only when the fetched
 * one is longer, so it never rolls back events that arrived meanwhile.
 */
export function useHydrateSession(id: string | null) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!id) return;
    const api = window.electronAPI;
    if (!api) return;
    let cancelled = false;

    api.sessions.get(id).then((full) => {
      if (cancelled || !full || full.output.length === 0) return;
      qc.setQueryData<AgentSession[]>(SESSIONS_KEY, (prev = []) =>
        prev.map((s) => (s.id === id && full.output.length > s.output.length ? { ...s, output: full.output } : s)),
      );
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [id, qc]);
}
