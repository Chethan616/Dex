// Just enough of .xlsx and .docx to set tasks up and check them: no
// dependencies beyond fflate (zip), which DEX already ships.
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { zipSync, unzipSync, strToU8, strFromU8 } = require('../../../desktop/app/node_modules/fflate');

const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const unEsc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export function unzip(file) {
  const files = unzipSync(new Uint8Array(fs.readFileSync(file)));
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v]));
}

/* ── xlsx ──────────────────────────────────────────────────────────── */

const col = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

/** rows: arrays of strings/numbers; the first sheet only. */
export function writeXlsx(file, rows, sheetName = 'Sheet1') {
  const cells = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = `${col(ci)}${ri + 1}`;
    return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${xmlEsc(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEsc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${cells}</sheetData></worksheet>`),
  };
  fs.writeFileSync(file, zipSync(files));
}

/** The first sheet's cells: { A1: { v, f } } — v a number or a string, f the formula without "=". */
export function readXlsx(file) {
  const z = unzip(file);
  const text = (name) => (z[name] ? strFromU8(z[name]) : '');
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unEsc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const wb = text('xl/workbook.xml');
  const rid = /<sheet [^>]*r:id="([^"]+)"/.exec(wb)?.[1];
  const rels = text('xl/_rels/workbook.xml.rels');
  let target = rid ? new RegExp(`<Relationship [^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`<Relationship [^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1] : null;
  target = target ? target.replace(/^\/?xl\//, '').replace(/^\//, '') : 'worksheets/sheet1.xml';
  const sheet = text(`xl/${target}`);
  const cells = {};
  for (const m of sheet.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1];
    const inner = m[2] || '';
    const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
    if (!ref) continue;
    const t = /t="([^"]+)"/.exec(attrs)?.[1];
    const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(inner)?.[1];
    const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
    let v = null;
    if (t === 's' && raw != null) v = shared[Number(raw)];
    else if (t === 'inlineStr') v = unEsc([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
    else if (t === 'str') v = raw != null ? unEsc(raw) : null;
    else if (raw != null) v = Number(raw);
    cells[ref] = { v, f: f != null ? unEsc(f) : undefined };
  }
  return cells;
}

/* ── docx ──────────────────────────────────────────────────────────── */

/** paragraphs: [{ runs: [{ text, bold? }], style? }] */
export function writeDocx(file, paragraphs) {
  const body = paragraphs.map((p) => `<w:p>${p.style ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>` : ''}${p.runs.map((r) => `<w:r>${r.bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xmlEsc(r.text)}</w:t></w:r>`).join('')}</w:p>`).join('');
  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`),
  };
  fs.writeFileSync(file, zipSync(files));
}

/** [{ style, text, numbered, runs: [{ text, bold }] }] */
export function readDocx(file) {
  const xml = strFromU8(unzip(file)['word/document.xml']);
  const styles = (() => { try { return strFromU8(unzip(file)['word/styles.xml']); } catch { return ''; } })();
  // A style id → its name ("Heading1" → "heading 1"), so either way of naming matches.
  const nameOf = (id) => new RegExp(`<w:style [^>]*w:styleId="${id}"[^>]*>[\\s\\S]*?<w:name w:val="([^"]+)"`).exec(styles)?.[1] ?? id;
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => {
    const p = m[0];
    const styleId = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? '';
    const runs = [...p.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)].map((r) => ({
      text: unEsc([...r[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((t) => t[1]).join('')),
      bold: /<w:b\/>|<w:b w:val="(1|true)"\/>/.test(r[0]),
    }));
    return { style: styleId ? nameOf(styleId) : '', styleId, numbered: /<w:numPr>/.test(p), runs, text: runs.map((r) => r.text).join('') };
  });
}
