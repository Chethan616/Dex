/**
 * The Desk tab, main's side (docs/desktop-control/PLAN.md §Phase 3): which
 * window each task's Windows tools are working in, what they're doing there,
 * the live pictures of it, and the user's "Show me" / "Hand back".
 *
 * The Windows server reports every call (`/dex/desktop-event` kind `act`).
 * Its helper writes pictures of the window it works in to
 * `<desk>/live/<session>-{0,1}.jpg`, with `<session>.json` naming the newest —
 * but only while this side keeps `<session>.want` fresh, which it does only
 * while a Desk tab is on screen. No one looking, nothing captured.
 *
 * "Show me" lists the window in `<session>.taken.json` *before* it moves, so
 * the helper never parks it back, and the server answers the agent "the user
 * took this window" from then on. "Hand back" parks it again (if DEX opened
 * it) and takes it off the list.
 */
import fs from 'node:fs';
import path from 'node:path';
import { deskWords } from '../../shared/deskWords';

export interface DeskWindow {
  hwnd: number;
  title: string;
  process: string;
  openedByDex: boolean;
}

export interface DeskState {
  /** The window DEX worked in last. */
  window: DeskWindow | null;
  /** What it's doing (or last did), in words: "Pressing “Shuffle” in Spotify". */
  caption: string | null;
  /** A call is running right now. */
  acting: boolean;
  at: number;
  /** Windows the user has (Show me, or brought forward themselves): DEX leaves them alone. */
  taken: number[];
}

export interface DeskFrameMeta {
  seq: number;
  at: number;
  width: number;
  height: number;
  window?: { hwnd: number; title?: string; process?: string } | null;
  /** The element being acted on, in the picture's pixels. */
  focus?: { box: [number, number, number, number]; name?: string; role?: string };
}

export interface ActEvent {
  seq?: number;
  phase?: 'start' | 'end';
  tool?: string;
  args?: Record<string, unknown>;
  window?: (Partial<DeskWindow> & { takenOver?: boolean }) | null;
  ok?: boolean;
  element?: { name?: string; role?: string } | null;
}

export interface WindowOpResult {
  ok: boolean;
  foreground?: boolean;
  error?: string;
}

export interface DeskLiveDeps {
  /** `<userData>/desktop`, where the Windows server keeps its files. */
  home: () => string;
  /** To the hub. */
  send: (channel: string, ...args: unknown[]) => void;
  /** host/window.ps1: show one window on the user's screen, or park it again. */
  windowOp: (op: 'show' | 'park', hwnd: number) => Promise<WindowOpResult>;
  now?: () => number;
}

/** The server's own file names for a session (server.mjs). */
export function deskFileId(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9_-]/g, '_') || 'shared';
}

const POLL_MS = 250;
const WANT_EVERY_MS = 2_000;

interface Watcher {
  count: number;
  timer: ReturnType<typeof setInterval>;
  lastStamp: number;
  lastSeq: number;
  lastWant: number;
  busy: boolean;
}

export class DeskLive {
  private readonly states = new Map<string, DeskState>();
  private readonly lastSeq = new Map<string, number>();
  private readonly watchers = new Map<string, Watcher>();

