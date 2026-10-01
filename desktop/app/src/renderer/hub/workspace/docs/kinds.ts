/**
 * Which viewer draws a document tab (docs/unify/PLAN.md §3.9).
 */
export type ViewerKind = 'pdf' | 'docx' | 'sheet' | 'markdown' | 'text' | 'image' | 'video' | 'audio' | 'model' | 'html' | 'none';

const BY_EXT: Record<string, ViewerKind> = {
  pdf: 'pdf',
  docx: 'docx',
  xlsx: 'sheet', xlsm: 'sheet', xls: 'sheet', ods: 'sheet', csv: 'sheet', tsv: 'sheet',
  md: 'markdown', markdown: 'markdown',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', svg: 'image', ico: 'image', avif: 'image',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', mkv: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio', aac: 'audio',
  glb: 'model', gltf: 'model',
  html: 'html', htm: 'html',
};

const TEXT = new Set([
  'txt', 'log', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'xml', 'env',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php',
  'sh', 'bash', 'ps1', 'bat', 'cmd', 'sql', 'css', 'scss', 'dart', 'swift', 'lua', 'r', 'ipynb', 'gitignore', 'dockerfile',
]);

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json',
};

export function extOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : base.toLowerCase();
}

export function viewerFor(name: string): ViewerKind {
  const ext = extOf(name);
  return BY_EXT[ext] ?? (TEXT.has(ext) ? 'text' : 'none');
}

export function mimeFor(name: string): string {
  return MIME[extOf(name)] ?? 'application/octet-stream';
}

/** Zoom makes sense for pages, pictures and grids — not for media players. */
export function zoomable(kind: ViewerKind): boolean {
  return kind === 'pdf' || kind === 'docx' || kind === 'sheet' || kind === 'image' || kind === 'text' || kind === 'markdown';
}

/** Only web and mail links leave a document; `#…` jumps inside it. */
export function safeHref(href: string | null): 'web' | 'anchor' | null {
  if (!href) return null;
  if (href.startsWith('#')) return 'anchor';
  return /^(https?:|mailto:)/i.test(href) ? 'web' : null;
}

/** A heading to jump to, from a document's structure. */
export interface OutlineItem {
  label: string;
  level: number;
  el: HTMLElement;
}

/** What every viewer is handed. It draws into the document's scroll area. */
export interface ViewerProps {
  bytes: Uint8Array;
  name: string;
  zoom: number;
  /** Tracked changes shown (Word). */
  redlines?: boolean;
  onReady?: () => void;
  onOutline?: (items: OutlineItem[]) => void;
  onError?: (message: string) => void;
}
