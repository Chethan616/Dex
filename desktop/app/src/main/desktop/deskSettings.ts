/**
 * Settings › Desktop control (docs/desktop-control/PLAN.md §Phase 3):
 *
 * - `blocked`: apps DEX never uses, on top of the built-in list (password
 *   managers, Windows Security, terminals, other agents). The Windows server
 *   reads them from this file on every call, whatever the engine.
 * - `askFirst`: apps DEX asks about before it starts using them in a task
 *   ("Let DEX use Outlook for this task?"), in every approval mode.
 * - `firstUseAsks`: the same question for every app, with "Approve for me"
 *   and "Ask" (Full access stays quiet, the owner's decision Q2).
 *
 * Kept in `<userData>/desktop/settings.json`. Apps are process names, lower
 * case, with ".exe": what the Windows tools see.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface DeskSettings {
  blocked: string[];
  askFirst: string[];
  firstUseAsks: boolean;
}

const DEFAULTS: DeskSettings = { blocked: [], askFirst: [], firstUseAsks: false };
const MAX_APPS = 60;

/** "Outlook", "OUTLOOK.EXE", "C:\…\olk.exe" → "outlook.exe" / "olk.exe"; null for anything else. */
export function normalizeApp(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let name = raw.trim().replace(/^["']|["']$/g, '');
  name = name.split(/[\\/]/).pop() ?? '';
  name = name.toLowerCase();
  if (!name) return null;
  if (!name.endsWith('.exe')) name = `${name}.exe`;
  return /^[\w .()&+-]{1,80}\.exe$/.test(name) ? name : null;
}

function cleanList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const app = normalizeApp(item);
    if (app && !out.includes(app)) out.push(app);
    if (out.length >= MAX_APPS) break;
  }
  return out;
}

export function settingsFile(home: string): string {
  return path.join(home, 'settings.json');
}

export function readDeskSettings(home: string): DeskSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(home), 'utf-8')) as Partial<DeskSettings>;
    return { blocked: cleanList(raw.blocked), askFirst: cleanList(raw.askFirst), firstUseAsks: raw.firstUseAsks === true };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeDeskSettings(home: string, patch: Partial<Record<keyof DeskSettings, unknown>>): DeskSettings {
  const prev = readDeskSettings(home);
  const next: DeskSettings = {
    blocked: patch.blocked !== undefined ? cleanList(patch.blocked) : prev.blocked,
    askFirst: patch.askFirst !== undefined ? cleanList(patch.askFirst) : prev.askFirst,
    firstUseAsks: patch.firstUseAsks !== undefined ? patch.firstUseAsks === true : prev.firstUseAsks,
  };
  // An app is either never used or asked about, not both.
  next.askFirst = next.askFirst.filter((a) => !next.blocked.includes(a));
  fs.mkdirSync(home, { recursive: true });
  const tmp = `${settingsFile(home)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, settingsFile(home));
  return next;
}

/**
 * Must this use of an app ask "Let DEX use it for this task?" first — and if
 * so, which app. `approved` holds the apps the user already said yes to in
 * this task.
 */
export function firstUseApp(
  settings: DeskSettings,
  subject: string | undefined,
  mode: 'ask' | 'auto' | 'full',
  approved: ReadonlySet<string> | undefined,
): string | null {
  // Only a real app: the Windows tools name one by its process ("Spotify.exe");
  // "media" or a link to open isn't one.
  if (typeof subject !== 'string' || !/\.exe$/i.test(subject.trim())) return null;
  const app = normalizeApp(subject);
  if (!app || approved?.has(app)) return null;
  if (settings.askFirst.includes(app)) return app;
  if (settings.firstUseAsks && mode !== 'full') return app;
  return null;
}
