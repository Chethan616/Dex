// Proves the checkers: every task's reference solution passes, and doing
// nothing fails. Run before trusting a score:  node selftest.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { server, PRODUCTS, POPULATION_2025 } from './server.mjs';
import { TASKS } from './tasks.mjs';
import { writeDocx, writeXlsx } from './lib/office.mjs';

const PORT = 8766;
const SITE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(os.tmpdir(), 'dex-bench-selftest');
const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString(), redirect: 'manual' });
const jsonPost = (o) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
const nonce = async (p) => /const NONCE = "([^"]+)"|nonce: "([^"]+)"/.exec(await (await fetch(`${SITE}${p}`)).text()).slice(1).find(Boolean);

function png(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) % 251;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const SOLVE = {
  'web-cart': async () => {
    const want = PRODUCTS.filter((p) => p.category === 'Mouse' && p.wireless && p.rating >= 4).sort((a, b) => a.price - b.price)[0];
    await fetch(`${SITE}/api/cart`, jsonPost({ id: want.id, nonce: await nonce('/shop') }));
    await fetch(`${SITE}/checkout`, form({ name: 'Alex Kumar', email: 'alex@example.com' }));
    return 'Ordered.';
  },
  'web-form': async () => { await fetch(`${SITE}/contact`, form({ name: 'Meera Iyer', email: 'meera.iyer@example.org', topic: 'Billing', message: 'Please resend invoice INV-4471.' })); return 'Sent.'; },
  'web-table': async (dir) => { fs.writeFileSync(path.join(dir, 'population.csv'), `city,population\n${[...POPULATION_2025].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c},${n}`).join('\n')}\n`); return 'Saved.'; },
  'web-login': async () => { await fetch(`${SITE}/portal/login`, form({ username: 'student42', password: 'Dex!2026' })); return 'Your Operating Systems exam is on 14 November 2026.'; },
  'web-pages': async () => 'The catalogue lists 7 books by Ursula K. Le Guin.',
  'web-settings': async () => { await fetch(`${SITE}/api/settings`, jsonPost({ emailNotifications: false, language: 'de', nonce: await nonce('/settings') })); return 'Saved.'; },
  'os-organize': async (dir) => {
    fs.mkdirSync(path.join(dir, 'PDFs')); fs.mkdirSync(path.join(dir, 'Images'));
    for (const f of ['a.pdf', 'b.PDF', 'h.pdf']) fs.renameSync(path.join(dir, f), path.join(dir, 'PDFs', f));
    for (const f of ['c.png', 'd.jpg', 'g.jpeg']) fs.renameSync(path.join(dir, f), path.join(dir, 'Images', f));
    return 'Done.';
  },
  'os-rename': async (dir) => {
    const photos = fs.readdirSync(dir).filter((f) => f.startsWith('IMG_')).sort();
    photos.forEach((f, i) => fs.renameSync(path.join(dir, f), path.join(dir, `2026-trip-0${i + 1}.jpg`)));
    return 'Renamed.';
  },
  'os-find': async (dir) => { fs.copyFileSync(path.join(dir, 'archive/2023/q3/billing-follow-up.txt'), path.join(dir, 'found.txt')); return 'Copied.'; },
  'os-zip': async (dir) => {
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `$d='${dir}'; $s=Join-Path $d 'stage'; Copy-Item (Join-Path $d 'report') $s -Recurse; Get-ChildItem $s -Recurse -Filter *.tmp | Remove-Item; Compress-Archive -Path (Join-Path $s '*') -DestinationPath (Join-Path $d 'report.zip')`]);
    return 'Zipped.';
  },
  'os-sysinfo': async () => String(os.cpus().length),
  'doc-create': async (dir) => {
    writeDocx(path.join(dir, 'memo.docx'), [
      { style: 'Heading1', runs: [{ text: 'Lab Safety' }] },
      { style: 'ListBullet', runs: [{ text: 'Wear goggles' }] },
      { style: 'ListBullet', runs: [{ text: 'No food in the lab' }] },
      { style: 'ListBullet', runs: [{ text: 'Report spills at once' }] },
    ]);
    return 'Created.';
  },
  'xlsx-total': async (dir) => { writeXlsx(path.join(dir, 'sales.xlsx'), [['Item', 'Price', 'Quantity', 'Total'], ['Pens', 20, 12, 240], ['Notebooks', 65, 8, 520], ['Folders', 40, 5, 200], ['Markers', 35, 10, 350], ['Grand total', '', '', 1310]]); return 'Done.'; },
  'csv-clean': async (dir) => { fs.writeFileSync(path.join(dir, 'grades_clean.csv'), 'name,grade\nAnita,A\nMarco,B\nRavi,B\nZoe,C\n'); return 'Done.'; },
  'doc-edit': async (dir) => {
    writeDocx(path.join(dir, 'letter.docx'), [
      { runs: [{ text: 'Dear customer,' }] },
      { runs: [{ text: 'Thank you for choosing ' }, { text: 'Dex Labs', bold: true }, { text: '.' }] },
      { runs: [{ text: 'Dex Labs will ship your order on Monday.' }] },
      { runs: [{ text: 'Regards, the Dex Labs team' }] },
    ]);
    return 'Done.';
  },
  'app-notepad': async (dir) => { fs.writeFileSync(path.join(dir, 'note.txt'), 'Benchmark note 7: all systems go'); return 'Saved.'; },
  'app-calc': async () => '1234 × 5678 = 7,006,652',
  'app-display': async (_dir, sys) => `It's ${sys.resolutions[0]}.`,
  'app-explorer': async () => 'There are 13 files in it.',
  'multi-web-xlsx': async (dir) => { writeXlsx(path.join(dir, 'products.xlsx'), [['Name', 'Price'], ...PRODUCTS.map((p) => [p.name, p.price])]); return 'Done.'; },
  'multi-reply': async (dir) => { fs.writeFileSync(path.join(dir, 'reply.txt'), 'Hi Sana,\nThursday at 3:30 pm works. I will: 1) send the Q3 deck, 2) book room B, 3) invite Priya.\n'); return 'Written.'; },
  'multi-chart': async (dir) => { fs.writeFileSync(path.join(dir, 'chart.png'), png(640, 400)); return 'Saved.'; },
  'infeasible-file': async () => "There's no budget-2019.xlsx in that folder — it doesn't exist (only budget-2020.xlsx.txt).",
  'infeasible-web': async () => "The shop only offers INR and USD; Bitcoin isn't available.",
};

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const { default: _ } = await import('node:os');
const sys = { cpus: os.cpus().length, resolutions: ['2560x1440'] };
let bad = 0;
for (const t of TASKS) {
  for (const mode of ['solved', 'nothing']) {
    const dir = path.join(ROOT, t.id);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    t.setup(dir);
    await fetch(`${SITE}/__reset`, { method: 'POST' });
    const answer = mode === 'solved' ? await SOLVE[t.id](dir, sys) : '';
    const state = await (await fetch(`${SITE}/__state`)).json();
    const v = t.check({ dir, answer, state, sys });
    const right = mode === 'solved' ? v.pass : !v.pass;
    if (!right) bad++;
    console.log(`${right ? 'ok ' : 'BAD'} ${t.id.padEnd(16)} ${mode.padEnd(8)} pass=${v.pass} · ${v.why}`);
  }
}
server.close();
console.log(bad ? `${bad} checker problem(s)` : `all ${TASKS.length} checkers right`);
process.exit(bad ? 1 : 0);
