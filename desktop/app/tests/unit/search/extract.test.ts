/**
 * Real extraction, not mocked — a minimal hand-built PDF and Office-XML zips
 * constructed in memory with the same `fflate` this module reads with. The
 * risk this module exists to manage is a single bad file wedging the content
 * backfill queue, so the error-path tests matter as much as the happy path.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { extractContent } from '../../../src/main/search/extract';

const files: string[] = [];

function tempFile(name: string, data: string | Uint8Array): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-extract-'));
  const full = path.join(dir, name);
  fs.writeFileSync(full, data);
  files.push(full);
  return full;
}

afterEach(() => {
  while (files.length > 0) {
    const file = files.pop()!;
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

const MINIMAL_PDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 18 Tf 10 50 Td (Cryptography basics) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f
trailer
<< /Size 6 /Root 1 0 R >>
startxref
0
%%EOF`;

describe('extractContent', () => {
  it('reads a text file directly', async () => {
    const file = tempFile('notes.txt', 'hello   world\n\nwith   whitespace');
    const result = await extractContent(file, 'txt', fs.statSync(file).size);
    expect(result.state).toBe('indexed');
    expect(result.content).toBe('hello world with whitespace');
  });

  it('marks an oversized text file unsupported rather than reading it', async () => {
    const file = tempFile('big.txt', 'x');
    const result = await extractContent(file, 'txt', 999_999_999);
    expect(result.state).toBe('unsupported');
    expect(result.content).toBe('');
  });

  it('extracts text from a PDF', async () => {
    const file = tempFile('syllabus.pdf', MINIMAL_PDF);
    const result = await extractContent(file, 'pdf', fs.statSync(file).size);
    expect(result.state).toBe('indexed');
    expect(result.content).toContain('Cryptography basics');
    // pdfjs takes ~900ms to initialise on its own and can exceed the 5s
    // default when the suite runs files in parallel — a real flake, not a
    // slow assertion.
  }, 20_000);

  it('marks a corrupt PDF as errored, not throwing', async () => {
    const file = tempFile('broken.pdf', '%PDF-1.4\nnot actually a pdf');
    const result = await extractContent(file, 'pdf', fs.statSync(file).size);
    expect(result.state).toBe('error');
    expect(result.content).toBe('');
  });

  it('extracts text from a docx (word/document.xml inside a zip)', async () => {
    const documentXml = `<?xml version="1.0"?>
      <w:document xmlns:w="ns"><w:body><w:p><w:r><w:t>Assessment one &amp; two</w:t></w:r></w:p></w:body></w:document>`;
    const zipped = zipSync({ 'word/document.xml': strToU8(documentXml) });
    const file = tempFile('report.docx', zipped);
    const result = await extractContent(file, 'docx', fs.statSync(file).size);
    expect(result.state).toBe('indexed');
    expect(result.content).toContain('Assessment one & two');
  });

  it('extracts text from a pptx across multiple slides in order', async () => {
    const slide1 = '<p:sld><a:t>First slide</a:t></p:sld>';
    const slide2 = '<p:sld><a:t>Second slide</a:t></p:sld>';
    const zipped = zipSync({
      'ppt/slides/slide2.xml': strToU8(slide2),
      'ppt/slides/slide1.xml': strToU8(slide1),
    });
    const file = tempFile('deck.pptx', zipped);
    const result = await extractContent(file, 'pptx', fs.statSync(file).size);
    expect(result.content.indexOf('First slide')).toBeLessThan(result.content.indexOf('Second slide'));
  });

  it('extracts shared strings from an xlsx', async () => {
    const sharedStrings = '<sst><si><t>Cryptography</t></si><si><t>Network Security</t></si></sst>';
    const zipped = zipSync({ 'xl/sharedStrings.xml': strToU8(sharedStrings) });
    const file = tempFile('grades.xlsx', zipped);
    const result = await extractContent(file, 'xlsx', fs.statSync(file).size);
    expect(result.content).toContain('Cryptography');
    expect(result.content).toContain('Network Security');
  });

  it('leaves an unrecognised extension unsupported without touching the file', async () => {
    const file = tempFile('image.png', 'not really a png');
    const result = await extractContent(file, 'png', fs.statSync(file).size);
    expect(result.state).toBe('unsupported');
  });
});
