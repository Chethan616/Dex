/**
 * The phone bridge: DEX desktop ⇄ Firebase ⇄ DEX for Android.
 *
 * Pairing is the account. The desktop signs in to Firebase Auth with an email
 * and password (Settings → Accounts → DEX on your phone); the phone signs in
 * with the same pair; both land on the same Firebase uid, so there is no
 * code, QR or pairing step — and no server of our own.
 *
 * Firestore, all under users/{uid} (rules: firebase/firestore.rules):
 *
 *   devices/{deviceId}          this desktop: name, online, lastSeen, engines
 *   sessions/{sessionId}        one row per task: prompt, status, engine,
 *                               last line, cost, pending approval
 *   sessions/{id}/blocks/{seq}  the task as chat blocks — the same reducer
 *                               the logs window uses (renderer/logs/
 *                               transcript.ts), so the phone shows exactly
 *                               what the desktop shows
 *   sessions/{id}/subagents/{subagentId}
 *                               one row per subagent (src/shared/
 *                               subagents.ts's fold of subagent_start/step/
 *                               done — the same one the hub's chat and
 *                               Subagents tab use), kept small on purpose:
 *                               name, status, prompt, summary and only the
 *                               *latest* step — never the full step list —
 *                               so the phone can show mention rows and an
 *                               Active/Done sheet with exactly one listener
 *                               on the subcollection, not one per subagent
 *   commands/{id}               what the phone asks for: new_task, follow_up,
 *                               pause, resume, stop, answer_confirmation,
 *                               sync_session, fetch_file. The desktop claims
 *                               each one in a transaction, runs it, writes
 *                               the result.
 *   transfers/{id}/chunks/{n}   a file the phone asked for (fetch_file), in
 *                               ~700 KB pieces. The phone deletes it once
 *                               saved; anything left is swept after an hour.
 *   uploads/{id}/chunks/{n}     the other way: a photo or file the phone
 *                               attached to new_task / follow_up (`uploads`:
 *                               [ids]). Reassembled here, handed to the run
 *                               as ordinary attachments, then deleted.
 *
 * Pictures travel as a small inline JPEG preview on their block (`thumb`),
 * so they show at once; the full file only on request. All of it fits the
 * free Spark plan — no Cloud Storage, no Cloud Functions.
 *
 * The phone's notifications are local (android notify/TaskWatcher): it
 * watches the session rows itself.
 *
 * Writes are debounced per session and diffed per block, so a token-by-token
 * stream costs one small write every ~700ms, not one per token.
 */
import os from 'node:os';
import fs from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import { nativeImage } from 'electron';
import { mainLogger } from '../logger';
import { getInstallId } from '../installId';
import type { AgentSession, HlEvent } from '../sessions/types';
import { appendEvent, buildTranscript, type Block, type Transcript } from '../../renderer/logs/transcript';
import { buildSubagents, foldSubagentEvent, subagentsList, EMPTY_SUBAGENTS, type Subagent, type SubagentsState } from '../../shared/subagents';
import { firebaseConfig } from './config';
import { clearCredentials, loadCredentials, saveCredentials } from './credentials';
import { redactSecrets } from './redact';
import { resolveAgentPath } from '../hl/agentPaths';
import { getProfile, profileEvents, setProfile, type DexProfile } from '../profile';

type FirebaseApp = import('firebase/app').FirebaseApp;
type Firestore = import('firebase/firestore').Firestore;
type Auth = import('firebase/auth').Auth;

