/**
 * Review (docs/unify/PLAN.md §3.6): what a task changed, from its own events.
 *
 * - Files it edited or wrote: Claude Code's Edit / MultiEdit / Write calls
 *   carry the exact text, so each becomes a line diff; Codex's file changes
 *   carry only the paths and whether a file was added, changed or deleted.
 * - Files it made (`file_output`), which the chat also lists.
 * - Only calls that succeeded count (their `tool_result` was ok).
 */

export type DiffLine = { type: ' ' | '-' | '+'; text: string } | { type: 'gap'; count: number };

export interface ReviewEdit {
  kind: 'edit' | 'write' | 'add' | 'update' | 'delete';
  at?: number;
  /** edit: the text replaced and its replacement; write: the whole new text. */
  before?: string;
  after?: string;
}

export interface ReviewFile {
  path: string;
  name: string;
  edits: ReviewEdit[];
  /** A file the task handed over as its output (file_output). */
  made: boolean;
}

type Raw = { type?: string } & Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const nameOf = (p: string): string => p.split(/[\\/]/).pop() || p;

function fileEntry(files: Map<string, ReviewFile>, path: string): ReviewFile {
  const key = path.replace(/\\/g, '/').toLowerCase();
  let f = files.get(key);
  if (!f) {
    f = { path, name: nameOf(path), edits: [], made: false };
    files.set(key, f);
  }
  return f;
}

/** The edits one tool call made, or null if it isn't a file change. */
function editsOf(name: string, args: Record<string, unknown>): Array<{ path: string; edit: ReviewEdit }> | null {
  const filePath = str(args.file_path) || str(args.path) || str(args.notebook_path);
  switch (name) {
    case 'Edit':
      if (Array.isArray(args.changes)) {
        // Codex: {changes: [{path, kind}]} — the paths, not the text.
        return (args.changes as Array<Record<string, unknown>>)
          .filter((c) => str(c.path))
          .map((c) => {
            const kind = str(c.kind);
            return { path: str(c.path), edit: { kind: kind === 'add' || kind === 'delete' ? kind : 'update' } as ReviewEdit };
          });
      }
      if (!filePath) return null;
      if (typeof args.old_string === 'string' || typeof args.new_string === 'string') {
        return [{ path: filePath, edit: { kind: 'edit', before: str(args.old_string), after: str(args.new_string) } }];
      }
      return [{ path: filePath, edit: { kind: 'update' } }];
    case 'MultiEdit':
      if (!filePath || !Array.isArray(args.edits)) return null;
      return (args.edits as Array<Record<string, unknown>>).map((e) => ({
        path: filePath,
        edit: { kind: 'edit', before: str(e.old_string), after: str(e.new_string) } as ReviewEdit,
      }));
    case 'Write':
      if (!filePath) return null;
      return [{ path: filePath, edit: { kind: 'write', after: str(args.content) } }];
    case 'NotebookEdit':
      if (!filePath) return null;
      return [{ path: filePath, edit: { kind: 'edit', before: '', after: str(args.new_source) } }];
    default:
      return null;
  }
}

/** Every file the task changed or made, the most recently touched first. */
export function collectReview(output: ReadonlyArray<Raw>): ReviewFile[] {
  const files = new Map<string, ReviewFile>();
  const order: string[] = [];
  const touch = (f: ReviewFile): void => {
    const key = f.path.replace(/\\/g, '/').toLowerCase();
    const i = order.indexOf(key);
    if (i >= 0) order.splice(i, 1);
    order.push(key);
  };
  // Calls waiting for their result, by tool name (results come back in order).
  const waiting = new Map<string, Array<Array<{ path: string; edit: ReviewEdit }>>>();

  for (const e of output) {
    if (e.type === 'tool_call') {
      const name = str(e.name);
      const args = e.args && typeof e.args === 'object' ? (e.args as Record<string, unknown>) : {};
      const edits = editsOf(name, args);
      if (!edits) continue;
      const at = typeof e.at === 'number' ? e.at : undefined;
      const queue = waiting.get(name) ?? [];
      queue.push(edits.map((x) => ({ ...x, edit: { ...x.edit, at } })));
      waiting.set(name, queue);
    } else if (e.type === 'tool_result') {
      const queue = waiting.get(str(e.name));
      const edits = queue?.shift();
      if (!edits || e.ok === false) continue;
      for (const { path, edit } of edits) {
        const f = fileEntry(files, path);
        f.edits.push(edit);
        touch(f);
      }
    } else if (e.type === 'file_output') {
      const path = str(e.path);
      if (!path) continue;
      const f = fileEntry(files, path);
      f.made = true;
      if (str(e.name)) f.name = str(e.name);
      touch(f);
    }
  }
  return order.reverse().map((k) => files.get(k)!).filter(Boolean);
}

/** How many lines a run of unchanged ones keeps on each side of a change. */
const CONTEXT = 3;
/** Past this many lines on a side, the diff is shown as removed + added. */
const MAX_DIFF_LINES = 600;

/**
 * A line diff of `before` → `after`: common lines, removed and added, with
 * long unchanged runs folded to a `gap`. LCS over what's left once the
 * common start and end are set aside, which is all of a typical Edit.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.replace(/\r\n/g, '\n').split('\n');
  const b = after === '' ? [] : after.replace(/\r\n/g, '\n').split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const out: Array<{ type: ' ' | '-' | '+'; text: string }> = [];
  for (let i = 0; i < start; i++) out.push({ type: ' ', text: a[i] });

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length > MAX_DIFF_LINES || midB.length > MAX_DIFF_LINES || midA.length * midB.length > 250_000) {
    for (const t of midA) out.push({ type: '-', text: t });
    for (const t of midB) out.push({ type: '+', text: t });
  } else {
    // lcs[i][j]: the longest common run of midA[i..] and midB[j..].
    const n = midA.length;
    const m = midB.length;
    const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) { out.push({ type: ' ', text: midA[i] }); i++; j++; }
      // Removed before added, as diffs read.
      else if (i < n && (j >= m || lcs[i + 1][j] >= lcs[i][j + 1])) { out.push({ type: '-', text: midA[i] }); i++; }
      else { out.push({ type: '+', text: midB[j] }); j++; }
    }
  }
  for (let i = endA; i < a.length; i++) out.push({ type: ' ', text: a[i] });

  // Fold unchanged runs longer than the context around them.
  const folded: DiffLine[] = [];
  let k = 0;
  while (k < out.length) {
    if (out[k].type !== ' ') { folded.push(out[k]); k++; continue; }
    let end = k;
    while (end < out.length && out[end].type === ' ') end++;
    const run = out.slice(k, end);
    const leading = k === 0;
    const trailing = end === out.length;
    const keepHead = leading ? 0 : CONTEXT;
    const keepTail = trailing ? 0 : CONTEXT;
    if (run.length > keepHead + keepTail + 1) {
      folded.push(...run.slice(0, keepHead));
      folded.push({ type: 'gap', count: run.length - keepHead - keepTail });
      folded.push(...run.slice(run.length - keepTail));
    } else {
      folded.push(...run);
    }
    k = end;
  }
  return folded;
}

/** Lines added and removed across a file's edits (a write counts as all added). */
export function changeCounts(file: ReviewFile): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const e of file.edits) {
    if (e.kind === 'edit') {
      for (const l of diffLines(e.before ?? '', e.after ?? '')) {
        if (l.type === '+') added++;
        else if (l.type === '-') removed++;
      }
    } else if (e.kind === 'write' && e.after) {
      added += e.after.split('\n').length;
    }
  }
  return { added, removed };
}
