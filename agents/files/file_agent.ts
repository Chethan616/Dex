import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { Agent } from '../../core/orchestrator/registry';
import { AgentContext, AgentResult } from '../../core/events/types';
import { resolveCommand } from '../../core/settings/which';
import * as ops from './file_ops';
import { namedFolder, profilePath } from './profile_paths';
import { ensureIndex, IndexMatch, IndexStats, searchIndex } from './file_index';

const MAX_FILE_BYTES = 2_000_000;
const MAX_RESULTS = 100;

const SEARCH_STOPWORDS = new Set([
  'a', 'an', 'any', 'check', 'contain', 'contains', 'file', 'files',
  'find', 'for', 'in', 'my', 'related', 'search', 'the', 'with',
]);

const RUNTIMES = new Set(['python', 'node', 'ruby', 'go']);

/**
 * User-side file and program actions.
 *
 * This agent intentionally lives beside Core rather than in the elevated
 * daemon. A generated game must run as the owner, not as Administrator. The
 * workspace boundary limits where Dex writes and what it can execute, while
 * the normal confirmation gate still asks before writing or running code.
 */
export class FileAgent implements Agent {
  name = 'FileAgent';
  capabilities = ['can_control_files'];

  async execute(
    action: string,
    params: Record<string, unknown>,
    _requestId: string,
    _stepId: string,
    ctx?: AgentContext,
  ): Promise<AgentResult> {
    try {
      const signal = ctx?.signal?.();
      if (signal && !signal.shouldContinue) {
        return { success: false, error: signal.message, retryable: false };
      }
      ctx?.report?.(progressSentence(action));
      switch (action) {
        case 'find_files':
          return { success: true, data: this.findFiles(params) };
        case 'write_file':
          return { success: true, data: this.writeFile(params) };
        case 'run_program':
          return { success: true, data: await this.runProgram(params, ctx) };

        // The ordinary file operations. Every one of these resolves its paths
        // through profilePath, so the "your profile, not Windows" boundary is
        // decided once rather than re-argued per action.
        case 'read_file':
          return { success: true, data: ops.readFile(params) };
        case 'list_dir':
          return { success: true, data: ops.listDir(params) };
        case 'copy_file':
          return { success: true, data: ops.copyFile(params) };
        case 'move_file':
          return { success: true, data: ops.moveFile(params) };
        case 'rename_files':
          return { success: true, data: ops.renameFiles(params) };
        case 'delete_file':
          return { success: true, data: ops.deleteFile(params) };
        case 'hash_file':
          return { success: true, data: ops.hashFile(params) };
        case 'download_file':
          return { success: true, data: await ops.downloadFile(params) };
        case 'extract_archive':
          return { success: true, data: ops.extractArchive(params) };
        case 'trace_image':
          return { success: true, data: await ops.traceImage(params) };
        case 'read_document':
          return { success: true, data: ops.readDocument(params) };
        default:
          return {
            success: false,
            error: `FileAgent: unknown action "${action}"`,
            retryable: false,
          };
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        retryable: false,
      };
    }
  }

