/**
 * A document tab's surface (docs/unify/PLAN.md §3.9): a slim toolbar — where
 * the file is, zoom, its outline, tracked changes for Word, View source,
 * "Open in ▾" — over the file drawn by the hub itself, with the task's files
 * in a panel beside it. Each kind's viewer is its own lazy
 * chunk, so pdf.js or SheetJS only load when a tab of that kind is open.
 *
 * The bytes come from `sessions.readFile`, which only reads files this task
 * recorded or has open as a document. When the agent rewrites the file,
 * `revision` goes up and the tab reloads where you were reading.
 */
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileBadge } from '../../chat/fileKinds';
import { openFile } from '../../chat/FileCards';
import { safeHref, viewerFor, zoomable, type OutlineItem, type ViewerKind, type ViewerProps } from './kinds';
import { crumbs, type TaskFile } from './fileTree';
import { FilesRail } from './FilesRail';
import { OpenInMenu } from './OpenInMenu';
import './docs.css';

const VIEWERS: Partial<Record<ViewerKind, React.LazyExoticComponent<React.ComponentType<ViewerProps>>>> = {
  pdf: lazy(() => import('./PdfView')),
  docx: lazy(() => import('./DocxView')),
  sheet: lazy(() => import('./SheetView')),
  markdown: lazy(() => import('./TextView').then((m) => ({ default: m.MarkdownView }))),
  text: lazy(() => import('./TextView')),
  image: lazy(() => import('./MediaView').then((m) => ({ default: m.ImageView }))),
  video: lazy(() => import('./MediaView').then((m) => ({ default: m.VideoView }))),
  audio: lazy(() => import('./MediaView').then((m) => ({ default: m.AudioView }))),
  model: lazy(() => import('./ModelView')),
  html: lazy(() => import('./HtmlView')),
};

const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

export function nextZoom(zoom: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOMS.find((z) => z > zoom + 0.001) ?? ZOOMS[ZOOMS.length - 1];
  return [...ZOOMS].reverse().find((z) => z < zoom - 0.001) ?? ZOOMS[0];
}

interface Loaded {
  bytes: Uint8Array;
  /** Which doc + revision these bytes are. */
  key: string;
}

export interface DocumentViewProps {
  sessionId: string;
  doc: WorkspaceDoc;
  /** Bumped each time the file changed on disk. */
  revision: number;
  /** A web link in the document: open it in a workspace tab. */
  onOpenUrl: (url: string) => void;
  /** The task's files, for the Files panel beside the document. */
  files?: TaskFile[];
  /** A file picked in the Files panel: open (or bring forward) its tab. */
  onOpenFile?: (path: string) => void;
}

/** Kinds that have a source worth reading as text: "View source". */
const HAS_SOURCE = new Set<ViewerKind>(['markdown', 'html']);

/** The Files panel's open/closed choice, kept per viewer (a convenience only). */
function savedFilesOpen(): boolean | null {
  try {
    const v = window.localStorage.getItem('dex.docs.filesOpen');
    return v === null ? null : v === '1';
  } catch { return null; }
}

