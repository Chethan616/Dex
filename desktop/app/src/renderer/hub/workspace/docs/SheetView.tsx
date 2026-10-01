/**
 * A spreadsheet as a grid (SheetJS): .xlsx/.xls/.ods/.csv/.tsv, values as
 * the sheet formats them, a tab per sheet. Read-only, and capped — a sheet
 * bigger than the cap shows its first rows and says so; "Open in app" has
 * the rest.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { read, utils, type WorkBook } from 'xlsx';
import type { ViewerProps } from './kinds';

export const MAX_ROWS = 5000;
export const MAX_COLS = 200;

export interface SheetGrid {
  rows: string[][];
  cols: number;
  /** The sheet has more rows (or columns) than are shown. */
  clipped: boolean;
}

/** One sheet's cells as text, capped to MAX_ROWS × MAX_COLS. */
export function sheetGrid(book: WorkBook, sheetName: string): SheetGrid {
  const ws = book.Sheets[sheetName];
  if (!ws || !ws['!ref']) return { rows: [], cols: 0, clipped: false };
  const range = utils.decode_range(ws['!ref']);
  const fullCols = range.e.c - range.s.c + 1;
  const fullRows = range.e.r - range.s.r + 1;
  const cols = Math.min(fullCols, MAX_COLS);
  const shown = { s: range.s, e: { r: Math.min(range.e.r, range.s.r + MAX_ROWS - 1), c: range.s.c + cols - 1 } };
  const rows = utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '', blankrows: true, range: shown })
    .map((r) => r.map((v) => (v == null ? '' : String(v))));
  return { rows, cols, clipped: fullRows > MAX_ROWS || fullCols > MAX_COLS };
}

export default function SheetView({ bytes, zoom, onReady, onError }: ViewerProps): React.ReactElement {
  const [book, setBook] = useState<WorkBook | null>(null);
  const [sheet, setSheet] = useState(0);

  useEffect(() => {
    try {
      // sheetRows: don't even parse past what we'd show (+1 to know it's clipped).
      setBook(read(bytes, { type: 'array', cellDates: true, dense: true, sheetRows: MAX_ROWS + 1 }));
      setSheet(0);
    } catch (err) {
      onError?.(`Couldn’t read this spreadsheet: ${(err as Error).message}`);
    }
  }, [bytes, onError]);

  const name = book?.SheetNames[sheet];
  const grid = useMemo(() => (book && name ? sheetGrid(book, name) : null), [book, name]);
  useEffect(() => { if (grid) onReady?.(); }, [grid, onReady]);

  if (!book || !grid) return <div className="dv-sheet" />;
  const letters = Array.from({ length: grid.cols }, (_, i) => utils.encode_col(i));

  return (
    <div className="dv-sheet">
      {grid.clipped && (
        <div className="dv-sheet__note">Showing the first {MAX_ROWS.toLocaleString()} rows and {MAX_COLS} columns. Open it in its own app for the rest.</div>
      )}
      {grid.rows.length === 0 ? (
        <div className="dv-sheet__note">This sheet is empty.</div>
      ) : (
        <table className="dv-sheet__grid" style={{ zoom }}>
          <thead>
            <tr>
              <th className="dv-sheet__corner" />
              {letters.map((l) => <th key={l} scope="col">{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row, r) => (
              <tr key={r}>
                <th scope="row">{r + 1}</th>
                {letters.map((l, c) => <td key={l} title={row[c] && row[c].length > 40 ? row[c] : undefined}>{row[c] ?? ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {book.SheetNames.length > 1 && (
        <div className="dv-sheet__tabs" role="tablist" aria-label="Sheets">
          {book.SheetNames.map((n, i) => (
            <button key={n} type="button" role="tab" aria-selected={i === sheet} className={`dv-sheet__tab${i === sheet ? ' dv-sheet__tab--on' : ''}`} onClick={() => setSheet(i)}>{n}</button>
          ))}
        </div>
      )}
    </div>
  );
}
