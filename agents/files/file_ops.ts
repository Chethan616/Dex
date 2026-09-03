import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { PathRefused, folderPath, profilePath } from './profile_paths';
import { canDescribe, describeImage } from '../../core/llm/vision';

/**
 * The ordinary things people do to files.
 *
 * Reading, listing, copying, moving, renaming in bulk, deleting, hashing,
 * zipping. Every one of them goes through `profilePath`, so the boundary is
 * decided in one place rather than re-argued per action.
 *
 * Two of these can lose work, and both are shaped so that they cannot do it
 * quietly:
 *
 * - **`renameFiles` plans before it acts.** Called with `apply: false` — the
 *   default — it returns exactly what it would rename and changes nothing. A
 *   bulk rename that silently touches 400 files is not something you recover
 *   from by reading a log afterwards, and the confirmation card can show the
 *   list because the list exists before the work does.
 * - **`deleteFile` uses the Recycle Bin.** Permanent deletion is a separate
 *   flag. "Delete" meaning "unrecoverable" is a promise no automation should
 *   make on someone's behalf by default.
 */

const MAX_READ_BYTES = 2_000_000;
const MAX_LIST = 500;

export function readFile(params: Record<string, unknown>): Record<string, unknown> {
  const file = profilePath(String(params.path ?? ''), true);
  const stat = fs.statSync(file);

  if (stat.isDirectory()) {
    throw new Error(`${file} is a folder — use list_dir`);
  }
  if (stat.size > MAX_READ_BYTES) {
    throw new Error(
      `${path.basename(file)} is ${formatBytes(stat.size)}; read_file stops at ` +
        `${formatBytes(MAX_READ_BYTES)}. Use run_command with findstr or rg to ` +
        'search inside it instead.',
    );
  }

  const text = fs.readFileSync(file, 'utf8');
  return {
    path: file,
    bytes: stat.size,
    lines: text.split('\n').length,
    content: text,
  };
}

export function listDir(params: Record<string, unknown>): Record<string, unknown> {
  const dir = folderPath(String(params.path ?? params.folder ?? 'home'));
  const pattern = String(params.pattern ?? '').trim();
  const matcher = pattern ? globToRegExp(pattern) : null;

  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => !matcher || matcher.test(e.name))
    .slice(0, MAX_LIST)
    .map((entry) => {
      const full = path.join(dir, entry.name);
      let size = 0;
      let modified = 0;
      try {
        const stat = fs.statSync(full);
        size = stat.size;
        modified = stat.mtimeMs;
      } catch {
        // A file that vanished between readdir and stat. Listing it with
        // zeroes is better than failing the whole listing for it.
      }
      return {
        name: entry.name,
        kind: entry.isDirectory() ? 'folder' : 'file',
        size,
        modified: new Date(modified).toISOString(),
      };
    });

  const total = fs.readdirSync(dir).length;
  return {
    path: dir,
    count: entries.length,
    truncated: total > entries.length,
    entries,
  };
}