export function DocumentView({ sessionId, doc, revision, onOpenUrl, files = [], onOpenFile }: DocumentViewProps): React.ReactElement {
  const realKind = viewerFor(doc.name);
  const [source, setSource] = useState(false);
  // "View source" draws a Markdown or HTML file as the text it is.
  const kind: ViewerKind = source && HAS_SOURCE.has(realKind) ? 'text' : realKind;
  const Viewer = VIEWERS[kind];
  const [filesOpen, setFilesOpenState] = useState<boolean>(() => savedFilesOpen() ?? files.length > 1);
  const setFilesOpen = useCallback((open: boolean) => {
    setFilesOpenState(open);
    try { window.localStorage.setItem('dex.docs.filesOpen', open ? '1' : '0'); } catch { /* not kept */ }
  }, []);
  const showFiles = filesOpen && files.length > 0 && Boolean(onOpenFile);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [redlines, setRedlines] = useState(true);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Where you were reading, kept across a reload of the same document.
  const keepScroll = useRef<{ id: string; top: number; left: number } | null>(null);

  // A different document starts fresh; a new revision of the same one doesn't.
  useEffect(() => {
    setSource(false);
    setZoom(1);
    setOutline([]);
    setOutlineOpen(false);
    setLoaded(null);
    keepScroll.current = null;
  }, [doc.id]);

  useEffect(() => {
    const api = window.electronAPI?.sessions;
    if (!Viewer || !api?.readFile) return;
    let live = true;
    const el = scrollRef.current;
    if (el && loaded?.key.startsWith(`${doc.id}:`)) keepScroll.current = { id: doc.id, top: el.scrollTop, left: el.scrollLeft };
    setError(null);
    api.readFile(sessionId, doc.path)
      .then(({ bytes }) => {
        if (!live) return;
        // IPC hands back a Uint8Array (or a Buffer, which is one).
        setLoaded({ bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayLike<number>), key: `${doc.id}:${revision}` });
      })
      .catch((err: unknown) => { if (live) setError((err as Error)?.message || 'Couldn’t read this file.'); });
    return () => { live = false; };
    // `loaded` is read only to remember the scroll position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, doc.id, doc.path, revision, Viewer]);

  const onReady = useCallback(() => {
    const keep = keepScroll.current;
    const el = scrollRef.current;
    if (!keep || !el || keep.id !== doc.id) return;
    requestAnimationFrame(() => { el.scrollTop = keep.top; el.scrollLeft = keep.left; });
  }, [doc.id]);
  const onError = useCallback((message: string) => setError(message), []);

  // Every link click inside a document lands here first: web links open in a
  // workspace tab, `#…` scrolls within the document, anything else is ignored
  // (a document must never navigate the hub).
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest?.('a');
    if (!a || !scrollRef.current?.contains(a)) return;
    e.preventDefault();
    e.stopPropagation();
    const href = a.getAttribute('href');
    const how = safeHref(href);
    if (how === 'web') onOpenUrl(href!);
    else if (how === 'anchor' && href!.length > 1) {
      let id = href!.slice(1);
      try { id = decodeURIComponent(id); } catch { /* used as written */ }
      const target = Array.from(scrollRef.current.querySelectorAll<HTMLElement>('[id], a[name]'))
        .find((el) => el.id === id || el.getAttribute('name') === id);
      target?.scrollIntoView({ block: 'start' });
    }
  }, [onOpenUrl]);

  // Ctrl + wheel and Ctrl +/-/0 zoom the document, as in a browser.
  const canZoom = zoomable(kind);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !canZoom) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => nextZoom(z, e.deltaY < 0 ? 1 : -1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [canZoom]);
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!canZoom || !(e.ctrlKey || e.metaKey)) return;
    if (e.key === '=' || e.key === '+') { e.preventDefault(); setZoom((z) => nextZoom(z, 1)); }
    else if (e.key === '-') { e.preventDefault(); setZoom((z) => nextZoom(z, -1)); }
    else if (e.key === '0') { e.preventDefault(); setZoom(1); }
  }, [canZoom]);

  const bytes = loaded && loaded.key.startsWith(`${doc.id}:`) ? loaded.bytes : null;
  const viewerKey = loaded?.key ?? doc.id;
  const zoomLabel = `${Math.round(zoom * 100)}%`;
  const meta = useMemo(() => sizeLabel(doc.size), [doc.size]);

  return (
    <div className="dv" onKeyDown={onKeyDown}>
      <div className="dv-bar">
        {outline.length > 0 && (
          <button
            type="button"
            className={`dv-btn${outlineOpen ? ' dv-btn--on' : ''}`}
            aria-pressed={outlineOpen}
            aria-label="Outline"
            title="Outline"
            onClick={() => setOutlineOpen((v) => !v)}
          >
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M3 4h10M5.5 8H13M5.5 12H13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          </button>
        )}
        <FileBadge name={doc.name} size="sm" />
        {/* Where the file is: its last folders, then its name. Click to show it in Explorer. */}
        <button type="button" className="dv-crumbs" title={`${doc.path}
Show in File Explorer`} onClick={() => void openFile(sessionId, doc.path, 'reveal')}>
          {crumbs(doc.path).map((c, i, all) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="dv-crumbs__sep" aria-hidden="true">›</span>}
              <span className={i === all.length - 1 ? 'dv-crumbs__name' : 'dv-crumbs__dir'}>{c}</span>
            </React.Fragment>
          ))}
        </button>
        <span className="dv-bar__meta">{meta}{doc.openedBy === 'agent' ? ' · opened by DEX' : ''}</span>
        <span className="dv-bar__fill" />
        {HAS_SOURCE.has(realKind) && (
          <button
            type="button"
            className={`dv-chip${source ? ' dv-chip--on' : ''}`}
            aria-pressed={source}
            title={source ? 'Show it rendered' : 'Show the file as text'}
            onClick={() => setSource((v) => !v)}
          >
            View source
          </button>
        )}
        {kind === 'docx' && (
          <button
            type="button"
            className={`dv-chip${redlines ? ' dv-chip--on' : ''}`}
            aria-pressed={redlines}
            title="Show tracked changes (insertions and deletions)"
            onClick={() => setRedlines((v) => !v)}
          >
            Changes
          </button>
        )}
        {canZoom && (
          <div className="dv-zoom" role="group" aria-label="Zoom">
            <button type="button" className="dv-btn" aria-label="Zoom out (Ctrl+-)" title="Zoom out" disabled={zoom <= ZOOMS[0]} onClick={() => setZoom((z) => nextZoom(z, -1))}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 8h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </button>
            <button type="button" className="dv-zoom__label" title="Reset zoom (Ctrl+0)" onClick={() => setZoom(1)}>{zoomLabel}</button>
            <button type="button" className="dv-btn" aria-label="Zoom in (Ctrl++)" title="Zoom in" disabled={zoom >= ZOOMS[ZOOMS.length - 1]} onClick={() => setZoom((z) => nextZoom(z, 1))}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 8h8M8 4v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </button>
          </div>
        )}
        <OpenInMenu sessionId={sessionId} path={doc.path} name={doc.name} />
        {files.length > 0 && onOpenFile && (
          <button
            type="button"
            className={`dv-btn${showFiles ? ' dv-btn--on' : ''}`}
            aria-pressed={showFiles}
            aria-label="Task files"
            title="Task files"
            onClick={() => setFilesOpen(!showFiles)}
          >
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M2 4.2c0-.6.5-1 1-1h3l1.4 1.5H13c.6 0 1 .4 1 1v6.1c0 .6-.4 1-1 1H3c-.5 0-1-.4-1-1z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" /></svg>
          </button>
        )}
      </div>

      <div className="dv-body">
        {outlineOpen && outline.length > 0 && (
          <nav className="dv-outline" aria-label="Outline">
            {outline.map((item, i) => (
              <button
                key={i}
                type="button"
                className="dv-outline__item"
                style={{ paddingLeft: 10 + (item.level - 1) * 12 }}
                title={item.label}
                onClick={() => item.el.scrollIntoView({ block: 'start' })}
              >
                {item.label}
              </button>
            ))}
          </nav>
        )}
        <div className={`dv-scroll dv-scroll--${kind}`} ref={scrollRef} tabIndex={0} onClickCapture={onClickCapture}>
          {error ? (
            <Fallback sessionId={sessionId} doc={doc} message={error} />
          ) : !Viewer ? (
            <Fallback sessionId={sessionId} doc={doc} message="DEX can’t draw this kind of file here." />
          ) : !bytes ? (
            <div className="dv-loading" role="status"><span className="ws-spinner" /> Opening {doc.name}…</div>
          ) : (
            <Suspense fallback={<div className="dv-loading" role="status"><span className="ws-spinner" /> Opening {doc.name}…</div>}>
              <Viewer
                key={viewerKey}
                bytes={bytes}
                name={doc.name}
                zoom={zoom}
                redlines={redlines}
                onReady={onReady}
                onOutline={setOutline}
                onError={onError}
              />
            </Suspense>
          )}
        </div>
        {showFiles && <FilesRail files={files} activePath={doc.path} onOpen={(p) => onOpenFile?.(p)} />}
      </div>
    </div>
  );
}

function Fallback({ sessionId, doc, message }: { sessionId: string; doc: WorkspaceDoc; message: string }): React.ReactElement {
  return (
    <div className="dv-fallback">
      <FileBadge name={doc.name} />
      <div className="dv-fallback__name">{doc.name}</div>
      <div className="dv-fallback__msg">{message}</div>
      <div className="dv-fallback__actions">
        <button type="button" className="dv-chip dv-chip--on" onClick={() => void openFile(sessionId, doc.path, 'open')}>Open in app</button>
        <button type="button" className="dv-chip" onClick={() => void openFile(sessionId, doc.path, 'reveal')}>Show in folder</button>
      </div>
    </div>
  );
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export default DocumentView;