/** A file the phone attached, reassembled from uploads/{id}. */
export interface PhoneAttachment {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export interface BridgeHost {
  listSessions(): AgentSession[];
  getSession(id: string): AgentSession | undefined;
  onSessionChanged(cb: (session: AgentSession) => void): void;
  onSessionOutput(cb: (id: string, event: HlEvent) => void): void;
  onSessionDeleted(cb: (id: string) => void): void;
  /** Files the task recorded (dex-state file) — shown in the phone's Files sheet. */
  getTaskFiles(id: string): Array<{ path: string; name: string; size?: number }>;
  listEngines(): Promise<Array<{ id: string; name: string; models: Array<{ id: string; label: string }> }>>;
  newTask(input: { prompt: string; engine?: string; model?: string; attachments?: PhoneAttachment[] }): Promise<{ id: string; error?: string }>;
  followUp(id: string, prompt: string, attachments?: PhoneAttachment[]): Promise<Record<string, unknown>>;
  pause(id: string): unknown;
  resume(id: string): Promise<Record<string, unknown>>;
  stop(id: string): unknown;
  answerConfirmation(sessionId: string, confirmationId: string, approved: boolean, lifetime?: string): { ok: boolean; error?: string };
  getApprovalMode(): string;
  setApprovalMode(mode: string): string;
}

export type BridgeState =
  | { state: 'off'; reason: 'no-firebase' | 'signed-out' }
  | { state: 'connecting' }
  | { state: 'online'; email?: string; uid: string }
  | { state: 'error'; error: string };

const WRITE_DEBOUNCE_MS = 700;
/** fetch_file: raw bytes per Firestore doc (base64 ≈ 933 KB, under the 1 MiB limit). */
const CHUNK_BYTES = 700 * 1024;
const MAX_TRANSFER_BYTES = 25 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html', mp4: 'video/mp4',
  zip: 'application/zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
function mimeForName(name: string): string {
  return MIME_BY_EXT[path.extname(name).slice(1).toLowerCase()] ?? 'application/octet-stream';
}
const HEARTBEAT_MS = 60_000;
const INITIAL_SESSIONS = 30;
const LIVE_BLOCK_SESSIONS = 5;
const MAX_TEXT = 20_000;
const MAX_PREVIEW = 4_000;

/** Redact, then truncate: everything bound for Firestore passes through here. */
function clip(value: string | undefined, max: number): string | undefined {
  const safe = redactSecrets(value);
  if (safe == null) return undefined;
  return safe.length > max ? `${safe.slice(0, max)}\n… (truncated)` : safe;
}

/** A block as Firestore stores it: no undefined, no nested arrays (args → JSON). */
const THUMB_WIDTH = 480;
const MAX_THUMB_BYTES = 120_000;
const thumbCache = new Map<string, string | null>();

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;

/**
 * A small JPEG preview of an image on this PC, base64 — inline on its block
 * so the phone shows the picture immediately. Cached: blocks are
 * re-serialized on every write, the picture doesn't change.
 */
function thumbFor(filePath: string | undefined, mime?: string): string | null {
  if (!filePath || !(IMAGE_EXT.test(filePath) || (mime ?? '').startsWith('image/'))) return null;
  // Keyed by the file's version too: a render seen while still 0 bytes (or
  // half-written) must get its preview once it's finished.
  let version = '';
  try { const st = statSync(filePath); version = `${st.size}:${st.mtimeMs}`; } catch { return null; }
  const cacheKey = `${filePath}|${version}`;
  if (thumbCache.has(cacheKey)) return thumbCache.get(cacheKey) ?? null;
  let out: string | null = null;
  try {
    const img = nativeImage.createFromPath(filePath);
    if (!img.isEmpty()) {
      const { width } = img.getSize();
      let small = width > THUMB_WIDTH ? img.resize({ width: THUMB_WIDTH, quality: 'good' }) : img;
      let jpeg = small.toJPEG(72);
      if (jpeg.length > MAX_THUMB_BYTES) {
        small = img.resize({ width: 320, quality: 'good' });
        jpeg = small.toJPEG(60);
      }
      out = jpeg.length <= MAX_THUMB_BYTES ? jpeg.toString('base64') : null;
    }
  } catch {
    out = null;
  }
  if (thumbCache.size > 300) thumbCache.delete(thumbCache.keys().next().value!);
  thumbCache.set(cacheKey, out);
  return out;
}

function serializeBlock(block: Block): Record<string, unknown> {
  // `at`: when the desktop recorded it (absent on blocks from before events
  // carried times). The phone uses it to interleave subagent mention rows
  // with the conversation by timestamp, the same way the hub's chat does.
  const base = { seq: block.id, kind: block.kind, at: block.at ?? null };
  switch (block.kind) {
    case 'user':
      return {
        ...base,
        text: clip(block.text, MAX_TEXT),
        attachments: (block.attachments ?? []).slice(0, 10).map((a) => ({ name: clip(a.name, 200), mime: a.mime, size: a.size })),
      };
    case 'text':
      return { ...base, text: clip(block.text, MAX_TEXT) };
    case 'tool': {
      let argsJson: string;
      try { argsJson = JSON.stringify(block.args ?? null, null, 2); } catch { argsJson = String(block.args); }
      return {
        ...base,
        name: block.name,
        toolKind: block.meta.kind,
        verb: block.meta.done,
        activeVerb: block.meta.active,
        orb: block.meta.orb,
        display: clip(block.meta.display, 200) ?? null,
        summary: clip(block.summary, 400),
        argsJson: clip(argsJson, MAX_PREVIEW),
        iteration: block.iteration,
        result: block.result ? { ok: block.result.ok, preview: clip(block.result.preview, MAX_PREVIEW), ms: block.result.ms } : null,
      };
    }
    case 'done':
      return { ...base, text: clip(block.summary, MAX_TEXT), iterations: block.iterations, echo: block.echo === true };
    case 'error':
      return { ...base, text: clip(block.message, MAX_PREVIEW) };
    case 'notice':
      return { ...base, level: block.level, text: clip(block.title, 400), detail: clip(block.detail, 1000) ?? null };
    case 'file':
      return { ...base, name: block.name, path: block.path, size: block.size, mime: block.mime, thumb: thumbFor(block.path, block.mime) };
    case 'image':
      return { ...base, text: block.caption ?? 'Screenshot', path: block.path, name: path.basename(block.path), thumb: thumbFor(block.path) };
    case 'canvas':
      return { ...base, name: block.title, text: clip(block.markdown, MAX_TEXT) };
    case 'artifact':
      return { ...base, name: block.title, text: clip(block.note, 1000) ?? null, count: block.count, items: block.items.map((i) => ({ label: clip(i.label, 300), detail: clip(i.detail, 300) ?? null })) };
    default:
      return base;
  }
}

/**
 * A subagent as Firestore stores it: name, status, prompt and summary, plus
 * only its *latest* step as `lastActivity` — never the full step list. The
 * phone only ever shows a mention row and an Active/Done sheet (no per-
 * subagent transcript today), so there's nothing to gain from sending every
 * step, and every step would mean a write on every one of the subagent's
 * own tool calls instead of one write per debounce tick.
 */
function serializeSubagent(a: Subagent): Record<string, unknown> {
  const last = a.steps[a.steps.length - 1];
  return {
    id: a.id,
    name: clip(a.name, 200),
    subagentType: a.subagentType ? clip(a.subagentType, 100) : null,
    prompt: clip(a.prompt, 2000) ?? null,
    status: a.status,
    ok: a.ok ?? null,
    summary: clip(a.summary, 2000) ?? null,
    startedAt: a.startedAt ?? null,
    endedAt: a.endedAt ?? null,
    lastActivity: last ? { kind: last.kind, name: last.name ?? null, preview: clip(last.preview, 200) ?? null, at: last.at ?? null } : null,
    stepCount: a.steps.length,
  };
}

/** The one-line preview the phone's session list shows. */
function lastLine(t: Transcript): string {
  for (let i = t.blocks.length - 1; i >= 0; i -= 1) {
    const b = t.blocks[i];
    if (b.kind === 'text' && b.text.trim()) return b.text.trim().split('\n').pop()!.slice(0, 160);
    if (b.kind === 'tool') return `${b.result ? b.meta.done : b.meta.active} ${b.meta.display ?? b.summary}`.slice(0, 160);
    if (b.kind === 'done') return b.summary.split('\n')[0].slice(0, 160);
    if (b.kind === 'error') return b.message.slice(0, 160);
  }
  return '';
}

function pendingConfirmation(session: AgentSession): { id: string; title: string | undefined; detail: string | undefined } | null {
  const output = session.output ?? [];
  for (let i = output.length - 1; i >= 0; i -= 1) {
    const e = output[i] as HlEvent;
    if (e.type === 'confirmation') return e.status === 'pending' ? { id: e.id, title: clip(e.title, 300), detail: clip(e.detail, 1000) } : null;
  }
  return null;
}

function friendlyAuthError(err: unknown): string {
  const code = (err as { code?: string }).code ?? '';
  switch (code) {
    case 'auth/invalid-email': return 'That doesn’t look like an email address.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password': return 'Email or password is wrong.';
    case 'auth/user-not-found': return 'No DEX account with that email — create one instead.';
    case 'auth/email-already-in-use': return 'That email already has a DEX account — sign in instead.';
    case 'auth/weak-password': return 'Use a password of at least 6 characters.';
    case 'auth/too-many-requests': return 'Too many tries. Wait a minute and try again.';
    case 'auth/operation-not-allowed': return 'Email sign-in isn’t enabled in the Firebase project yet.';
    case 'auth/configuration-not-found': return 'Firebase Authentication isn’t set up for this project yet — Firebase console → Authentication → Get started → enable Email/Password.';
    case 'auth/network-request-failed': return 'Couldn’t reach Firebase — check your connection.';
    default: return (err as Error).message ?? 'Sign-in failed.';
  }
}

export class FirebaseBridge {
  private app: FirebaseApp | null = null;
  private db: Firestore | null = null;
  private auth: Auth | null = null;
  private uid: string | null = null;
  private readonly deviceId = `desktop-${getInstallId()}`;
  private transcripts = new Map<string, Transcript>();
  private written = new Map<string, Map<number, string>>();
  private subagentsBySession = new Map<string, SubagentsState>();
  private writtenSubagents = new Map<string, Map<string, string>>();
  /** The project's rules refused the subagents collection (not deployed yet). */
  private subagentsRefused = false;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private unsubCommands: (() => void) | null = null;
  private status: BridgeState = { state: 'connecting' };
  private listeners = new Set<(s: BridgeState) => void>();
  private hooked = false;
  private unsubProfile: (() => void) | null = null;
  private profileHooked = false;