export function copyFile(params: Record<string, unknown>): Record<string, unknown> {
  const from = profilePath(String(params.from ?? params.source ?? ''), true);
  const to = profilePath(String(params.to ?? params.destination ?? ''));
  const overwrite = params.overwrite === true;

  const target = fs.existsSync(to) && fs.statSync(to).isDirectory()
    ? path.join(to, path.basename(from))
    : to;

  if (fs.existsSync(target) && !overwrite) {
    throw new Error(
      `${target} already exists. Pass overwrite=true to replace it.`,
    );
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(from, target, { recursive: true, force: overwrite });
  return { from, to: target, bytes: sizeOf(target) };
}

export function moveFile(params: Record<string, unknown>): Record<string, unknown> {
  const from = profilePath(String(params.from ?? params.source ?? ''), true);
  const to = profilePath(String(params.to ?? params.destination ?? ''));
  const overwrite = params.overwrite === true;

  const target = fs.existsSync(to) && fs.statSync(to).isDirectory()
    ? path.join(to, path.basename(from))
    : to;

  if (fs.existsSync(target) && !overwrite) {
    throw new Error(`${target} already exists. Pass overwrite=true to replace it.`);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.renameSync(from, target);
  } catch (err) {
    // Across drives rename fails with EXDEV; copy-then-delete is the move.
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    fs.cpSync(from, target, { recursive: true, force: overwrite });
    fs.rmSync(from, { recursive: true, force: true });
  }
  return { from, to: target };
}

/**
 * Bulk rename, with the plan separated from the doing.
 *
 * `apply` defaults to false. The first call answers "what would you change?"
 * and touches nothing; the caller shows that list, gets an answer, and calls
 * again with `apply: true`. Collisions are detected in the planning pass, so a
 * rename that would overwrite one file with another is refused before any of
 * them move rather than halfway through.
 */
export function renameFiles(params: Record<string, unknown>): Record<string, unknown> {
  const dir = folderPath(String(params.folder ?? params.path ?? ''));
  const apply = params.apply === true;

  const pattern = String(params.pattern ?? '*').trim();
  const matcher = globToRegExp(pattern);

  const find = params.find !== undefined ? String(params.find) : null;
  const replace = String(params.replace ?? '');
  const prefix = String(params.prefix ?? '');
  const suffix = String(params.suffix ?? '');

  if (find === null && !prefix && !suffix) {
    throw new Error(
      'rename_files needs something to change: find/replace, prefix, or suffix',
    );
  }

  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && matcher.test(e.name))
    .map((e) => e.name);

  const planned: { from: string; to: string }[] = [];
  const taken = new Set(files.map((f) => f.toLowerCase()));

  for (const name of files) {
    const extension = path.extname(name);
    let stem = path.basename(name, extension);

    if (find !== null) stem = stem.split(find).join(replace);
    stem = `${prefix}${stem}${suffix}`;

    const renamed = `${stem}${extension}`;
    if (renamed === name) continue;
    planned.push({ from: name, to: renamed });
  }

  // Two kinds of collision, both fatal before anything moves.
  const collisions: string[] = [];
  const targets = new Set<string>();
  for (const { from, to } of planned) {
    const key = to.toLowerCase();
    if (targets.has(key)) collisions.push(`two files would both become ${to}`);
    if (taken.has(key) && !planned.some((p) => p.from.toLowerCase() === key)) {
      collisions.push(`${from} would overwrite the existing ${to}`);
    }
    targets.add(key);
  }

  if (collisions.length > 0) {
    throw new Error(
      `That rename would lose files:\n  ${collisions.slice(0, 5).join('\n  ')}` +
        (collisions.length > 5 ? `\n  ...and ${collisions.length - 5} more` : ''),
    );
  }

  if (!apply) {
    return {
      folder: dir,
      would_rename: planned.length,
      preview: planned.slice(0, 20),
      truncated: planned.length > 20,
      applied: false,
      note: 'Nothing has changed. Call again with apply=true to do it.',
    };
  }

  const done: { from: string; to: string }[] = [];
  for (const { from, to } of planned) {
    fs.renameSync(path.join(dir, from), path.join(dir, to));
    done.push({ from, to });
  }

  return { folder: dir, renamed: done.length, changes: done.slice(0, 20), applied: true };
}

/**
 * Delete, to the Recycle Bin unless told otherwise.
 *
 * The bin is not a nicety here. Dex is acting on a plan produced by a language
 * model from a sentence, and the gap between "delete the old logs" and which
 * files those are is exactly where a recoverable delete earns its place.
 */
export function deleteFile(params: Record<string, unknown>): Record<string, unknown> {
  const target = profilePath(String(params.path ?? ''), true);
  const permanent = params.permanent === true;

  if (!permanent) {
    const sent = recycle(target);
    if (sent) {
      return { path: target, method: 'recycle bin', recoverable: true };
    }
    // Falling through to a permanent delete would turn a recoverable request
    // into an unrecoverable one without saying so.
    throw new Error(
      `Could not move ${target} to the Recycle Bin. Pass permanent=true if you ` +
        'really mean to delete it outright.',
    );
  }

  const stat = fs.statSync(target);
  fs.rmSync(target, { recursive: stat.isDirectory(), force: true });
  return { path: target, method: 'permanent', recoverable: false };
}

