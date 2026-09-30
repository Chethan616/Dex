/**
 * A task's bot wears what the task is doing — the same moods on the phone
 * (android …/ui/avatar/BotAvatar.kt):
 *
 *  - awake      ready, looking around (a task not started yet)
 *  - thinking   the model is reasoning or writing — thought dots
 *  - working    a tool is running — hopping and spinning
 *  - needs-you  waiting on you: an approval, a login — a "!" and eager hops
 *  - happy      it just finished — a jump and sparkles, then it dozes off
 *  - sad        it failed — a sweat drop, slower, a little grey
 *  - sleeping   paused, or done and resting — eyes shut, z's
 */
import { useEffect, useRef, useState } from 'react';

export type BotMood = 'awake' | 'thinking' | 'working' | 'needs-you' | 'happy' | 'sad' | 'sleeping';

/** How long a finished task stays happy before it falls asleep. */
export const HAPPY_MS = 7_000;

type EventLike = { type?: string; status?: string; level?: string; name?: string; id?: string };

export interface MoodSource {
  status?: string | null;
  error?: string | null;
  output?: ReadonlyArray<EventLike>;
}

function isCancel(error?: string | null): boolean {
  return Boolean(error && /cancel/i.test(error));
}

/** What a live run is doing right now, from its latest events. */
export function liveMood(output: ReadonlyArray<EventLike> = []): BotMood {
  const openCalls = new Map<string, number>();
  // An approval is logged again once answered; newest first, so remember those.
  const answered = new Set<string>();
  for (let i = output.length - 1, seen = 0; i >= 0 && seen < 120; i -= 1, seen += 1) {
    const e = output[i];
    if (e.type === 'user_input') break;
    if (e.type === 'confirmation') {
      if (e.status !== 'pending') answered.add(e.id ?? '');
      else if (!answered.has(e.id ?? '')) return 'needs-you';
    }
    if (e.type === 'notify' && e.level === 'blocking' && seen < 6) return 'needs-you';
    if (e.type === 'tool_result') openCalls.set(e.name ?? '', (openCalls.get(e.name ?? '') ?? 0) - 1);
    if (e.type === 'tool_call') {
      const n = (openCalls.get(e.name ?? '') ?? 0) + 1;
      if (n > 0) return 'working';
      openCalls.set(e.name ?? '', n);
    }
    // The newest thing is prose or reasoning: it's thinking.
    if (e.type === 'thinking' && seen < 3) return 'thinking';
  }
  return output.length > 0 ? 'thinking' : 'working';
}

/** Did the latest turn end in an error? */
function lastTurnFailed(output: ReadonlyArray<EventLike> = []): boolean {
  for (let i = output.length - 1, seen = 0; i >= 0 && seen < 60; i -= 1, seen += 1) {
    const e = output[i];
    if (e.type === 'user_input' || e.type === 'done') return false;
    if (e.type === 'error') return true;
  }
  return false;
}

/** The mood a task shows, without the "just finished" moment. */
export function moodFor(source: MoodSource): BotMood {
  switch (source.status) {
    case 'running':
    case 'stuck':
    case 'starting':
      return liveMood(source.output);
    case 'paused':
      return 'sleeping';
    case 'idle':
    case 'stopped':
      return (source.error && !isCancel(source.error)) || lastTurnFailed(source.output) ? 'sad' : 'sleeping';
    default:
      return 'awake';
  }
}

/**
 * The mood, live: a run that just finished well is happy for a few seconds
 * (a jump and sparkles), then its bot dozes off.
 */
export function useBotMood(source: MoodSource): BotMood {
  const base = moodFor(source);
  const wasRunning = useRef(false);
  const [happyUntil, setHappyUntil] = useState(0);
  const running = source.status === 'running' || source.status === 'stuck' || source.status === 'starting';

  useEffect(() => {
    if (wasRunning.current && !running && base === 'sleeping' && source.status !== 'paused') {
      setHappyUntil(Date.now() + HAPPY_MS);
    }
    wasRunning.current = running;
  }, [running, base, source.status]);

  useEffect(() => {
    if (!happyUntil) return;
    const t = setTimeout(() => setHappyUntil(0), Math.max(0, happyUntil - Date.now()));
    return () => clearTimeout(t);
  }, [happyUntil]);

  return happyUntil > Date.now() && !running ? 'happy' : base;
}
