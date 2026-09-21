/**
 * Content extraction for the file index.
 *
 * Every extension not handled here still gets indexed by name in db.ts — this
 * module only decides which files additionally contribute searchable body
 * text, and never lets one bad file take the indexer down: every path here
 * returns a `ContentState` rather than throwing.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { mainLogger } from '../logger';
import type { ContentState } from './db';

const require = createRequire(import.meta.url);

const MAX_TEXT_BYTES = 5 * 1024 * 1024; // direct-read text/code files
const MAX_DOC_BYTES = 30 * 1024 * 1024; // pdf / office documents
// Per-file cap on what actually gets indexed. 200k chars/file was the
// original value and is far more than search relevance needs — it mostly
// bloats the FTS5 index (a real run reached 3.4 GB, which is what made the
// main thread's synchronous writes into it a UI problem). 40k is still
// several thousand words per document: plenty to match on, a fraction of
// the storage and write cost.
const MAX_EXTRACTED_CHARS = 40_000;

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'log', 'ts', 'tsx', 'js', 'jsx',
  'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'html',
  'htm', 'css', 'scss', 'yaml', 'yml', 'ini', 'xml', 'sql', 'sh', 'ps1',
  'bat', 'cmd',
]);

function cap(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_EXTRACTED_CHARS ? collapsed.slice(0, MAX_EXTRACTED_CHARS) : collapsed;
}

/** Strips XML tags and decodes the handful of entities Office XML actually uses. */
function stripXmlToText(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

let pdfjsReady: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null;

/**
 * pdfjs-dist's Node ("legacy") build needs its worker script pointed at by a
 * real file path — with no real `Worker` global available in Electron main,
 * it falls back to running that script in-process rather than off-thread,
 * which is exactly the lightweight behaviour wanted here.
 */
async function loadPdfjs() {
  if (!pdfjsReady) {
    pdfjsReady = import('pdfjs-dist/legacy/build/pdf.mjs').then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = pathToFileURL(
        require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
      ).href;
      return mod;
    });
  }
  return pdfjsReady;
}

async function extractPdf(filePath: string): Promise<string> {
  const pdfjs = await loadPdfjs();
  const data = await fs.promises.readFile(filePath);
  // No standardFontDataUrl: that only affects glyph metrics for rendering,
  // which this never does — getTextContent()'s .str values are unaffected,
  // and omitting it avoids a benign-but-noisy missing-font-file warning.
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
    useWorkerFetch: false,
  }).promise;

  try {
    const parts: string[] = [];
    // Extraction only needs to be roughly complete, not perfect — cap the
    // page count so one 2,000-page scanned book cannot stall the backfill
    // queue for every other file behind it.
    const pageCount = Math.min(doc.numPages, 200);
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      parts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
      if (parts.join(' ').length > MAX_EXTRACTED_CHARS) break;
    }
    return parts.join('\n');
  } finally {
    await doc.destroy();
  }
}

function extractZippedXml(filePath: string, wantPath: (name: string) => boolean): Promise<string> {
  return fs.promises.readFile(filePath).then((buffer) => {
    const entries = unzipSync(new Uint8Array(buffer), { filter: (file) => wantPath(file.name) });
    const names = Object.keys(entries).sort();
    return names.map((name) => stripXmlToText(strFromU8(entries[name]))).join('\n');
  });
}

const EXTRACTORS: Record<string, (filePath: string) => Promise<string>> = {
  pdf: extractPdf,
  docx: (filePath) => extractZippedXml(filePath, (name) => name === 'word/document.xml'),
  pptx: (filePath) => extractZippedXml(filePath, (name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)),
  xlsx: (filePath) => extractZippedXml(filePath, (name) => /^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(name)),
};

export interface ExtractResult {
  content: string;
  state: ContentState;
}

export async function extractContent(filePath: string, ext: string, sizeBytes: number): Promise<ExtractResult> {
  try {
    if (TEXT_EXTENSIONS.has(ext)) {
      if (sizeBytes > MAX_TEXT_BYTES) return { content: '', state: 'unsupported' };
      const raw = await fs.promises.readFile(filePath, 'utf-8');
      return { content: cap(raw), state: 'indexed' };
    }

    const extractor = EXTRACTORS[ext];
    if (!extractor) return { content: '', state: 'unsupported' };
    if (sizeBytes > MAX_DOC_BYTES) return { content: '', state: 'unsupported' };

    const text = await extractor(filePath);
    return { content: cap(text), state: 'indexed' };
  } catch (err) {
    mainLogger.warn('search.extract.failed', { filePath, ext, error: (err as Error).message });
    return { content: '', state: 'error' };
  }
}