export function hashFile(params: Record<string, unknown>): Record<string, unknown> {
  const file = profilePath(String(params.path ?? ''), true);
  const algorithm = String(params.algorithm ?? 'sha256').toLowerCase();

  if (!['sha256', 'sha1', 'md5', 'sha512'].includes(algorithm)) {
    throw new Error(`Unsupported hash: ${algorithm}`);
  }

  const digest = createHash(algorithm).update(fs.readFileSync(file)).digest('hex');
  const expected = params.expected ? String(params.expected).trim().toLowerCase() : null;

  return {
    path: file,
    algorithm,
    hash: digest,
    bytes: fs.statSync(file).size,
    ...(expected ? { expected, matches: digest === expected } : {}),
  };
}

// ---------------------------------------------------------------------------

function recycle(target: string): boolean {
  // The Recycle Bin is a shell concept, not a filesystem one, so this goes
  // through SHFileOperation via PowerShell's VisualBasic interop — the one
  // documented way to do it without a native module. windowsHide, because a
  // console window here would undo the whole no-terminals guarantee.
  const { spawnSync } = require('child_process') as typeof import('child_process');
  const script =
    'Add-Type -AssemblyName Microsoft.VisualBasic; ' +
    `$p = ${JSON.stringify(target)}; ` +
    'if (Test-Path -PathType Container $p) { ' +
    '[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, ' +
    "'OnlyErrorDialogs','SendToRecycleBin') } else { " +
    '[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, ' +
    "'OnlyErrorDialogs','SendToRecycleBin') }";

  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, timeout: 20_000, encoding: 'utf8' },
  );
  return result.status === 0 && !fs.existsSync(target);
}

function sizeOf(target: string): number {
  try {
    return fs.statSync(target).size;
  } catch {
    return 0;
  }
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export { PathRefused };

/**
 * Fetch a URL to a file on disk.
 *
 * The first half of "download this and send it to my phone". Deliberately does
 * not try to be a browser: no JavaScript, no login, no cookies. If a link needs
 * a session to work, that is a job for can_browse_web, which has a real browser
 * and can hand off to the owner when a site asks for a password.
 *
 * What it does do is refuse to be surprising:
 *
 *   - **http and https only.** `file://` would turn "download this" into "read
 *     any file on the machine and hand it to whoever suggested the link", and
 *     the thing suggesting links is often a web page Dex was asked to read.
 *   - **A size ceiling, enforced while streaming.** A Content-Length can lie
 *     or be absent, so the count that stops the download is the one taken from
 *     the bytes as they arrive.
 *   - **The filename is chosen here, never by the server.** A remote name is a
 *     remote instruction; `../../.ssh/authorized_keys` is a valid-looking
 *     Content-Disposition.
 */
export async function downloadFile(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const raw = String(params.url ?? '').trim();
  if (!raw) throw new Error('download_file needs a url');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `Refused: ${url.protocol} is not a web address. download_file fetches ` +
        'http and https only.',
    );
  }

  const maxBytes = Math.min(
    Number(params.max_bytes ?? 100_000_000),
    500_000_000,
  );

  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Dex/0.9 (+local automation)' },
  });

  if (!response.ok) {
    throw new Error(
      `${url.host} answered ${response.status} ${response.statusText}`,
    );
  }
  if (!response.body) throw new Error('The server sent no content');

  const name = safeFileName(
    String(params.filename ?? '') ||
      fileNameFrom(response.headers.get('content-disposition'), url),
  );

  // Named folder, absolute path, or Downloads. Whatever it resolves to still
  // goes through profilePath, so a download cannot land in Windows.
  const intoRaw = String(params.into ?? 'downloads');
  const folder = folderPath(intoRaw);
  const target = profilePath(path.join(folder, name));

  fs.mkdirSync(path.dirname(target), { recursive: true });

  const hash = createHash('sha256');
  const handle = fs.createWriteStream(target);
  let written = 0;

  try {
    // Streamed rather than buffered: a 2 GB installer must not become 2 GB of
    // heap on the way to disk.
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      written += chunk.length;
      if (written > maxBytes) {
        throw new Error(
          `The file is larger than ${formatBytes(maxBytes)} and was stopped ` +
            'part-way. Raise max_bytes if you meant to fetch something this big.',
        );
      }
      hash.update(chunk);
      if (!handle.write(chunk)) {
        // Backpressure: wait for the disk to catch up rather than buffering a
        // fast download into memory.
        await new Promise<void>((resolve) => handle.once('drain', () => resolve()));
      }
    }
    await new Promise<void>((resolve, reject) => {
      handle.end(() => resolve());
      handle.on('error', reject);
    });
  } catch (err) {
    // A partial download is worse than none — it looks like a file and is not
    // one, and something later will try to open it.
    handle.destroy();
    try {
      fs.rmSync(target, { force: true });
    } catch {
      // Nothing more to do; the error below is the one that matters.
    }
    throw err;
  }

  return {
    path: target,
    name,
    bytes: written,
    size: formatBytes(written),
    sha256: hash.digest('hex'),
    from: url.toString(),
    content_type: response.headers.get('content-type') ?? 'unknown',
  };
}

