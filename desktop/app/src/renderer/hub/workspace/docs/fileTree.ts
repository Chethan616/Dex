/**
 * The task's files as a tree, for the Files panel beside a document (the
 * way Codex shows a project's files next to the one you're reading). Only
 * files the task made or opened are listed: the hub may only read those
 * (sessions:read-file's rule), so a tree of arbitrary folders would be a
 * list of things you can't open.
 */

export interface TaskFile {
  name: string;
  path: string;
  size?: number;
}

export interface TreeFolder {
  kind: 'folder';
  name: string;
  /** Full path of the folder, for keys and titles. */
  path: string;
  children: TreeNode[];
}

export interface TreeLeaf {
  kind: 'file';
  name: string;
  path: string;
  size?: number;
}

export type TreeNode = TreeFolder | TreeLeaf;

const norm = (p: string): string => p.replace(/\\/g, '/');
const key = (p: string): string => norm(p).toLowerCase();

/** Files from the task's output events and its open documents, once each (newest wins). */
export function taskFiles(output: ReadonlyArray<unknown>, docs: ReadonlyArray<{ name: string; path: string; size: number }>): TaskFile[] {
  const byPath = new Map<string, TaskFile>();
  for (const e of output) {
    const ev = e as { type?: string; name?: unknown; path?: unknown; size?: unknown };
    if (ev?.type !== 'file_output' || typeof ev.path !== 'string') continue;
    const name = typeof ev.name === 'string' && ev.name ? ev.name : norm(ev.path).split('/').pop() ?? ev.path;
    byPath.set(key(ev.path), { name, path: ev.path, size: typeof ev.size === 'number' ? ev.size : undefined });
  }
  for (const d of docs) if (!byPath.has(key(d.path))) byPath.set(key(d.path), { name: d.name, path: d.path, size: d.size });
  return [...byPath.values()];
}

/**
 * A tree rooted at the folder all the files share, so a task that wrote
 * into Downloads and outputs/<id> shows those two folders, not "C:" and
 * "Users" first. Folders before files, each by name.
 */
export function buildTree(files: ReadonlyArray<TaskFile>): TreeFolder {
  const split = files.map((f) => ({ f, parts: norm(f.path).split('/').filter(Boolean) }));
  // The shared folder prefix (never the file names themselves).
  let common = split.length ? split[0].parts.slice(0, -1) : [];
  for (const { parts } of split.slice(1)) {
    const dirs = parts.slice(0, -1);
    let i = 0;
    while (i < common.length && i < dirs.length && common[i].toLowerCase() === dirs[i].toLowerCase()) i += 1;
    common = common.slice(0, i);
  }
  const root: TreeFolder = { kind: 'folder', name: common[common.length - 1] ?? '', path: common.join('/'), children: [] };
  for (const { f, parts } of split) {
    let folder = root;
    const dirs = parts.slice(common.length, -1);
    let at = common.join('/');
    for (const d of dirs) {
      at = at ? `${at}/${d}` : d;
      let next = folder.children.find((c): c is TreeFolder => c.kind === 'folder' && c.name.toLowerCase() === d.toLowerCase());
      if (!next) {
        next = { kind: 'folder', name: d, path: at, children: [] };
        folder.children.push(next);
      }
      folder = next;
    }
    folder.children.push({ kind: 'file', name: f.name, path: f.path, size: f.size });
  }
  sortTree(root);
  return root;
}

function sortTree(folder: TreeFolder): void {
  folder.children.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === 'folder' ? -1 : 1));
  for (const c of folder.children) if (c.kind === 'folder') sortTree(c);
}

/** The tree with only files whose name matches `query` (and the folders that hold them). */
export function filterTree(folder: TreeFolder, query: string): TreeFolder {
  const q = query.trim().toLowerCase();
  if (!q) return folder;
  const children: TreeNode[] = [];
  for (const c of folder.children) {
    if (c.kind === 'file') {
      if (c.name.toLowerCase().includes(q)) children.push(c);
    } else {
      const sub = filterTree(c, q);
      if (sub.children.length) children.push(sub);
    }
  }
  return { ...folder, children };
}

/**
 * A path as breadcrumbs: its last few folders and the file, with "…" when
 * the front is cut ("… › Downloads › reports › Q3.pdf").
 */
export function crumbs(path: string, keep = 3): string[] {
  const parts = norm(path).split('/').filter(Boolean);
  if (parts.length <= keep + 1) return parts;
  return ['…', ...parts.slice(-(keep + 1))];
}
