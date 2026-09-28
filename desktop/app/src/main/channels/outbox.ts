/**
 * What `dex-send` can hand over, turned into files ready to send:
 * files on disk (checked), a screenshot of the session's browser view, the
 * whole screen, or the session's canvas document rendered to PDF.
 *
 * Generated files go to <userData>/outbox/ and are cleared after a day.
 */
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, desktopCapturer, screen, type WebContents } from 'electron';
import { mainLogger } from '../logger';

export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
const OUTBOX_TTL_MS = 24 * 60 * 60 * 1000;

export interface OutgoingFile {
  path: string;
  /** Name shown in WhatsApp; defaults to the file's own. */
  fileName?: string;
}

function outboxDir(): string {
  return path.join(app.getPath('userData'), 'outbox');
}

async function outboxFile(name: string): Promise<string> {
  const dir = outboxDir();
  await fsPromises.mkdir(dir, { recursive: true });
  // Opportunistic cleanup: nothing in here is needed once it's been sent.
  try {
    const now = Date.now();
    for (const entry of await fsPromises.readdir(dir)) {
      const p = path.join(dir, entry);
      const st = await fsPromises.stat(p).catch(() => null);
      if (st && now - st.mtimeMs > OUTBOX_TTL_MS) await fsPromises.rm(p, { force: true });
    }
  } catch { /* best-effort */ }
  return path.join(dir, name);
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
}

/**
 * Agents run in Git Bash and hand us `/c/Users/…` as often as `C:\Users\…`.
 */
export function normalizeAgentPath(p: string): string {
  const trimmed = p.trim().replace(/^["']|["']$/g, '');
  if (process.platform === 'win32') {
    const msys = /^\/([a-zA-Z])(?:\/(.*))?$/.exec(trimmed);
    if (msys) return path.win32.normalize(`${msys[1].toUpperCase()}:\\${msys[2] ?? ''}`);
  }
  return path.normalize(trimmed);
}

/** Check a file the agent named: it must exist, be a file, and fit. */
export async function checkFile(p: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const resolved = normalizeAgentPath(p);
  if (!path.isAbsolute(resolved)) return { ok: false, error: `not an absolute path: ${p}` };
  let st: fs.Stats;
  try {
    st = await fsPromises.stat(resolved);
  } catch {
    return { ok: false, error: `no such file: ${resolved}` };
  }
  if (!st.isFile()) return { ok: false, error: `not a file (send files, not folders): ${resolved}` };
  if (st.size === 0) return { ok: false, error: `file is empty: ${resolved}` };
  if (st.size > MAX_FILE_BYTES) return { ok: false, error: `too large for WhatsApp here (${Math.round(st.size / 1e6)} MB, max 64 MB): ${resolved}` };
  return { ok: true, path: resolved };
}

/** A PNG of what the session's browser view is showing right now. */
export async function capturePage(webContents: WebContents): Promise<OutgoingFile> {
  const image = await webContents.capturePage();
  if (image.isEmpty()) throw new Error('the browser view is empty — open the page first');
  let title = '';
  try { title = webContents.getTitle(); } catch { /* ignore */ }
  const safe = (title || 'Page').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'Page';
  const file = await outboxFile(`${safe} ${stamp()}.png`);
  await fsPromises.writeFile(file, image.toPNG());
  return { path: file };
}

/** A PNG of the whole primary display, at its real resolution. */
export async function captureScreen(): Promise<OutgoingFile> {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.size;
  const scale = display.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
  });
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  if (!source || source.thumbnail.isEmpty()) throw new Error('could not capture the screen');
  const file = await outboxFile(`Screen ${stamp()}.png`);
  await fsPromises.writeFile(file, source.thumbnail.toPNG());
  return { path: file };
}

const PDF_CSS = `
  @page { margin: 18mm 16mm; }
  body { font: 11pt/1.55 "Segoe UI", system-ui, -apple-system, sans-serif; color: #1a1a1a; }
  h1 { font-size: 20pt; margin: 0 0 12pt; }
  h2 { font-size: 14pt; margin: 18pt 0 6pt; }
  h3 { font-size: 12pt; margin: 14pt 0 4pt; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 10pt; }
  th, td { border: 1px solid #d0d0d0; padding: 5pt 7pt; text-align: left; vertical-align: top; }
  th { background: #f3f3f3; }
  code { font-family: Consolas, monospace; background: #f3f3f3; padding: 0 3pt; border-radius: 3pt; }
  pre { background: #f6f6f6; padding: 8pt; border-radius: 4pt; white-space: pre-wrap; }
  blockquote { border-left: 3pt solid #ccc; margin: 0; padding-left: 10pt; color: #555; }
  a { color: #0b57d0; }
  .dex-footer { margin-top: 24pt; font-size: 8pt; color: #888; }
`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** The canvas document as a PDF, laid out for reading on a phone or print. */
export async function renderCanvasPdf(title: string, markdown: string): Promise<OutgoingFile> {
  const [{ createElement }, { renderToStaticMarkup }, { default: Markdown }, { default: remarkGfm }] = await Promise.all([
    import('react'),
    import('react-dom/server'),
    import('react-markdown'),
    import('remark-gfm'),
  ]);
  const bodyHtml = renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm] }, markdown));
  const startsWithHeading = /^\s*#\s/.test(markdown);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PDF_CSS}</style></head><body>${
    startsWithHeading ? '' : `<h1>${escapeHtml(title)}</h1>`
  }${bodyHtml}<div class="dex-footer">Made by DEX · ${escapeHtml(new Date().toLocaleString())}</div></body></html>`;

  const win = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false, sandbox: true, offscreen: true },
  });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    const safe = title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Document';
    const file = await outboxFile(`${safe}.pdf`);
    await fsPromises.writeFile(file, pdf);
    return { path: file };
  } finally {
    win.destroy();
  }
}

export function logOutboxError(kind: string, err: unknown): string {
  const message = (err as Error)?.message ?? String(err);
  mainLogger.warn('outbox.failed', { kind, error: message });
  return message;
}