/**
 * A filename Dex chose, from a name a server suggested.
 *
 * The suggestion is treated as untrusted text, because it is: it arrives from
 * whatever the URL pointed at, and the URL often arrives from a page Dex was
 * asked to read. Only the basename survives, and only characters that are
 * legal on Windows.
 */
function safeFileName(suggested: string): string {
  const base = path.basename(suggested.replace(/\\/g, '/')).trim();
  const cleaned = base
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 180);

  // Reserved device names are still reserved with an extension: CON.txt is
  // not a file you can create on Windows.
  const stem = cleaned.split('.')[0].toUpperCase();
  const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem);

  return cleaned && !reserved ? cleaned : `download-${Date.now()}`;
}

function fileNameFrom(disposition: string | null, url: URL): string {
  if (disposition) {
    // RFC 5987 first — filename*=UTF-8''name — then the plain form.
    const encoded = disposition.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
    if (encoded) {
      try {
        return decodeURIComponent(encoded[1].replace(/^"|"$/g, ''));
      } catch {
        // Fall through to the plain form.
      }
    }
    const plain = disposition.match(/filename="?([^";]+)"?/i);
    if (plain) return plain[1];
  }

  const fromPath = path.basename(decodeURIComponent(url.pathname));
  return fromPath && fromPath !== '/' ? fromPath : `${url.hostname}-download`;
}

/**
 * Unpack an archive, without letting it write outside the boundary.
 *
 * The other half of `downloadFile`. A toolchain that is not on winget arrives
 * as a zip — w64devkit, a portable JDK, ffmpeg — and until now Dex could fetch
 * one and then had no way to open it.
 *
 * Uses `tar.exe`, which has shipped in Windows since 1803 and handles zip as
 * well as tar and tar.gz. That avoids a Node dependency for something the OS
 * already does, and it is the same reasoning as using ctypes over a HID
 * library elsewhere in this project.
 *
 * **Zip slip is the reason the entries are checked rather than trusted.** An
 * archive entry is a filename chosen by whoever made the archive, and
 * `../../../Windows/System32/x.dll` is a perfectly legal one. `profilePath`
 * guards where Dex is *told* to extract; it cannot guard where the archive
 * decides to put things once tar is running. So every entry is listed first and
 * anything absolute, drive-qualified, or containing `..` refuses the whole
 * archive — not just that entry, because an archive carrying one of those is
 * not an archive with a bad file in it, it is a hostile archive.
 */