  /**
   * Find a file anywhere the owner might have put it.
   *
   * This used to walk `Downloads` and match filenames. Asked to "search for
   * aadhaar card files in my pc" it searched one folder and reported fifty
   * Android build resources; asked for `UI.png` on the Desktop it missed a
   * file called exactly that. Both are the same defect — one folder, and no
   * idea what a file contains.
   *
   * Now it asks the index, which knows every fixed drive and has read the
   * text and OCR'd the scans. `scope` is what the owner said: 'pc' means the
   * PC, 'profile' is the default, and a path means that folder.
   *
   * The live walk is kept as the fallback for the first minutes after
   * install, when the index is still being built. It says so in the result
   * rather than passing off a partial answer as a complete one.
   */
  private findFiles(params: Record<string, unknown>): Record<string, unknown> {
    const query = String(params.query ?? params.name ?? '').trim();
    if (!query) throw new Error('find_files needs a filename query');

    const scope = String(params.scope ?? params.root ?? 'profile').trim();
    const requestedLimit = Number(params.max_results ?? 40);
    const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 40, MAX_RESULTS));
    const extraTerms = Array.isArray(params.also_called)
      ? params.also_called.map((term) => String(term))
      : [];

    // A named folder narrows the index; 'pc' and 'profile' do not.
    const narrowed = scope.toLowerCase() === 'pc' || scope.toLowerCase() === 'profile'
      ? undefined
      : searchRoot(scope);

    const { stats, building } = ensureIndex(scope.toLowerCase() === 'pc' ? 'pc' : 'profile');

    if (stats && stats.files > 0) {
      const found = searchIndex(query, { limit, under: narrowed, terms: extraTerms });
      const matches = found.matches.map((match: IndexMatch) => ({
        name: match.name,
        path: match.path,
        directory: path.dirname(match.path),
        why: match.why,
        snippet: match.snippet || undefined,
      }));

      // A file saved a minute ago is not in the index yet, and "not indexed"
      // must never be reported as "not on this PC". When the index has nothing
      // to say, the folder is walked live before answering — the slow path,
      // taken only when the fast one came back empty.
      if (matches.length === 0) {
        const fresh = this.walkForNames(query, narrowed ?? searchRoot('profile'), limit);
        for (const match of fresh.matches) {
          matches.push({ ...match, why: ['filename'], snippet: undefined });
        }
      }

      const openedLocation = params.open_location === true
        ? openLocation(narrowed ?? os.homedir(), matches)
        : undefined;

      return {
        scope: narrowed ?? scope,
        query,
        searched_for: found.searched_for,
        restricted_to: found.restricted_to ?? undefined,
        count: matches.length,
        truncated: found.total > matches.length,
        also_matched_weakly: found.also_matched_weakly,
        searched: describeIndex(stats),
        indexed_at: stats.built ?? undefined,
        matches,
        opened_location: openedLocation,
      };
    }

    // No index yet. Walk what we can and be explicit that this is the narrow
    // answer, so nothing downstream reads "0 matches" as "not on this PC".
    const root = narrowed ?? searchRoot('profile');
    const { matches, terms, truncated } = this.walkForNames(query, root, limit);

    const openedLocation = params.open_location === true
      ? openLocation(root, matches)
      : undefined;
    return {
      scope: root,
      query,
      query_terms: terms,
      count: matches.length,
      truncated,
      matches,
      opened_location: openedLocation,
      searched: building
        ? 'filenames only — the file index is still being built, so this searched one folder by name'
        : 'filenames only — the file index is not available, so this searched one folder by name',
      partial: true,
    };
  }

  /**
   * Filenames under one folder, read from disk right now.
   *
   * Kept because an index is always slightly behind the disk. It is the whole
   * answer before the first crawl finishes, and the second opinion afterwards.
   */
  private walkForNames(query: string, root: string, limit: number): {
    matches: Array<{ name: string; path: string; directory: string }>;
    terms: string[];
    truncated: boolean;
  } {
    const terms = queryTerms(query);
    const matches: Array<{ name: string; path: string; directory: string }> = [];
    let truncated = false;

    walkFiles(root, (file) => {
      if (!nameMatches(file.name, terms)) return;
      if (matches.length >= limit) {
        truncated = true;
        return;
      }
      matches.push({ name: file.name, path: file.fullPath, directory: file.directory });
    });
    matches.sort((left, right) => left.path.localeCompare(right.path));
    return { matches, terms, truncated };
  }

  private writeFile(params: Record<string, unknown>): Record<string, unknown> {
    const relativePath = String(params.path ?? '').trim();
    if (!relativePath) throw new Error('write_file needs a path relative to the Dex workspace');
    if (typeof params.content !== 'string') throw new Error('write_file needs text content');

    const content = Buffer.from(params.content, 'utf8');
    if (content.byteLength > MAX_FILE_BYTES) {
      throw new Error(`write_file is limited to ${MAX_FILE_BYTES} bytes`);
    }

    const root = workspaceRoot();
    const destination = resolveWritePath(relativePath, root);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
    return {
      path: destination,
      relative_path: path.relative(root, destination),
      bytes: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex'),
    };
  }

  private async runProgram(
    params: Record<string, unknown>,
    ctx?: AgentContext,
  ): Promise<Record<string, unknown>> {
    const relativePath = String(params.path ?? '').trim();
    if (!relativePath) throw new Error('run_program needs a source path in the Dex workspace');

    const root = workspaceRoot();
    const source = resolveWritePath(relativePath, root);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      throw new Error(`No such program: ${source}`);
    }

    const runtime = String(params.runtime ?? '').trim().toLowerCase();
    const command = runtimeCommand(source, runtime);
    const rawArgs = params.args ?? [];
    if (!Array.isArray(rawArgs) || !rawArgs.every((arg) => typeof arg === 'string')) {
      throw new Error('run_program args must be a list of strings');
    }
    command.push(...rawArgs as string[]);

    const background = params.background !== false;
    const timeout = Math.max(1_000, Math.min(Number(params.timeout ?? 30) * 1_000, 120_000));
    if (ctx?.signal && !ctx.signal().shouldContinue) {
      throw new Error(ctx.signal().message);
    }
    if (background) {
      return this.startBackground(command, root, source, runtime, ctx);
    }
    return this.runForeground(command, root, source, runtime, timeout, ctx);
  }

  private async startBackground(
    command: string[],
    root: string,
    source: string,
    runtime: string,
    ctx?: AgentContext,
  ): Promise<Record<string, unknown>> {
    const child = spawn(command[0], command.slice(1), {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    child.unref();
    await delay(500);
    if (ctx?.signal && !ctx.signal().shouldContinue) {
      child.kill();
      throw new Error(ctx.signal().message);
    }
    if (child.exitCode !== null && child.exitCode !== 0) {
      throw new Error(
        `${path.basename(source)} exited immediately with code ${child.exitCode}; ` +
        'run it with background=false to inspect its output',
      );
    }
    if (child.exitCode === 0) {
      return {
        path: source,
        runtime: runtime || path.extname(source).slice(1),
        returncode: 0,
        background: false,
        stdout: '',
        stderr: '',
      };
    }
    return {
      path: source,
      runtime: runtime || path.extname(source).slice(1),
      pid: child.pid,
      background: true,
      running: true,
    };
  }

  private runForeground(
    command: string[],
    root: string,
    source: string,
    runtime: string,
    timeout: number,
    ctx?: AgentContext,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const child = spawn(command[0], command.slice(1), {
        cwd: root,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let finished = false;
      let timer: NodeJS.Timeout;
      const signal = ctx?.signal;
      const signalTimer = signal
        ? setInterval(() => {
            if (finished || signal().shouldContinue) return;
            finished = true;
            clearTimeout(timer);
            if (signalTimer) clearInterval(signalTimer);
            child.kill();
            reject(new Error(signal().message));
          }, 100)
        : undefined;
      timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        if (signalTimer) clearInterval(signalTimer);
        child.kill();
        reject(new Error(`${path.basename(source)} timed out after ${timeout / 1000}s`));
      }, timeout);

      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on('error', (err) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (signalTimer) clearInterval(signalTimer);
        reject(new Error(`Could not run ${path.basename(source)}: ${err.message}`));
      });
      child.on('close', (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (signalTimer) clearInterval(signalTimer);
        if (code !== 0) {
          const detail = (stderr.trim() || stdout.trim() || `exited ${code}`).slice(0, 1000);
          reject(new Error(`${path.basename(source)} failed (${code}): ${detail}`));
          return;
        }
        resolve({
          path: source,
          runtime: runtime || path.extname(source).slice(1),
          returncode: 0,
          background: false,
          stdout: stdout.slice(-4000),
          stderr: stderr.slice(-4000),
        });
      });
    });
  }
}