  constructor(private readonly deps: DeskLiveDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private file(sessionId: string, suffix: string): string {
    return path.join(this.deps.home(), 'live', `${deskFileId(sessionId)}${suffix}`);
  }

  state(sessionId: string): DeskState | null {
    return this.states.get(sessionId) ?? null;
  }

  private publish(sessionId: string, next: DeskState): void {
    this.states.set(sessionId, next);
    this.deps.send('desk:changed', sessionId, next);
  }

  /** The server's report of one call: its start, then its end. */
  noteAct(sessionId: string, ev: ActEvent): void {
    if (!ev.tool) return;
    const seq = Number(ev.seq ?? 0);
    const prev = this.states.get(sessionId);
    // A start that arrives after its own end (two requests racing) changes nothing.
    const last = this.lastSeq.get(sessionId) ?? 0;
    if (seq && (ev.phase === 'start' ? seq <= last : seq < last)) return;
    if (seq) this.lastSeq.set(sessionId, Math.max(seq, this.lastSeq.get(sessionId) ?? 0));

    const w = ev.window && Number.isFinite(Number(ev.window.hwnd))
      ? { hwnd: Number(ev.window.hwnd), title: String(ev.window.title ?? ''), process: String(ev.window.process ?? ''), openedByDex: Boolean(ev.window.openedByDex) }
      : null;
    const words = deskWords(ev.tool, ev.args ?? {}, w ?? prev?.window, ev.element ?? null);
    let taken = prev?.taken ?? [];
    if (w && ev.window?.takenOver && !taken.includes(w.hwnd)) taken = [...taken, w.hwnd];
    this.publish(sessionId, {
      window: w ?? prev?.window ?? null,
      caption: ev.phase === 'start' ? words.active : words.done,
      acting: ev.phase === 'start',
      at: this.now(),
      taken,
    });
  }

  /** The user brought a parked window forward themselves (the helper noticed). */
  noteTakenOver(sessionId: string, window: { hwnd?: unknown; title?: unknown; process?: unknown } | undefined): void {
    const hwnd = Number(window?.hwnd);
    if (!Number.isFinite(hwnd) || hwnd <= 0) return;
    this.setTaken(sessionId, hwnd, true);
  }

  private setTaken(sessionId: string, hwnd: number, on: boolean): void {
    const prev = this.states.get(sessionId) ?? { window: null, caption: null, acting: false, at: this.now(), taken: [] };
    const taken = on ? (prev.taken.includes(hwnd) ? prev.taken : [...prev.taken, hwnd]) : prev.taken.filter((h) => h !== hwnd);
    this.writeTaken(sessionId, taken);
    this.publish(sessionId, { ...prev, taken });
  }

  private writeTaken(sessionId: string, taken: number[]): void {
    const target = this.file(sessionId, '.taken.json');
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (taken.length === 0) { fs.rmSync(target, { force: true }); return; }
      const tmp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ hwnds: taken }));
      fs.renameSync(tmp, target);
    } catch { /* the server still refuses taken windows it noticed itself */ }
  }

  /** "Show me": the window DEX is in, on the user's screen and in front. */
  async showMe(sessionId: string): Promise<WindowOpResult> {
    const w = this.states.get(sessionId)?.window;
    if (!w) return { ok: false, error: 'no_window' };
    // Listed first: the helper must not park it back while it moves.
    this.setTaken(sessionId, w.hwnd, true);
    const r = await this.deps.windowOp('show', w.hwnd);
    if (!r.ok) this.setTaken(sessionId, w.hwnd, false);
    return r;
  }

  /** "Hand back": DEX may use the window again; parked again if DEX opened it. */
  async handBack(sessionId: string): Promise<WindowOpResult> {
    const st = this.states.get(sessionId);
    if (!st || st.taken.length === 0) return { ok: true };
    let result: WindowOpResult = { ok: true };
    for (const hwnd of st.taken) {
      if (st.window?.hwnd === hwnd && st.window.openedByDex) {
        const r = await this.deps.windowOp('park', hwnd);
        if (!r.ok && r.error !== 'closed') result = r;
      }
      this.setTaken(sessionId, hwnd, false);
    }
    return result;
  }

  /** The hub shows (or stops showing) this task's Desk tab. */
  watch(sessionId: string, on: boolean): void {
    const existing = this.watchers.get(sessionId);
    if (on) {
      if (existing) { existing.count += 1; return; }
      const w: Watcher = { count: 1, timer: setInterval(() => { void this.pump(sessionId); }, POLL_MS), lastStamp: 0, lastSeq: 0, lastWant: 0, busy: false };
      this.watchers.set(sessionId, w);
      void this.pump(sessionId);
      return;
    }
    if (!existing) return;
    existing.count -= 1;
    if (existing.count > 0) return;
    clearInterval(existing.timer);
    this.watchers.delete(sessionId);
    // Stop the pictures now, not when the file goes stale.
    try { fs.rmSync(this.file(sessionId, '.want'), { force: true }); } catch { /* gone */ }
  }

  private touchWant(sessionId: string, w: Watcher): void {
    const t = this.now();
    if (t - w.lastWant < WANT_EVERY_MS) return;
    w.lastWant = t;
    const want = this.file(sessionId, '.want');
    try {
      fs.mkdirSync(path.dirname(want), { recursive: true });
      fs.writeFileSync(want, String(t));
    } catch { /* no pictures this time */ }
  }

  /** A new picture since the last look: to the hub. */
  async pump(sessionId: string): Promise<void> {
    const w = this.watchers.get(sessionId);
    if (!w || w.busy) return;
    w.busy = true;
    try {
      this.touchWant(sessionId, w);
      const metaPath = this.file(sessionId, '.json');
      let stamp = 0;
      try { stamp = (await fs.promises.stat(metaPath)).mtimeMs; } catch { return; }
      if (stamp === w.lastStamp) return;
      let meta: DeskFrameMeta & { file?: string };
      try { meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf-8')); } catch { return; }   // half-written: next time
      w.lastStamp = stamp;
      if (!meta || typeof meta.file !== 'string' || meta.seq === w.lastSeq) return;
      // Only this session's own two slots.
      const id = deskFileId(sessionId);
      if (meta.file !== `${id}-0.jpg` && meta.file !== `${id}-1.jpg`) return;
      let bytes: Buffer;
      try { bytes = await fs.promises.readFile(path.join(path.dirname(metaPath), meta.file)); } catch { return; }
      if (!this.watchers.has(sessionId)) return;
      w.lastSeq = meta.seq;
      const { file: _file, ...clean } = meta;
      this.deps.send('desk:frame', sessionId, clean, bytes);
    } finally {
      w.busy = false;
    }
  }

  /** A task went away: its state, its watchers and its files. */
  forget(sessionId: string): void {
    const w = this.watchers.get(sessionId);
    if (w) { clearInterval(w.timer); this.watchers.delete(sessionId); }
    this.states.delete(sessionId);
    this.lastSeq.delete(sessionId);
    const id = deskFileId(sessionId);
    for (const suffix of ['.want', '.taken.json', '.json', '-0.jpg', '-1.jpg']) {
      try { fs.rmSync(path.join(this.deps.home(), 'live', `${id}${suffix}`), { force: true }); } catch { /* gone */ }
    }
  }

  stopAll(): void {
    for (const id of [...this.watchers.keys()]) {
      const w = this.watchers.get(id)!;
      clearInterval(w.timer);
      this.watchers.delete(id);
      try { fs.rmSync(this.file(id, '.want'), { force: true }); } catch { /* gone */ }
    }
  }
}