export function extractArchive(params: Record<string, unknown>): Record<string, unknown> {
  const archive = profilePath(String(params.path ?? ''), true);

  if (!fs.existsSync(archive)) {
    throw new PathRefused(archive, 'there is no archive there');
  }

  // Default: a folder beside the archive, named after it. "Where did it go?"
  // should have an obvious answer.
  const fallback = archive.replace(/\.(zip|tar|tgz|gz|tar\.gz)$/i, '') || `${archive}-extracted`;
  const destination = profilePath(String(params.to ?? fallback));

  const listed = listEntries(archive);
  const unsafe = listed.filter(isEscaping);
  if (unsafe.length > 0) {
    throw new PathRefused(
      path.basename(archive),
      `it contains ${unsafe.length} entr${unsafe.length === 1 ? 'y' : 'ies'} that ` +
        `would write outside ${destination} — for example "${unsafe[0]}". An ` +
        'archive that does that is not one Dex will open.',
    );
  }

  fs.mkdirSync(destination, { recursive: true });

  const result = spawnSync('tar', ['-xf', archive, '-C', destination], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 300_000,
  });

  if (result.status !== 0) {
    throw new Error(
      `Could not extract ${path.basename(archive)}: ` +
        `${(result.stderr || result.stdout || `tar exited ${result.status}`).trim().slice(0, 300)}`,
    );
  }

  // What a later step needs is the directory holding the files, and an archive
  // that wraps everything in one folder — which most toolchains do — makes the
  // destination itself the wrong answer. Report both.
  const entries = fs.readdirSync(destination, { withFileTypes: true });
  const singleRoot = entries.length === 1 && entries[0].isDirectory()
    ? path.join(destination, entries[0].name)
    : destination;

  return {
    archive,
    extractedTo: destination,
    // Where the contents actually are: the folder to put on PATH.
    root: singleRoot,
    entries: listed.length,
  };
}

