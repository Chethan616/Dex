import { describe, expect, it } from 'vitest';
import { read, utils, write } from 'xlsx';
import { mimeFor, safeHref, viewerFor, zoomable } from '../../../../src/renderer/hub/workspace/docs/kinds';
import { nextZoom, sizeLabel } from '../../../../src/renderer/hub/workspace/docs/DocumentView';
import { MAX_TEXT_CHARS, decodeText } from '../../../../src/renderer/hub/workspace/docs/TextView';
import { MAX_ROWS, sheetGrid } from '../../../../src/renderer/hub/workspace/docs/SheetView';

/** The pieces behind document tabs (docs/unify/PLAN.md §3.9). */
describe('document viewers', () => {
  it('picks a viewer by extension, whatever the case or folder', () => {
    expect(viewerFor('C:\\Reports\\Q3.PDF')).toBe('pdf');
    expect(viewerFor('/tmp/plan.docx')).toBe('docx');
    expect(viewerFor('data.csv')).toBe('sheet');
    expect(viewerFor('book.xlsx')).toBe('sheet');
    expect(viewerFor('README.md')).toBe('markdown');
    expect(viewerFor('main.py')).toBe('text');
    expect(viewerFor('photo.JPG')).toBe('image');
    expect(viewerFor('clip.webm')).toBe('video');
    expect(viewerFor('robot.glb')).toBe('model');
    expect(viewerFor('page.html')).toBe('html');
    // .doc (old Word) and unknown files have no viewer: "Open in app".
    expect(viewerFor('old.doc')).toBe('none');
    expect(viewerFor('archive.zip')).toBe('none');
    expect(viewerFor('Makefile')).toBe('none');
  });

  it('gives blobs a type the browser understands', () => {
    expect(mimeFor('a.svg')).toBe('image/svg+xml');
    expect(mimeFor('a.mp3')).toBe('audio/mpeg');
    expect(mimeFor('a.glb')).toBe('model/gltf-binary');
    expect(mimeFor('a.weird')).toBe('application/octet-stream');
  });

  it('only lets web, mail and in-document links out of a document', () => {
    expect(safeHref('https://example.com')).toBe('web');
    expect(safeHref('HTTP://example.com')).toBe('web');
    expect(safeHref('mailto:a@b.c')).toBe('web');
    expect(safeHref('#section-2')).toBe('anchor');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('file:///C:/Windows/system32')).toBeNull();
    expect(safeHref('data:text/html,hi')).toBeNull();
    expect(safeHref(null)).toBeNull();
  });

  it('zooms pages and pictures, not players', () => {
    expect(zoomable('pdf')).toBe(true);
    expect(zoomable('sheet')).toBe(true);
    expect(zoomable('video')).toBe(false);
    expect(zoomable('model')).toBe(false);
  });

  it('steps zoom through fixed stops and stops at the ends', () => {
    expect(nextZoom(1, 1)).toBe(1.1);
    expect(nextZoom(1, -1)).toBe(0.9);
    expect(nextZoom(3, 1)).toBe(3);
    expect(nextZoom(0.5, -1)).toBe(0.5);
    // A zoom between stops goes to the next stop each way.
    expect(nextZoom(1.05, 1)).toBe(1.1);
    expect(nextZoom(1.05, -1)).toBe(1);
  });

  it('labels sizes the way people say them', () => {
    expect(sizeLabel(900)).toBe('900 B');
    expect(sizeLabel(40_000)).toBe('39 KB');
    expect(sizeLabel(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(sizeLabel(42 * 1024 * 1024)).toBe('42 MB');
  });

  it('decodes text, drops a BOM, and pretty-prints one-line JSON', () => {
    const enc = new TextEncoder();
    expect(decodeText(enc.encode('\uFEFFhi'), 'a.txt').text).toBe('hi');
    expect(decodeText(enc.encode('{"a":1,"b":[2]}'), 'x.json').text).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}');
    // Broken JSON is shown as it is.
    expect(decodeText(enc.encode('{"a":'), 'x.json').text).toBe('{"a":');
    const long = decodeText(enc.encode('x'.repeat(MAX_TEXT_CHARS + 10)), 'big.log');
    expect(long.clipped).toBe(true);
    expect(long.text.length).toBe(MAX_TEXT_CHARS);
  });

  it('turns a sheet into text cells, as the sheet formats them', () => {
    const book = utils.book_new();
    utils.book_append_sheet(book, utils.aoa_to_sheet([['Name', 'Score'], ['Ada', 91.5], ['Lin', 78]]), 'Scores');
    const grid = sheetGrid(book, 'Scores');
    expect(grid.cols).toBe(2);
    expect(grid.rows).toEqual([['Name', 'Score'], ['Ada', '91.5'], ['Lin', '78']]);
    expect(grid.clipped).toBe(false);
    expect(sheetGrid(book, 'Missing')).toEqual({ rows: [], cols: 0, clipped: false });
  });

  it('caps a huge sheet and says it did', () => {
    const rows = Array.from({ length: MAX_ROWS + 50 }, (_, i) => [i]);
    const book = utils.book_new();
    utils.book_append_sheet(book, utils.aoa_to_sheet(rows), 'Big');
    // Read back the way SheetView does, parsing no further than it shows.
    const bytes = write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const parsed = read(new Uint8Array(bytes), { type: 'array', dense: true, sheetRows: MAX_ROWS + 1 });
    const grid = sheetGrid(parsed, 'Big');
    expect(grid.rows.length).toBe(MAX_ROWS);
    expect(grid.clipped).toBe(true);
  });

  it('reads a CSV through the same path', () => {
    const csv = new TextEncoder().encode('city,temp\nPune,31\nOslo,4\n');
    const book = read(csv, { type: 'array', dense: true });
    expect(sheetGrid(book, book.SheetNames[0]).rows).toEqual([['city', 'temp'], ['Pune', '31'], ['Oslo', '4']]);
  });
});
