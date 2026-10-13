/**
 * What a site in a task's tab may use: camera, location, notifications…
 *
 * Electron grants every permission request unless the app says otherwise,
 * which would let any page DEX opens turn on your camera. Chrome asks
 * instead, and so does DEX now:
 * - harmless ones (fullscreen, writing to the clipboard) just go through;
 * - sensitive ones ask you, but only when you were the one using that tab a
 *   moment ago. A request nobody is looking at (the agent's page, a page in
 *   the background) is blocked: DEX never grants your camera on its own;
 * - your answer is remembered per site when you tick the box, and "Clear
 *   data for this site" forgets it.
 */
import fs from 'node:fs';
import path from 'node:path';

export type Decision = 'allow' | 'block';

/** Granted without asking, as Chrome does. */
const QUIET = new Set([
  'fullscreen',
  'clipboard-sanitized-write',
  'pointerLock',
  'keyboardLock',
  'speaker-selection',
  'mediaKeySystem',
  'storage-access',
  'top-level-storage-access',
]);

/** Worth a question. Anything not listed here or in QUIET is blocked. */
const ASKABLE: Record<string, string> = {
  geolocation: 'know your location',
  notifications: 'show you notifications',
  'clipboard-read': 'see what you copied',
  midi: 'use your MIDI devices',
  midiSysex: 'use your MIDI devices',
  'idle-detection': "know when you're away from your PC",
  'window-management': 'see how your screens are arranged',
  fileSystem: 'edit files on your PC',
  openExternal: 'open another app',
};

/** How long after your own input a request still counts as yours. */
export const USER_REQUEST_WINDOW_MS = 10_000;

export function isQuiet(permission: string): boolean {
  return QUIET.has(permission);
}

/** "use your camera and microphone", or null for a permission DEX never grants. */
export function describePermission(permission: string, details: { mediaTypes?: string[]; externalURL?: string } = {}): string | null {
  if (permission === 'media') {
    const types = new Set(details.mediaTypes ?? []);
    if (types.has('video') && types.has('audio')) return 'use your camera and microphone';
    if (types.has('video')) return 'use your camera';
    if (types.has('audio')) return 'use your microphone';
    return 'use your camera and microphone';
  }
  if (permission === 'openExternal' && details.externalURL) {
    const scheme = details.externalURL.split(':')[0]?.toLowerCase();
    if (scheme === 'mailto') return 'open your email app';
    if (scheme === 'tel') return 'start a call';
    return `open another app (${scheme}:)`;
  }
  return ASKABLE[permission] ?? null;
}

/** The key a decision is remembered under: camera and mic are separate. */
export function decisionKey(permission: string, details: { mediaTypes?: string[] } = {}): string {
  if (permission !== 'media') return permission;
  const types = [...new Set(details.mediaTypes ?? [])].sort();
  return types.length ? `media:${types.join('+')}` : 'media';
}

/** Remembered answers, per origin, in `<userData>/site-permissions.json`. */
export class SitePermissionStore {
  private data: Record<string, Record<string, Decision>> = {};
  private loaded = false;
  private dirty = false;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly file: string) {}

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown;
      if (raw && typeof raw === 'object') this.data = raw as Record<string, Record<string, Decision>>;
    } catch { /* none yet */ }
  }

  get(origin: string, key: string): Decision | null {
    this.load();
    const d = this.data[origin]?.[key];
    return d === 'allow' || d === 'block' ? d : null;
  }

  set(origin: string, key: string, decision: Decision): void {
    this.load();
    (this.data[origin] ??= {})[key] = decision;
    this.dirty = true;
    this.scheduleWrite();
  }

  forget(origin: string): void {
    this.load();
    if (!this.data[origin]) return;
    delete this.data[origin];
    this.dirty = true;
    this.scheduleWrite();
  }

  /** Every site with a remembered answer, for Settings. */
  all(): Record<string, Record<string, Decision>> {
    this.load();
    return JSON.parse(JSON.stringify(this.data)) as Record<string, Record<string, Decision>>;
  }

  /** Write pending answers now (on quit). Nothing changed, nothing written. */
  flush(): void {
    if (this.writeTimer) { clearTimeout(this.writeTimer); this.writeTimer = null; }
    if (!this.dirty) return;
    this.dirty = false;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch { /* best effort; asked again next time */ }
  }

  private scheduleWrite(): void {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => this.flush(), 500);
  }
}

export interface PermissionRequest {
  origin: string;
  permission: string;
  details: { mediaTypes?: string[]; externalURL?: string };
  /** You used this tab within USER_REQUEST_WINDOW_MS. */
  userActive: boolean;
}

export interface PermissionDeps {
  store: Pick<SitePermissionStore, 'get' | 'set'>;
  /** Ask you; resolves your answer and whether to remember it. */
  ask(host: string, what: string): Promise<{ allow: boolean; remember: boolean }>;
  log?(event: string, data: Record<string, unknown>): void;
}

function hostOf(origin: string): string {
  try { return new URL(origin).host || origin; } catch { return origin; }
}

/** Questions already on screen, so a page asking twice doesn't stack dialogs. */
const inFlight = new Map<string, Promise<boolean>>();

/** Whether to grant one request, asking you when that's right. */
export async function decide(req: PermissionRequest, deps: PermissionDeps): Promise<boolean> {
  if (isQuiet(req.permission)) return true;
  const what = describePermission(req.permission, req.details);
  if (!what) {
    deps.log?.('sitePermissions.refused', { origin: req.origin, permission: req.permission });
    return false;
  }
  const key = decisionKey(req.permission, req.details);
  // openExternal is remembered per scheme: allowing mailto: isn't allowing steam:.
  const rememberKey = req.permission === 'openExternal' && req.details.externalURL
    ? `openExternal:${req.details.externalURL.split(':')[0]?.toLowerCase()}`
    : key;
  const remembered = deps.store.get(req.origin, rememberKey);
  if (remembered) return remembered === 'allow';
  if (!req.userActive) {
    deps.log?.('sitePermissions.unattended', { origin: req.origin, permission: rememberKey });
    return false;
  }
  const flightKey = `${req.origin}|${rememberKey}`;
  const pending = inFlight.get(flightKey);
  if (pending) return pending;
  const asking = deps.ask(hostOf(req.origin), what).then(({ allow, remember }) => {
    if (remember) deps.store.set(req.origin, rememberKey, allow ? 'allow' : 'block');
    deps.log?.('sitePermissions.answered', { origin: req.origin, permission: rememberKey, allow, remember });
    return allow;
  }).catch(() => false).finally(() => inFlight.delete(flightKey));
  inFlight.set(flightKey, asking);
  return asking;
}

/** The synchronous check pages make (`navigator.permissions.query`, device labels). */
export function check(origin: string, permission: string, store: Pick<SitePermissionStore, 'get'>, details: { mediaType?: string } = {}): boolean {
  if (isQuiet(permission)) return true;
  if (permission === 'media') {
    const type = details.mediaType;
    const keys = type === 'video' || type === 'audio'
      ? [`media:${type}`, 'media:audio+video', 'media']
      : ['media:audio+video', 'media'];
    return keys.some((k) => store.get(origin, k) === 'allow');
  }
  return store.get(origin, permission) === 'allow';
}