  constructor(private readonly host: BridgeHost) {}

  get state(): BridgeState { return this.status; }

  onState(cb: (s: BridgeState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private setState(next: BridgeState): void {
    this.status = next;
    mainLogger.info('firebase.bridge.state', { ...next });
    for (const cb of this.listeners) cb(next);
  }

  private async ensureApp(): Promise<boolean> {
    const config = firebaseConfig();
    if (!config) return false;
    if (!this.app) {
      const { initializeApp, getApps } = await import('firebase/app');
      const { initializeAuth, inMemoryPersistence } = await import('firebase/auth');
      const { initializeFirestore } = await import('firebase/firestore');
      this.app = getApps().find((a) => a.name === 'dex-bridge') ?? initializeApp(config, 'dex-bridge');
      this.auth = initializeAuth(this.app, { persistence: inMemoryPersistence });
      this.db = initializeFirestore(this.app, { ignoreUndefinedProperties: true });
    }
    return true;
  }

  /** Reconnect with the saved email/password. Safe to call repeatedly. */
  async start(): Promise<void> {
    if (!(await this.ensureApp())) { this.setState({ state: 'off', reason: 'no-firebase' }); return; }
    const creds = await loadCredentials();
    if (!creds) { this.setState({ state: 'off', reason: 'signed-out' }); return; }
    const result = await this.signIn(creds.email, creds.password, false, false);
    if (!result.ok) this.setState({ state: 'error', error: result.error ?? 'Sign-in failed' });
  }

  /**
   * Sign in (or create the account) with email/password — the same pair the
   * phone uses. Saves the pair only after Firebase accepts it.
   */
  async signIn(email: string, password: string, create: boolean, remember = true): Promise<{ ok: boolean; error?: string }> {
    if (!(await this.ensureApp())) return { ok: false, error: 'Firebase isn’t configured in this build.' };
    this.setState({ state: 'connecting' });
    try {
      const { signInWithEmailAndPassword, createUserWithEmailAndPassword } = await import('firebase/auth');
      const cred = create
        ? await createUserWithEmailAndPassword(this.auth!, email.trim(), password)
        : await signInWithEmailAndPassword(this.auth!, email.trim(), password);
      if (remember) await saveCredentials({ email: email.trim(), password });
      this.uid = cred.user.uid;
      this.setState({ state: 'online', email: cred.user.email ?? undefined, uid: this.uid });

      await this.publishDevice(true);
      this.heartbeat ??= setInterval(() => { void this.publishDevice(true); }, HEARTBEAT_MS);
      this.hookSessions();
      this.syncProfile();
      await this.syncInitial();
      this.listenForCommands();
      return { ok: true };
    } catch (err) {
      const error = friendlyAuthError(err);
      mainLogger.warn('firebase.bridge.signIn.failed', { error });
      this.setState({ state: 'off', reason: 'signed-out' });
      return { ok: false, error };
    }
  }

  async resetPassword(email: string): Promise<{ ok: boolean; error?: string }> {
    if (!(await this.ensureApp())) return { ok: false, error: 'Firebase isn’t configured in this build.' };
    try {
      const { sendPasswordResetEmail } = await import('firebase/auth');
      await sendPasswordResetEmail(this.auth!, email.trim());
      return { ok: true };
    } catch (err) {
      return { ok: false, error: friendlyAuthError(err) };
    }
  }

  async signOut(): Promise<void> {
    await this.stop();
    await clearCredentials();
    if (this.auth) {
      const { signOut } = await import('firebase/auth');
      await signOut(this.auth).catch(() => {});
    }
    this.transcripts.clear();
    this.written.clear();
    this.subagentsBySession.clear();
    this.writtenSubagents.clear();
    this.subagentsRefused = false;
    this.setState({ state: 'off', reason: 'signed-out' });
  }

  async stop(): Promise<void> {
    this.unsubCommands?.();
    this.unsubCommands = null;
    this.unsubProfile?.();
    this.unsubProfile = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.uid) await this.publishDevice(false).catch(() => {});
    this.uid = null;
  }

  private userDoc(...segments: string[]): string {
    return ['users', this.uid!, ...segments].join('/');
  }

  private async publishDevice(online: boolean): Promise<void> {
    if (!this.db || !this.uid) return;
    const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
    const engines = online ? await this.host.listEngines().catch(() => []) : undefined;
    await setDoc(doc(this.db, this.userDoc('devices', this.deviceId)), {
      kind: 'desktop',
      name: os.hostname(),
      platform: process.platform,
      online,
      lastSeen: serverTimestamp(),
      engines,
      approvalMode: this.host.getApprovalMode(),
    }, { merge: true });
  }

  /** Re-publish this desktop's row now (e.g. after the approval mode changed). */
  refreshDevice(): void {
    if (this.uid) void this.publishDevice(true).catch(() => {});
  }

  /**
   * "Your DEX" follows the account: users/{uid}.profile. The newer copy wins
   * (updatedAt); a local change is pushed, a remote one (from the phone) is
   * adopted locally without echoing back.
   */
  private syncProfile(): void {
    if (!this.db || !this.uid || this.unsubProfile) return;
    const uid = this.uid;
    void (async () => {
      const { doc, onSnapshot } = await import('firebase/firestore');
      this.unsubProfile = onSnapshot(doc(this.db!, 'users', uid), (snap) => {
        const remote = snap.data()?.profile as DexProfile | undefined;
        const local = getProfile();
        if (remote && typeof remote.bot === 'string' && (remote.updatedAt ?? 0) > local.updatedAt) {
          setProfile({ ...remote, chosen: true }, 'remote');
        } else if (local.chosen && (!remote || local.updatedAt > (remote.updatedAt ?? 0))) {
          void this.pushProfile(local);
        }
      }, (err) => mainLogger.warn('firebase.bridge.profile.listenFailed', { error: err.message }));
    })();
    if (!this.profileHooked) {
      this.profileHooked = true;
      profileEvents.on('changed', (profile: DexProfile, source: 'local' | 'remote') => {
        if (source === 'local') void this.pushProfile(profile);
      });
    }
  }

  private async pushProfile(profile: DexProfile): Promise<void> {
    if (!this.db || !this.uid) return;
    const { doc, setDoc } = await import('firebase/firestore');
    await setDoc(doc(this.db, 'users', this.uid), {
      profile: { bot: profile.bot, color: profile.color, name: profile.name, updatedAt: profile.updatedAt },
    }, { merge: true }).catch((err: Error) => mainLogger.warn('firebase.bridge.profile.pushFailed', { error: err.message }));
  }

  private hookSessions(): void {
    if (this.hooked) return;
    this.hooked = true;
    this.host.onSessionChanged((session) => this.schedule(session.id));
    this.host.onSessionOutput((id, event) => {
      const t = this.transcripts.get(id);
      if (t) this.transcripts.set(id, appendEvent(t, event as never));
      // Same lazy-cache shape as transcripts: only fold incrementally once
      // something has already asked for this session's subagents (the
      // initial writeSession call builds the first snapshot from
      // session.output in one go via subagentsFor below).
      const sub = this.subagentsBySession.get(id);
      if (sub) this.subagentsBySession.set(id, foldSubagentEvent(sub, event));
      this.schedule(id);
    });
    this.host.onSessionDeleted((id) => {
      void this.deleteRemote(id).catch((err: Error) => {
        mainLogger.warn('firebase.bridge.delete.failed', { id, error: err.message });
      });
    });
  }

  /**
   * Remove a session from the phone: its blocks first (Firestore doesn't
   * cascade a document delete to its subcollections), then the session.
   */
  private async deleteRemote(id: string): Promise<void> {
    const pending = this.timers.get(id);
    if (pending) clearTimeout(pending);
    this.timers.delete(id);
    this.transcripts.delete(id);
    this.written.delete(id);
    this.subagentsBySession.delete(id);
    this.writtenSubagents.delete(id);
    if (!this.db || !this.uid) return;
    const { collection, doc, getDocs, writeBatch } = await import('firebase/firestore');
    const blocks = await getDocs(collection(this.db, this.userDoc('sessions', id, 'blocks')));
    // Rules that predate the subagents collection refuse this read; the
    // task still goes.
    const subagents = await getDocs(collection(this.db, this.userDoc('sessions', id, 'subagents')))
      .catch(() => ({ docs: [] as typeof blocks.docs, size: 0 }));
    const toDelete = [...blocks.docs, ...subagents.docs];
    for (let i = 0; i < toDelete.length; i += 450) {
      const batch = writeBatch(this.db);
      for (const b of toDelete.slice(i, i + 450)) batch.delete(b.ref);
      await batch.commit();
    }
    const batch = writeBatch(this.db);
    batch.delete(doc(this.db, this.userDoc('sessions', id)));
    await batch.commit();
    mainLogger.info('firebase.bridge.deleted', { id, blocks: blocks.size, subagents: subagents.size });
  }

  /**
   * Sessions this PC mirrored but no longer has — deleted while the bridge
   * was offline, or before deletes were mirrored at all. Only this device's
   * sessions: another PC's are its own business.
   */
  private async pruneDeleted(): Promise<void> {
    if (!this.db || !this.uid) return;
    const { collection, getDocs, query, where } = await import('firebase/firestore');
    const remote = await getDocs(query(collection(this.db, this.userDoc('sessions')), where('deviceId', '==', this.deviceId)));
    const stale = remote.docs.map((d) => d.id).filter((id) => !this.host.getSession(id));
    for (const id of stale) await this.deleteRemote(id);
    if (stale.length > 0) mainLogger.info('firebase.bridge.pruned', { count: stale.length });
  }

  private transcriptFor(session: AgentSession): Transcript {
    let t = this.transcripts.get(session.id);
    if (!t) {
      t = buildTranscript(session.prompt, (session.output ?? []) as never[]);
      this.transcripts.set(session.id, t);
    }
    return t;
  }

  private subagentsFor(session: AgentSession): SubagentsState {
    let s = this.subagentsBySession.get(session.id);
    if (!s) {
      s = session.output && session.output.length > 0 ? buildSubagents(session.output) : EMPTY_SUBAGENTS;
      this.subagentsBySession.set(session.id, s);
    }
    return s;
  }

  private async syncInitial(): Promise<void> {
    const sessions = [...this.host.listSessions()]
      .sort((a, b) => (b.lastActivityAt ?? b.createdAt) - (a.lastActivityAt ?? a.createdAt))
      .slice(0, INITIAL_SESSIONS);
    for (const [i, s] of sessions.entries()) {
      await this.writeSession(s.id, { withBlocks: i < LIVE_BLOCK_SESSIONS || s.status === 'running' });
    }
    await this.pruneDeleted().catch((err: Error) => {
      mainLogger.warn('firebase.bridge.prune.failed', { error: err.message });
    });
    await this.sweepTransfers().catch((err: Error) => {
      mainLogger.warn('firebase.bridge.sweep.failed', { error: err.message });
    });
  }

  private schedule(id: string): void {
    if (!this.uid) return;
    const existing = this.timers.get(id);
    if (existing) return;
    this.timers.set(id, setTimeout(() => {
      this.timers.delete(id);
      void this.writeSession(id, { withBlocks: true }).catch((err: Error) => {
        mainLogger.warn('firebase.bridge.write.failed', { id, error: err.message });
      });
    }, WRITE_DEBOUNCE_MS));
  }

  private async writeSession(id: string, opts: { withBlocks: boolean }): Promise<void> {
    if (!this.db || !this.uid) return;
    const session = this.host.getSession(id);
    if (!session) return;
    const { doc, writeBatch, serverTimestamp } = await import('firebase/firestore');
    const t = this.transcriptFor(session);
    const done = [...t.blocks].reverse().find((b) => b.kind === 'done');
    const batch = writeBatch(this.db);
    batch.set(doc(this.db, this.userDoc('sessions', id)), {
      id,
      prompt: clip(session.prompt, 10_000),
      status: session.status,
      engine: session.engine ?? null,
      model: session.model ?? null,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt ?? session.createdAt,
      error: clip(session.error, 2000) ?? null,
      summary: done && done.kind === 'done' ? clip(done.summary, 2000) : null,
      lastLine: clip(lastLine(t), 200),
      costUsd: t.usage.costUsd || session.costUsd || 0,
      tokens: t.usage.inputTokens + t.usage.outputTokens,
      blockCount: t.blocks.length,
      pendingConfirmation: pendingConfirmation(session),
      files: this.host.getTaskFiles(id).slice(-30).map((f) => ({ name: clip(f.name, 200), path: f.path, size: f.size ?? 0 })),
      deviceId: this.deviceId,
      deviceName: os.hostname(),
      updatedAt: serverTimestamp(),
    }, { merge: true });

    let writes = 1;
    if (opts.withBlocks) {
      const seen = this.written.get(id) ?? new Map<number, string>();
      for (const block of t.blocks) {
        const data = serializeBlock(block);
        const key = JSON.stringify(data);
        if (seen.get(block.id) === key) continue;
        batch.set(doc(this.db, this.userDoc('sessions', id, 'blocks', String(block.id).padStart(6, '0'))), data);
        seen.set(block.id, key);
        writes += 1;
        if (writes >= 450) break; // Firestore batch limit is 500; the rest go next tick.
      }
      this.written.set(id, seen);
      if (writes >= 450) this.schedule(id);
    }
    await batch.commit();
    if (opts.withBlocks) await this.writeSubagents(session);
  }

  /**
   * The task's subagents, one doc each (never per step — see
   * serializeSubagent), in a batch of their own: a Firebase project whose
   * rules predate the subagents collection refuses these writes, and that
   * must never stop the conversation itself from reaching the phone.
   */
  private async writeSubagents(session: AgentSession): Promise<void> {
    if (!this.db || !this.uid || this.subagentsRefused) return;
    const subagents = subagentsList(this.subagentsFor(session));
    if (subagents.length === 0) return;
    const { doc, writeBatch } = await import('firebase/firestore');
    const seen = this.writtenSubagents.get(session.id) ?? new Map<string, string>();
    const batch = writeBatch(this.db);
    const changed: Array<[string, string]> = [];
    for (const a of subagents.slice(0, 450)) {
      const data = serializeSubagent(a);
      const key = JSON.stringify(data);
      if (seen.get(a.id) === key) continue;
      batch.set(doc(this.db, this.userDoc('sessions', session.id, 'subagents', a.id)), data);
      changed.push([a.id, key]);
    }
    if (changed.length === 0) return;
    try {
      await batch.commit();
      for (const [subId, key] of changed) seen.set(subId, key);
      this.writtenSubagents.set(session.id, seen);
    } catch (err) {
      const code = (err as { code?: string }).code;
      // The rules aren't deployed yet: stop trying until the next sign-in.
      if (code === 'permission-denied') this.subagentsRefused = true;
      mainLogger.warn('firebase.bridge.subagents.writeFailed', { id: session.id, code, error: (err as Error).message });
    }
  }

  private listenForCommands(): void {
    if (!this.db || !this.uid || this.unsubCommands) return;
    void (async () => {
      const { collection, query, where, onSnapshot } = await import('firebase/firestore');
      const q = query(collection(this.db!, this.userDoc('commands')), where('status', '==', 'pending'));
      this.unsubCommands = onSnapshot(q, (snap) => {
        for (const change of snap.docChanges()) {
          if (change.type === 'added') void this.runCommand(change.doc.id, change.doc.data());
        }
      }, (err) => mainLogger.warn('firebase.bridge.commands.listenFailed', { error: err.message }));
    })();
  }

  /**
   * Only files the task actually produced or showed — never an arbitrary
   * path. Returns the file's real path: older phone copies of a task may
   * still carry the Git Bash spelling an agent recorded (/tmp/…, /c/…).
   */
  private assertTaskFile(sessionId: string, filePath: string): string {
    const session = this.host.getSession(sessionId);
    if (!session) throw new Error('That task is no longer on your PC.');
    const norm = (p: string) => resolveAgentPath(p, process.cwd()).toLowerCase();
    const allowed = new Set<string>();
    for (const b of this.transcriptFor(session).blocks) {
      if (b.kind === 'file' || b.kind === 'image') allowed.add(norm(b.path));
    }
    for (const f of this.host.getTaskFiles(sessionId)) allowed.add(norm(f.path));
    if (!filePath || !allowed.has(norm(filePath))) throw new Error('That file isn’t part of this task.');
    return resolveAgentPath(filePath, process.cwd());
  }

  /**
   * fetch_file: the phone tapped a picture or file from a task. It travels
   * as base64 chunks under transfers/.
   */
  private async sendFileToPhone(transferId: string, sessionId: string, filePath: string): Promise<Record<string, unknown>> {
    if (!this.db || !this.uid) throw new Error('Not connected');
    return this.uploadTransfer(transferId, sessionId, this.assertTaskFile(sessionId, filePath));
  }

  /**
   * fetch_file with mode "scene": a .blend, which the phone can't open. The
   * PC prepares it in a windowless Blender (threed/scenePreview) — a render
   * through the scene camera, the whole scene as a GLB, the HDRI sky and the
   * camera view — and sends each part as its own transfer.
   */
  private async sendSceneToPhone(commandId: string, sessionId: string, filePath: string): Promise<Record<string, unknown>> {
    if (!this.db || !this.uid) throw new Error('Not connected');
    const real = this.assertTaskFile(sessionId, filePath);
    if (!/\.blend$/i.test(real)) throw new Error('Only .blend files can be opened as a scene.');
    const { prepareScenePreview } = await import('../threed/scenePreview');
    const preview = await prepareScenePreview(real);
    const parts: Record<string, unknown> = {};
    for (const [name, file] of [['render', preview.render], ['sky', preview.sky], ['glb', preview.glb]] as const) {
      if (file) parts[name] = await this.uploadTransfer(`${commandId}-${name}`, sessionId, file);
    }
    if (!parts.render && !parts.glb) throw new Error('Blender couldn’t make anything viewable from that scene.');
    return { mode: 'scene', name: path.basename(filePath), view: preview.view, parts };
  }

  private async uploadTransfer(transferId: string, sessionId: string, filePath: string): Promise<Record<string, unknown>> {
    if (!this.db || !this.uid) throw new Error('Not connected');
    let data: Buffer;
    try {
      const st = await fs.stat(filePath);
      if (!st.isFile()) throw new Error('not a file');
      if (st.size > MAX_TRANSFER_BYTES) {
        throw new Error(`It’s ${(st.size / 1048576).toFixed(0)} MB — too big to send to the phone (max ${MAX_TRANSFER_BYTES / 1048576} MB). Ask DEX to send it on WhatsApp or share it from Drive.`);
      }
      data = await fs.readFile(filePath);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      throw new Error(e.code === 'ENOENT' ? 'The file isn’t on your PC anymore (moved or deleted).' : e.message);
    }

    const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
    const chunks = Math.max(1, Math.ceil(data.length / CHUNK_BYTES));
    for (let i = 0; i < chunks; i += 1) {
      await setDoc(doc(this.db, this.userDoc('transfers', transferId, 'chunks', String(i).padStart(4, '0'))), {
        i,
        data: data.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES).toString('base64'),
      });
    }
    const name = path.basename(filePath);
    await setDoc(doc(this.db, this.userDoc('transfers', transferId)), {
      name,
      size: data.length,
      mime: mimeForName(name),
      chunks,
      sessionId,
      createdAt: Date.now(),
      updatedAt: serverTimestamp(),
    });
    mainLogger.info('firebase.bridge.fileSent', { bytes: data.length, chunks });
    return { transferId, name, size: data.length, chunks };
  }

