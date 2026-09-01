import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Where Dex may touch files, and where it may not.
 *
 * File actions used to be confined to a sandboxed `~/Dex/workspace`. That is
 * safe and it is also why "organise my Downloads folder", "hash this installer"
 * and "rotate these logs" were impossible — a third of what Dex is asked to do
 * with files happens in folders the owner already has.
 *
 * So the boundary moves out to the user profile, and is enforced in one place
 * rather than re-derived per action. The rule:
 *
 *   allowed   anything under C:\Users\<you>, OneDrive redirection included
 *   refused   C:\Windows, Program Files, other people's profiles, and Dex's
 *             own credential store
 *
 * The credential store is the interesting one. It is inside the profile, so a
 * profile-wide rule would include it, and Dex would be able to read its own
 * DPAPI-encrypted secrets through an ordinary file action. Encrypted at rest is
 * not the same as unreadable by the process that owns the key.
 *
 * Generalised from the check that was already in `file_agent.ts` for search,
 * which knew about OneDrive redirection — on this machine `Desktop` is
 * `~/OneDrive/Desktop`, and a naive `~/Desktop` finds nothing.
 */

export class PathRefused extends Error {
  constructor(target: string, why: string) {
    super(`Refused: ${target} — ${why}`);
    this.name = 'PathRefused';
  }
}

/** Folders that are never Dex's business, checked before the profile rule. */
function forbiddenRoots(): string[] {
  const roots = [
    process.env.SystemRoot ?? 'C:\\Windows',
    process.env.ProgramFiles ?? 'C:\\Program Files',
    process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    process.env.ProgramData ?? 'C:\\ProgramData',
  ];

  // Dex's own secrets. Inside the profile, and deliberately out of reach: a
  // file action that could read this would undo the credential store.
  const localAppData =
    process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  roots.push(path.join(localAppData, 'DEX', 'credentials'));

  return roots.filter(Boolean).map((r) => path.resolve(r));
}

function isUnder(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Resolve a path and check it is somewhere Dex may act.
 *
 * Resolution happens first, on purpose. `~/Documents/../../Windows/System32`
 * is inside the profile as a string and outside it as a path, and only the
 * resolved form tells the truth. Symlinks are resolved too where the target
 * exists, so a link planted in Downloads cannot be used to step outside.
 */
export function profilePath(raw: string, mustExist = false): string {
  if (!raw || !String(raw).trim()) {
    throw new Error('A file path is required');
  }

  const home = path.resolve(os.homedir());
  const expanded = String(raw)
    .replace(/^~(?=[\\/]|$)/, home)
    .replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? whole);

  let resolved = path.resolve(home, expanded);

  // Follow links where we can. realpathSync throws for a path that does not
  // exist yet, which is normal for a write — the parent is checked instead.
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {
    const parent = path.dirname(resolved);
    try {
      resolved = path.join(fs.realpathSync.native(parent), path.basename(resolved));
    } catch {
      // Neither exists yet. The unresolved path is still checked below.
    }
  }

  for (const forbidden of forbiddenRoots()) {
    if (isUnder(resolved, forbidden)) {
      throw new PathRefused(
        resolved,
        forbidden.toLowerCase().includes('dex')
          ? 'that is Dex\'s own credential store, which it will not read through a file action'
          : 'Dex only works inside your user profile, not in Windows or Program Files',
      );
    }
  }

  if (!isUnder(resolved, home)) {
    throw new PathRefused(
      resolved,
      `Dex only works inside your user profile (${home})`,
    );
  }

  if (mustExist && !fs.existsSync(resolved)) {
    throw new Error(`No such file or folder: ${resolved}`);
  }

  return resolved;
}

/**
 * The folders people name out loud, wherever OneDrive has actually put them.
 *
 * On this machine Desktop and Documents are redirected into OneDrive, so
 * `~/Desktop` does not exist. Anything reading "desktop" literally finds
 * nothing and reports an empty folder, which is worse than an error.
 */
export function namedFolder(raw: string): string | null {
  const home = os.homedir();
  const aliases: Record<string, string[]> = {
    desktop: [path.join(home, 'OneDrive', 'Desktop'), path.join(home, 'Desktop')],
    documents: [path.join(home, 'OneDrive', 'Documents'), path.join(home, 'Documents')],
    downloads: [path.join(home, 'Downloads'), path.join(home, 'OneDrive', 'Downloads')],
    pictures: [path.join(home, 'OneDrive', 'Pictures'), path.join(home, 'Pictures')],
    videos: [path.join(home, 'Videos')],
    music: [path.join(home, 'Music')],
    home: [home],
  };

  const candidates = aliases[raw.trim().toLowerCase()];
  if (!candidates) return null;
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0];
}

/** Resolve a folder someone named, by alias or by path. */
export function folderPath(raw: string): string {
  return profilePath(namedFolder(raw) ?? raw, true);
}