function workspaceRoot(): string {
  return path.resolve(process.env.DEX_WORKSPACE ?? path.join(os.homedir(), 'Dex', 'workspace'));
}

function workspacePath(raw: string, root: string): string {
  const candidate = path.resolve(root, raw);
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('The path must stay inside the Dex workspace');
  }
  return candidate;
}

/**
 * The folder a search should be confined to.
 *
 * Read-only, so this is deliberately wider than the boundary on the write
 * operations. It used to refuse anything outside the user profile, which is
 * the same defect as defaulting to Downloads wearing a safety hat: a file on
 * another drive is still the owner's file, and "search my pc" that silently means
 * "search part of it" is how a search reports absence it never checked.
 *
 * What stays refused is the operating system's own trees. Not for safety —
 * they are readable anyway — but because walking them is minutes of work that
 * can only return things the owner did not put there.
 */
function searchRoot(raw: string): string {
  const home = os.homedir();
  const named = raw.trim().toLowerCase();
  if (named === 'profile' || named === 'pc' || named === '') return home;

  const aliases: Record<string, string[]> = {
    desktop: [path.join(home, 'Desktop'), path.join(home, 'OneDrive', 'Desktop')],
    documents: [path.join(home, 'Documents'), path.join(home, 'OneDrive', 'Documents')],
    downloads: [path.join(home, 'Downloads'), path.join(home, 'OneDrive', 'Downloads')],
    'download folder': [path.join(home, 'Downloads'), path.join(home, 'OneDrive', 'Downloads')],
    pictures: [path.join(home, 'Pictures'), path.join(home, 'OneDrive', 'Pictures')],
  };
  const candidates = aliases[named];
  const root = path.resolve(candidates?.find((candidate) => fs.existsSync(candidate)) ?? raw);

  const lowered = root.toLowerCase();
  const systemTrees = ['c:\\windows', 'c:\\program files', 'c:\\programdata'];
  if (systemTrees.some((tree) => lowered.startsWith(tree))) {
    throw new Error('File search does not walk the Windows and Program Files trees');
  }
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Search folder does not exist: ${root}`);
  }
  return root;
}

/**
 * What the index actually looked at, in a sentence.
 *
 * The names pass finishes long before the contents pass, and during that gap a
 * search really can only answer by filename. Saying so is the difference
 * between "no aadhaar card on this PC" and "no file *named* that yet" — the
 * first is a claim the index cannot support until the second pass is done.
 */
function describeIndex(stats: IndexStats): string {
  const parts = [`${stats.files.toLocaleString()} files indexed by name`];
  if (stats.with_text || stats.with_ocr) {
    parts.push(
      `${(stats.with_text + stats.with_ocr).toLocaleString()} read for content` +
        (stats.with_ocr ? `, ${stats.with_ocr.toLocaleString()} of them scans put through OCR` : ''),
    );
  }
  if (stats.pending) {
    parts.push(`${stats.pending.toLocaleString()} still to be read, so a match on contents alone may not be there yet`);
  }
  return parts.join('; ');
}

type FileEntry = { name: string; fullPath: string; directory: string };

function walkFiles(root: string, visit: (file: FileEntry) => void): void {
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile()) visit({ name: entry.name, fullPath, directory });
    }
  }
}

function queryTerms(query: string): string[] {
  const terms = query.toLowerCase().match(/[a-z0-9]+/g)?.filter(
    (token) => !SEARCH_STOPWORDS.has(token) && token.length >= 3,
  ) ?? [];
  return terms.length > 0 ? terms : query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function nameMatches(name: string, terms: string[]): boolean {
  const tokens = path.basename(name, path.extname(name)).toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return tokens.some((token) => terms.some((term) => closeWord(term, token)));
}

function closeWord(term: string, token: string): boolean {
  if (term.includes(token) || token.includes(term)) return true;
  let common = 0;
  while (common < term.length && common < token.length && term[common] === token[common]) common += 1;
  return common >= 4;
}

function openLocation(root: string, matches: Array<{ path: string }>): string {
  const target = matches.length === 1
    ? matches[0].path
    : matches.length > 1 ? commonDirectory(matches.map((match) => match.path)) : root;
  const argument = matches.length === 1 ? `/select,${target}` : target;
  if (process.platform !== 'win32') throw new Error('Opening a location is only supported on Windows');
  const child = spawn('explorer.exe', [argument], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  child.unref();
  return target;
}

function commonDirectory(files: string[]): string {
  let candidate = path.dirname(files[0]);
  for (const file of files.slice(1)) {
    const directory = path.dirname(file);
    while (candidate !== path.dirname(candidate)) {
      const relative = path.relative(candidate, directory);
      if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) break;
      candidate = path.dirname(candidate);
    }
  }
  return candidate;
}

function runtimeCommand(source: string, requested: string): string[] {
  const defaults: Record<string, string> = {
    '.py': 'python', '.pyw': 'python',
    '.js': 'node', '.mjs': 'node', '.cjs': 'node',
    '.rb': 'ruby', '.go': 'go',
  };
  const runtime = requested || defaults[path.extname(source).toLowerCase()];
  if (!runtime || !RUNTIMES.has(runtime)) {
    throw new Error('Choose an installed runtime: python, node, ruby, or go');
  }

  const resolved = resolveCommand(runtime, []);
  if (!resolved) throw new Error(`The ${runtime} runtime is not installed or is not on PATH`);
  const command = [resolved.file, ...resolved.args];
  return runtime === 'go'
    ? [...command, 'run', source]
    : [...command, source];
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function progressSentence(action: string): string {
  switch (action) {
    case 'find_files':
      return 'I am searching filenames directly, without opening a terminal or taking screenshots.';
    case 'write_file':
      return 'I am writing the requested file inside the Dex workspace.';
    case 'run_program':
      return 'I am starting the requested program as the signed-in user.';
    default:
      return 'I am carrying out the planner instruction.';
  }
}

/**
 * Where a write or a program run is allowed to land.
 *
 * A bare relative path stays in the Dex workspace, exactly as before — that is
 * the right default for generated code, and every existing plan and test
 * depends on it. An absolute path, a `~`, or a named folder resolves against
 * the user profile instead, because "write this to my Documents" is a
 * reasonable thing to ask and used to be impossible.
 *
 * Both routes end at a boundary check. The workspace one cannot escape the
 * workspace; the profile one cannot escape the profile, reach Windows, or read
 * Dex's own credential store.
 */
function resolveWritePath(raw: string, workspace: string): string {
  const looksAbsolute = path.isAbsolute(raw) || /^[a-z]:[\/]/i.test(raw);
  const looksNamed = raw.startsWith('~') || namedFolder(raw.split(/[\/]/)[0]) !== null;

  if (!looksAbsolute && !looksNamed) {
    return workspacePath(raw, workspace);
  }

  // A named folder as the first segment: "Documents/notes.txt".
  const segments = raw.split(/[\/]/);
  const base = namedFolder(segments[0]);
  if (base && segments.length > 1) {
    return profilePath(path.join(base, ...segments.slice(1)));
  }
  return profilePath(raw);
}