  /**
   * The phone's attachments for a command: each uploads/{id} (meta written
   * last, so its presence means every chunk is there) reassembled into
   * bytes, then deleted. A missing or partial upload fails the command
   * rather than sending the task without the file.
   */
  private async collectUploads(ids: unknown): Promise<PhoneAttachment[]> {
    if (!Array.isArray(ids) || ids.length === 0 || !this.db || !this.uid) return [];
    const { collection, doc, getDoc, getDocs, writeBatch } = await import('firebase/firestore');
    const out: PhoneAttachment[] = [];
    for (const id of ids.filter((v): v is string => typeof v === 'string').slice(0, 10)) {
      const ref = doc(this.db, this.userDoc('uploads', id));
      const meta = await getDoc(ref);
      if (!meta.exists()) throw new Error('An attachment from the phone didn’t arrive — send it again.');
      const m = meta.data() as { name?: string; mime?: string; chunks?: number; size?: number };
      const parts = (await getDocs(collection(ref, 'chunks'))).docs;
      const ordered = parts.map((d) => d.data() as { i: number; data: string }).sort((a, b) => a.i - b.i);
      if (ordered.length !== m.chunks) throw new Error(`${m.name ?? 'An attachment'} arrived incomplete (${ordered.length}/${m.chunks} parts) — send it again.`);
      const bytes = Buffer.concat(ordered.map((p) => Buffer.from(p.data, 'base64')));
      out.push({ name: String(m.name ?? 'attachment').slice(0, 200), mime: String(m.mime || 'application/octet-stream'), bytes });
      const batch = writeBatch(this.db);
      parts.forEach((p) => batch.delete(p.ref));
      batch.delete(ref);
      await batch.commit().catch(() => undefined);
    }
    if (out.length) mainLogger.info('firebase.bridge.uploadsReceived', { count: out.length, bytes: out.reduce((n, a) => n + a.bytes.byteLength, 0) });
    return out;
  }