/** Every path inside the archive, as tar reports them. */
function listEntries(archive: string): string[] {
  const result = spawnSync('tar', ['-tf', archive], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `Could not read ${path.basename(archive)}: ` +
        `${(result.stderr || 'not a readable archive').trim().slice(0, 200)}`,
    );
  }
  return (result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Whether an entry would land outside the folder it is extracted into.
 *
 * Checked on the archive's own text rather than by resolving against the
 * destination, because the question is about the entry, and an entry that says
 * `C:\Windows\...` is wrong wherever it is unpacked.
 */
function isEscaping(entry: string): boolean {
  const normalised = entry.replace(/\\/g, '/');
  if (normalised.startsWith('/')) return true;
  if (/^[A-Za-z]:/.test(normalised)) return true;
  return normalised.split('/').includes('..');
}

/**
 * Turn a picture into strokes something can draw.
 *
 * Runs `agents/files/image_trace.py`, because the work is edge detection and
 * contour walking and Python already has Pillow and numpy in this project. No
 * model is involved: the same image traces the same way every time.
 *
 * The result carries a `note` saying what it actually is — an outline sketch,
 * not a reproduction — and that note travels all the way to the owner rather
 * than being dropped somewhere in the middle.
 */
export async function traceImage(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const source = profilePath(String(params.path ?? ''), true);
  if (!fs.existsSync(source)) {
    throw new PathRefused(source, 'there is no image there');
  }

  const script = path.join(__dirname, 'image_trace.py');
  const runner = [
    'import sys, json',
    // Contour simplification is recursive and a detailed photo goes deep.
    'sys.setrecursionlimit(20000)',
    `sys.path.insert(0, ${JSON.stringify(path.dirname(script))})`,
    'from image_trace import trace_image',
    'print(json.dumps(trace_image(json.loads(sys.argv[1]))))',
  ].join('; ');

  const result = spawnSync(
    'python',
    ['-c', runner, JSON.stringify({ path: source, detail: params.detail ?? 'sketch' })],
    { encoding: 'utf8', windowsHide: true, timeout: 180_000, maxBuffer: 64 * 1024 * 1024 },
  );

  if (result.status !== 0) {
    throw new Error(
      `Could not trace ${path.basename(source)}: ` +
        `${(result.stderr || `python exited ${result.status}`).trim().slice(-400)}`,
    );
  }

  return JSON.parse(result.stdout) as Record<string, unknown>;
}

/**
 * What a document actually says.
 *
 * `readFile` handles text. A curriculum, a syllabus, an invoice, a report — the
 * things worth fetching from a portal — are PDFs, and a PDF read as text is a
 * few kilobytes of binary noise with a handful of recognisable words in it.
 * That is worse than failing, because it looks like content.
 *
 * Runs `read_document.py`, which uses pypdf — already installed here. Named for
 * documents rather than for PDFs so DOCX can join it later without every plan
 * that says `read_document` needing to change.
 */
export function readDocument(params: Record<string, unknown>): Record<string, unknown> {
  const source = profilePath(String(params.path ?? ''), true);
  if (!fs.existsSync(source)) {
    throw new PathRefused(source, 'there is no document there');
  }

  const script = path.join(__dirname, 'read_document.py');
  const result = spawnSync(
    'python',
    [script, source, String(params.max_chars ?? 60_000)],
    { encoding: 'utf8', windowsHide: true, timeout: 120_000, maxBuffer: 32 * 1024 * 1024 },
  );

  if (result.status !== 0) {
    throw new Error(
      `Could not read ${path.basename(source)}: ` +
        `${(result.stderr || `python exited ${result.status}`).trim().slice(-400)}`,
    );
  }

  return JSON.parse(result.stdout) as Record<string, unknown>;
}


/**
 * What is in this file, whatever kind of file it is.
 *
 * The gap this fills: asked to "find UI.png and explain it", Dex found the
 * file and stopped. Finding is `find_files`; looking at what was found had no
 * action at all, so the plan had nowhere to go and the answer was a list of
 * one path.
 *
 * Routing by kind rather than making the owner pick:
 *
 *   an image      goes to a model that can see it
 *   a document    is read as text — PDF, DOCX, spreadsheets, code, plain text
 *   anything else reports what is knowable without opening it
 *
 * The owner's own words are passed through as the question. "What is the
 * error in this screenshot" and "what colours are in this mockup" want
 * different answers about the same image, and replacing both with "describe
 * this image" throws that away.
 */
export async function describeFile(
  params: Record<string, unknown>,
  ctx?: { isCancelled(): boolean; report?: (message: string) => void },
): Promise<Record<string, unknown>> {
  const source = profilePath(String(params.path ?? ''), true);
  if (!fs.existsSync(source)) {
    throw new PathRefused(source, 'there is nothing there to look at');
  }

  const question = String(params.question ?? '').trim()
    || 'What is this? Describe what it contains.';
  const name = path.basename(source);
  const stat = fs.statSync(source);

  if (canDescribe(source)) {
    ctx?.report?.(`Looking at ${name}.`);
    // Cancellation reaches the CLI through an AbortSignal, so the owner's
    // Stop ends a vision call instead of waiting out its two-minute ceiling.
    const stop = new AbortController();
    const watch = setInterval(() => {
      if (ctx?.isCancelled()) stop.abort();
    }, 250);
    let seen;
    try {
      seen = await describeImage(source, question, {
        model: String(params.model ?? 'sonnet'),
        signal: stop.signal,
      });
    } finally {
      clearInterval(watch);
    }
    return {
      path: source,
      name,
      kind: 'image',
      bytes: stat.size,
      description: seen.description,
      read_by: `${seen.model} looking at the image`,
    };
  }

  // Not an image. Read it as text, and let the failure say which kind of file
  // it could not read rather than "unsupported".
  let document: Record<string, unknown>;
  try {
    document = readDocument({ path: source, max_chars: params.max_chars ?? 20_000 });
  } catch (err) {
    return {
      path: source,
      name,
      kind: 'unreadable',
      bytes: stat.size,
      modified: stat.mtimeMs,
      description: `This is a ${path.extname(source) || 'file with no extension'} of ` +
        `${Math.round(stat.size / 1024)} KB. Its contents could not be read: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const text = typeof document.text === 'string' ? document.text : '';
  return {
    path: source,
    name,
    kind: 'document',
    bytes: stat.size,
    pages: document.pages,
    characters: text.length,
    // The text itself, for the phrasing step to summarise. Deliberately not
    // summarised here: a second model call to compress text that is about to
    // be read by a model anyway is a round trip for nothing.
    text: text.slice(0, 20_000),
    truncated: text.length > 20_000,
    question,
  };
}
