/**
 * The Files panel beside a document: the task's files as a tree with a
 * filter box. Clicking one opens it as a document tab (or brings its tab to
 * the front). The open document is highlighted.
 */
import React, { useMemo, useState } from 'react';
import { FileBadge } from '../../chat/fileKinds';
import { buildTree, filterTree, type TaskFile, type TreeFolder } from './fileTree';

interface FilesRailProps {
  files: TaskFile[];
  /** The document in front, highlighted in the tree. */
  activePath: string;
  onOpen: (path: string) => void;
}

const same = (a: string, b: string): boolean => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();

export function FilesRail({ files, activePath, onOpen }: FilesRailProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const tree = useMemo(() => buildTree(files), [files]);
  const shown = useMemo(() => filterTree(tree, query), [tree, query]);
  return (
    <aside className="dv-files" aria-label="Task files">
      <input
        className="dv-files__filter"
        type="search"
        placeholder="Filter files…"
        aria-label="Filter files"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="dv-files__tree" role="tree">
        {shown.children.length === 0 ? (
          <div className="dv-files__empty">{query ? 'No file matches.' : 'This task hasn’t made any files yet.'}</div>
        ) : (
          <Folder folder={shown} depth={0} activePath={activePath} onOpen={onOpen} forceOpen={Boolean(query)} root />
        )}
      </div>
    </aside>
  );
}

function Folder({ folder, depth, activePath, onOpen, forceOpen, root = false }: {
  folder: TreeFolder;
  depth: number;
  activePath: string;
  onOpen: (path: string) => void;
  forceOpen: boolean;
  root?: boolean;
}): React.ReactElement {
  const [open, setOpen] = useState(true);
  const expanded = forceOpen || open;
  const children = (
    <div role="group">
      {folder.children.map((c) => c.kind === 'folder' ? (
        <Folder key={c.path} folder={c} depth={root ? depth : depth + 1} activePath={activePath} onOpen={onOpen} forceOpen={forceOpen} />
      ) : (
        <button
          key={c.path}
          type="button"
          role="treeitem"
          aria-selected={same(c.path, activePath)}
          className={`dv-files__item${same(c.path, activePath) ? ' dv-files__item--on' : ''}`}
          style={{ paddingLeft: 8 + (root ? depth : depth + 1) * 14 }}
          title={c.path}
          onClick={() => onOpen(c.path)}
        >
          <FileBadge name={c.name} size="sm" />
          <span className="dv-files__name">{c.name}</span>
        </button>
      ))}
    </div>
  );
  if (root) return children;
  return (
    <div role="treeitem" aria-expanded={expanded}>
      <button
        type="button"
        className="dv-files__folder"
        style={{ paddingLeft: 8 + depth * 14 }}
        title={folder.path}
        onClick={() => setOpen((v) => !v)}
      >
        <svg className={`dv-files__chev${expanded ? ' dv-files__chev--open' : ''}`} viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d="M4.5 3 7.5 6 4.5 9" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="dv-files__name">{folder.name}</span>
      </button>
      {expanded && children}
    </div>
  );
}