  /** Transfers the phone never picked up (app closed mid-download). */
  private async sweepTransfers(): Promise<void> {
    if (!this.db || !this.uid) return;
    const { collection, getDocs, query, where, writeBatch } = await import('firebase/firestore');
    let swept = 0;
    // Both directions: files the phone never picked up, and uploads a
    // command never claimed (app killed between upload and send).
    for (const name of ['transfers', 'uploads']) {
      const old = await getDocs(query(collection(this.db, this.userDoc(name)), where('createdAt', '<', Date.now() - 60 * 60_000)));
      for (const t of old.docs) {
        const chunks = await getDocs(collection(t.ref, 'chunks'));
        const batch = writeBatch(this.db);
        chunks.docs.forEach((c) => batch.delete(c.ref));
        batch.delete(t.ref);
        await batch.commit();
      }
      swept += old.size;
    }
    if (swept > 0) mainLogger.info('firebase.bridge.transfersSwept', { count: swept });
  }

  private async runCommand(commandId: string, data: Record<string, unknown>): Promise<void> {
    if (!this.db || !this.uid) return;
    const { doc, runTransaction, updateDoc, serverTimestamp } = await import('firebase/firestore');
    const ref = doc(this.db, this.userDoc('commands', commandId));
    // Only one desktop runs a command: claim it first.
    const target = typeof data.deviceId === 'string' ? data.deviceId : null;
    if (target && target !== this.deviceId) return;
    const claimed = await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists() || snap.data().status !== 'pending') return false;
      tx.update(ref, { status: 'running', claimedBy: this.deviceId, claimedAt: serverTimestamp() });
      return true;
    }).catch(() => false);
    if (!claimed) return;

    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    mainLogger.info('firebase.bridge.command', { type: data.type });
    try {
      let result: Record<string, unknown> = {};
      switch (data.type) {
        case 'new_task': {
          const attachments = await this.collectUploads(data.uploads);
          const r = await this.host.newTask({ prompt: str(data.prompt), engine: str(data.engine) || undefined, model: str(data.model) || undefined, attachments });
          result = { sessionId: r.id, error: r.error ?? null };
          if (r.id) await this.writeSession(r.id, { withBlocks: true });
          break;
        }
        case 'follow_up':
          result = await this.host.followUp(str(data.sessionId), str(data.prompt), await this.collectUploads(data.uploads));
          break;
        case 'pause':
          result = { value: JSON.parse(JSON.stringify(this.host.pause(str(data.sessionId)) ?? null)) };
          break;
        case 'resume':
          result = await this.host.resume(str(data.sessionId));
          break;
        case 'stop':
          result = { value: JSON.parse(JSON.stringify(this.host.stop(str(data.sessionId)) ?? null)) };
          break;
        case 'answer_confirmation':
          result = this.host.answerConfirmation(str(data.sessionId), str(data.confirmationId), data.approved === true, str(data.lifetime) || undefined);
          break;
        case 'set_approval_mode':
          result = { mode: this.host.setApprovalMode(str(data.mode)) };
          await this.publishDevice(true);
          break;
        case 'sync_session':
          this.written.delete(str(data.sessionId));
          await this.writeSession(str(data.sessionId), { withBlocks: true });
          result = { synced: true };
          break;
        case 'fetch_file':
          result = data.mode === 'scene'
            ? await this.sendSceneToPhone(commandId, str(data.sessionId), str(data.path))
            : await this.sendFileToPhone(commandId, str(data.sessionId), str(data.path));
          break;
        default:
          throw new Error(`Unknown command: ${String(data.type)}`);
      }
      await updateDoc(ref, { status: 'done', result, finishedAt: serverTimestamp() });
    } catch (err) {
      await updateDoc(ref, { status: 'error', error: (err as Error).message, finishedAt: serverTimestamp() }).catch(() => {});
    }
  }
}

