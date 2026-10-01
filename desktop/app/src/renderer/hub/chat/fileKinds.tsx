/**
 * What a file is, in words and at a glance: "Word", "Document · PDF",
 * "Image · PNG", with a coloured badge like the ones Codex puts on its file
 * cards (docs/unify/PLAN.md §3.12).
 */
import React from 'react';

export interface FileKind {
  /** What the card says under the name. */
  label: string;
  /** The badge's glyph. */
  glyph: 'doc' | 'pdf' | 'sheet' | 'slides' | 'image' | 'video' | 'audio' | 'archive' | 'code' | 'web' | 'model' | 'text' | 'file';
  /** CSS colour of the glyph. */
  tone: string;
}

const EXT: Record<string, FileKind> = {
  doc: { label: 'Word', glyph: 'doc', tone: '#4c8dff' },
  docx: { label: 'Word', glyph: 'doc', tone: '#4c8dff' },
  odt: { label: 'Document', glyph: 'doc', tone: '#4c8dff' },
  rtf: { label: 'Document', glyph: 'doc', tone: '#4c8dff' },
  pdf: { label: 'Document · PDF', glyph: 'pdf', tone: '#f0524f' },
  xls: { label: 'Excel', glyph: 'sheet', tone: '#2fb36b' },
  xlsx: { label: 'Excel', glyph: 'sheet', tone: '#2fb36b' },
  csv: { label: 'Spreadsheet · CSV', glyph: 'sheet', tone: '#2fb36b' },
  ppt: { label: 'PowerPoint', glyph: 'slides', tone: '#f27a3a' },
  pptx: { label: 'PowerPoint', glyph: 'slides', tone: '#f27a3a' },
  md: { label: 'Markdown', glyph: 'text', tone: '#a0a7b4' },
  txt: { label: 'Text', glyph: 'text', tone: '#a0a7b4' },
  log: { label: 'Log', glyph: 'text', tone: '#a0a7b4' },
  html: { label: 'Web page', glyph: 'web', tone: '#35b8ff' },
  htm: { label: 'Web page', glyph: 'web', tone: '#35b8ff' },
  zip: { label: 'Archive · ZIP', glyph: 'archive', tone: '#c9a24a' },
  '7z': { label: 'Archive · 7Z', glyph: 'archive', tone: '#c9a24a' },
  rar: { label: 'Archive · RAR', glyph: 'archive', tone: '#c9a24a' },
  gz: { label: 'Archive', glyph: 'archive', tone: '#c9a24a' },
  glb: { label: '3D model · GLB', glyph: 'model', tone: '#b98cff' },
  gltf: { label: '3D model · glTF', glyph: 'model', tone: '#b98cff' },
  obj: { label: '3D model · OBJ', glyph: 'model', tone: '#b98cff' },
  fbx: { label: '3D model · FBX', glyph: 'model', tone: '#b98cff' },
  blend: { label: 'Blender scene', glyph: 'model', tone: '#f5a25a' },
};

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff', 'ico', 'heic']);
const VIDEO = new Set(['mp4', 'mov', 'mkv', 'webm', 'avi']);
const AUDIO = new Set(['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg']);
const CODE = new Set(['js', 'ts', 'tsx', 'jsx', 'py', 'java', 'kt', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'ps1', 'json', 'yaml', 'yml', 'toml', 'xml', 'sql', 'ipynb', 'css', 'dart', 'swift']);

export function extOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function fileKind(name: string, mime?: string): FileKind {
  const ext = extOf(name);
  if (EXT[ext]) return EXT[ext];
  const up = ext.toUpperCase();
  if (IMAGE.has(ext) || mime?.startsWith('image/')) return { label: up ? `Image · ${up}` : 'Image', glyph: 'image', tone: '#e46bd0' };
  if (VIDEO.has(ext) || mime?.startsWith('video/')) return { label: up ? `Video · ${up}` : 'Video', glyph: 'video', tone: '#ff7a7a' };
  if (AUDIO.has(ext) || mime?.startsWith('audio/')) return { label: up ? `Audio · ${up}` : 'Audio', glyph: 'audio', tone: '#ffb454' };
  if (CODE.has(ext)) return { label: `Code · ${up}`, glyph: 'code', tone: '#7fd1a8' };
  return { label: up ? `${up} file` : 'File', glyph: 'file', tone: '#a0a7b4' };
}

const PAGE = 'M6 2.5h7.5L18 7v13.2a1.3 1.3 0 0 1-1.3 1.3H6a1.3 1.3 0 0 1-1.3-1.3V3.8A1.3 1.3 0 0 1 6 2.5Z';
const FOLD = 'M13.5 2.5V7H18';

const INNER: Record<FileKind['glyph'], React.ReactNode> = {
  doc: <path d="M8 11h8M8 14h8M8 17h5" />,
  pdf: <path d="M7.8 17.5c2-3.4 3.3-6.4 3.3-8 0-1.4-1.6-1.4-1.6 0 0 2.7 4.6 6.8 6.8 6.8 1.3 0 1.3-1.5 0-1.5-2 0-6 1.3-8.5 2.7Z" />,
  sheet: <path d="M7.5 10.5h9v8h-9zM7.5 14.5h9M11.5 10.5v8" />,
  slides: <path d="M7.5 10.5h9v6h-9zM12 16.5v2M10 18.5h4" />,
  image: <path d="M7.5 18l3-3.5 2.2 2.4 1.6-1.7 2.2 2.8M10 11.3a.9.9 0 1 0 0 .1" />,
  video: <path d="M10 11v6l5-3-5-3Z" />,
  audio: <path d="M10.3 17.4V11l5-1v5.6M10.3 17.4a1.4 1.4 0 1 1-1.4-1.4 1.4 1.4 0 0 1 1.4 1.4ZM15.3 15.6a1.4 1.4 0 1 1-1.4-1.4 1.4 1.4 0 0 1 1.4 1.4Z" />,
  archive: <path d="M11 3v2M13 5v2M11 7v2M13 9v2M11 11v2M10.5 14.5h3v3h-3z" />,
  code: <path d="M10 12l-2.3 2.3L10 16.6M14 12l2.3 2.3L14 16.6" />,
  web: <path d="M12 10.2a4.3 4.3 0 1 0 0 8.6 4.3 4.3 0 0 0 0-8.6ZM7.7 14.5h8.6M12 10.2c1.1 1.2 1.7 2.7 1.7 4.3s-.6 3.1-1.7 4.3M12 10.2c-1.1 1.2-1.7 2.7-1.7 4.3s.6 3.1 1.7 4.3" />,
  model: <path d="M12 10l4 2.2v4.6L12 19l-4-2.2v-4.6L12 10Zm0 0v4.4m0 0 4-2.2m-4 2.2-4-2.2" />,
  text: <path d="M8 11h8M8 14h8M8 17h6" />,
  file: null,
};

/** The file's badge: a page with a coloured glyph, in a rounded tile. */
export function FileBadge({ name, mime, size = 'md' }: { name: string; mime?: string; size?: 'sm' | 'md' }): React.ReactElement {
  const kind = fileKind(name, mime);
  const px = size === 'sm' ? 16 : 22;
  return (
    <span className={`cx-badge cx-badge--${size}`} style={{ color: kind.tone }} aria-hidden="true">
      <svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d={PAGE} />
        <path d={FOLD} />
        {INNER[kind.glyph]}
      </svg>
    </span>
  );
}
