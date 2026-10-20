// DEX-Bench tasks: OSWorld-style — a real environment, a natural request, and
// an execution-based checker that reads the end state (files, the local
// site's records), never the agent's own claim, except where the task is a
// question. Any route counts (GUI, shell, code), as in OSWorld.
//
// Each task: { id, category, prompt(dir, site), setup(dir), check(ctx) }
// ctx = { dir, answer, state, sys } → { pass, why }
import fs from 'node:fs';
import path from 'node:path';
import { PRODUCTS, POPULATION_2025, BOOKS } from './server.mjs';
import { readDocx, readXlsx, unzip, writeDocx, writeXlsx } from './lib/office.mjs';

const write = (dir, rel, content) => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
};
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const ok = (pass, why) => ({ pass: Boolean(pass), why });
const num = (s) => Number(String(s).replace(/[₹$,\s]/g, ''));
/** The agent's reply says it can't / it isn't there, without making something up. */
const SAYS_NO = /(not (found|exist|available|possible|supported|an option|offered|listed|there)|does ?n[o']t (exist|have|offer|support)|doesn't|isn't (there|available|an option|possible)|no such|couldn't find|could not find|can't find|cannot find|can't|cannot|unable|unavailable|only (offers|has|supports|lists)|missing)/i;

export const TASKS = [
  /* ── Web (DEX's browser on the local site) ───────────────────────── */
  {
    id: 'web-cart', category: 'Web',
    prompt: (dir, site) => `On ${site}/shop, buy the cheapest wireless mouse that has a rating of 4 stars or more. Check out as Alex Kumar, alex@example.com.`,
    setup() {},
    check({ state }) {
      const want = PRODUCTS.filter((p) => p.category === 'Mouse' && p.wireless && p.rating >= 4).sort((a, b) => a.price - b.price)[0];
      const o = state.orders.at(-1);
      if (!o) return ok(false, 'no order placed');
      return ok(o.items.length === 1 && o.items[0] === want.id && /alex kumar/i.test(o.name) && o.email.toLowerCase() === 'alex@example.com',
        `order ${JSON.stringify(o)}; expected only ${want.id} (${want.name})`);
    },
  },
  {
    id: 'web-form', category: 'Web',
    prompt: (dir, site) => `Send a message through the contact form at ${site}/contact: from Meera Iyer (meera.iyer@example.org), topic Billing, saying "Please resend invoice INV-4471."`,
    setup() {},
    check({ state }) {
      const c = state.contact.at(-1);
      if (!c) return ok(false, 'nothing submitted');
      return ok(/meera iyer/i.test(c.name) && c.email === 'meera.iyer@example.org' && c.topic === 'Billing' && /INV-4471/.test(c.message), JSON.stringify(c));
    },
  },
  {
    id: 'web-table', category: 'Web',
    prompt: (dir, site) => `Save the 2025 city population table from ${site}/data as a CSV at ${path.join(dir, 'population.csv')}, with the columns city,population, biggest city first.`,
    setup() {},
    check({ dir }) {
      if (!exists(dir, 'population.csv')) return ok(false, 'no population.csv');
      const lines = read(dir, 'population.csv').trim().split(/\r?\n/).map((l) => l.split(',').map((x) => x.trim().replace(/^"|"$/g, '')));
      const [head, ...rows] = lines;
      const want = [...POPULATION_2025].sort((a, b) => b[1] - a[1]);
      const good = head.join(',').toLowerCase() === 'city,population' && rows.length === want.length && rows.every((r, i) => r[0] === want[i][0] && num(r[1]) === want[i][1]);
      return ok(good, `got ${rows.length} rows; first ${JSON.stringify(rows[0])}`);
    },
  },
  {
    id: 'web-login', category: 'Web',
    prompt: (dir, site) => `Sign in to the student portal at ${site}/portal (username student42, password Dex!2026) and tell me the date of my Operating Systems exam.`,
    setup() {},
    check({ answer, state }) {
      const signed = state.logins.some((l) => l.ok);
      return ok(signed && /(14(th)? November|November 14|14[/.-]11[/.-]2026|2026-11-14)/i.test(answer), `signed in: ${signed}; answer: ${answer.slice(0, 160)}`);
    },
  },
  {
    id: 'web-pages', category: 'Web',
    prompt: (dir, site) => `How many books by Ursula K. Le Guin does the library catalogue at ${site}/library list? Answer with the number.`,
    setup() {},
    check({ answer }) {
      const want = BOOKS.filter((b) => b.author === 'Ursula K. Le Guin').length;
      // The count is the number given for the books ("**7** books"), else the first number said.
      const plain = answer.replace(/[*_`]/g, '');
      const given = /\b(\d+)\s+(?:\w+\s+){0,3}books?\b/i.exec(plain)?.[1] ?? /\b\d+\b/.exec(plain)?.[0];
      return ok(Number(given) === want, `want ${want}; read ${given}; answer: ${answer.slice(0, 160)}`);
    },
  },
  {
    id: 'web-settings', category: 'Web',
    prompt: (dir, site) => `On ${site}/settings, turn off email notifications and switch the language to Deutsch, then save.`,
    setup() {},
    check({ state }) {
      const s = state.settings;
      return ok(s.saves > 0 && s.emailNotifications === false && s.language === 'de', JSON.stringify(s));
    },
  },

  /* ── Files and the OS ──────────────────────────────────────────── */
  {
    id: 'os-organize', category: 'Files & OS',
    prompt: (dir) => `In ${dir}, put every PDF into a folder called PDFs and every image into a folder called Images. Leave the other files where they are.`,
    setup(dir) { for (const f of ['a.pdf', 'b.PDF', 'h.pdf', 'c.png', 'd.jpg', 'g.jpeg', 'e.txt', 'f.docx']) write(dir, f, `file ${f}`); },
    check({ dir }) {
      const pdfs = ['a.pdf', 'b.PDF', 'h.pdf'].every((f) => exists(dir, `PDFs/${f}`));
      const imgs = ['c.png', 'd.jpg', 'g.jpeg'].every((f) => exists(dir, `Images/${f}`));
      const rest = exists(dir, 'e.txt') && exists(dir, 'f.docx');
      const moved = !['a.pdf', 'c.png', 'g.jpeg'].some((f) => exists(dir, f));
      return ok(pdfs && imgs && rest && moved, `pdfs ${pdfs} images ${imgs} others kept ${rest} originals gone ${moved}`);
    },
  },
  {
    id: 'os-rename', category: 'Files & OS',
    prompt: (dir) => `Rename the photos in ${dir} to 2026-trip-01.jpg, 2026-trip-02.jpg and so on, in the order they were taken (oldest first). Don't touch notes.txt.`,
    setup(dir) {
      write(dir, 'IMG_20260303_090000.jpg', 'third');
      write(dir, 'IMG_20260301_120000.jpg', 'first');
      write(dir, 'IMG_20260302_180000.jpg', 'second');
      write(dir, 'notes.txt', 'keep me');
    },
    check({ dir }) {
      const want = [['2026-trip-01.jpg', 'first'], ['2026-trip-02.jpg', 'second'], ['2026-trip-03.jpg', 'third']];
      const good = want.every(([f, c]) => exists(dir, f) && read(dir, f) === c) && exists(dir, 'notes.txt') && !fs.readdirSync(dir).some((f) => f.startsWith('IMG_'));
      return ok(good, fs.readdirSync(dir).join(', '));
    },
  },
  {
    id: 'os-find', category: 'Files & OS',
    prompt: (dir) => `Somewhere under ${dir} there's a text file that mentions invoice INV-4471. Copy it to ${path.join(dir, 'found.txt')}.`,
    setup(dir) {
      for (let i = 0; i < 30; i++) write(dir, `archive/${2020 + (i % 5)}/notes-${i}.txt`, `Meeting notes ${i}\nNothing about invoices here, just item ${i * 7}.\n`);
      write(dir, 'archive/2023/q3/billing-follow-up.txt', 'Dear team,\nInvoice INV-4471 is still unpaid. Please chase it.\n');
    },
    check({ dir }) {
      return ok(exists(dir, 'found.txt') && read(dir, 'found.txt').includes('INV-4471 is still unpaid'), exists(dir, 'found.txt') ? read(dir, 'found.txt').slice(0, 80) : 'no found.txt');
    },
  },
  {
    id: 'os-zip', category: 'Files & OS',
    prompt: (dir) => `Zip the report folder in ${dir} into ${path.join(dir, 'report.zip')}, leaving out the .tmp files.`,
    setup(dir) {
      write(dir, 'report/summary.md', '# Summary\n');
      write(dir, 'report/data.csv', 'a,b\n1,2\n');
      write(dir, 'report/figures/fig1.png', 'png');
      write(dir, 'report/scratch.tmp', 'tmp');
      write(dir, 'report/figures/cache.tmp', 'tmp');
    },
    check({ dir }) {
      if (!exists(dir, 'report.zip')) return ok(false, 'no report.zip');
      const names = Object.keys(unzip(path.join(dir, 'report.zip'))).filter((n) => !n.endsWith('/')).map((n) => n.replace(/\\/g, '/').replace(/^report\//, ''));
      const good = ['summary.md', 'data.csv', 'figures/fig1.png'].every((n) => names.includes(n)) && !names.some((n) => n.endsWith('.tmp'));
      return ok(good, names.join(', '));
    },
  },
  {
    id: 'os-sysinfo', category: 'Files & OS',
    prompt: () => 'How many logical processors does this PC have? Answer with just the number.',
    setup() {},
    check({ answer, sys }) {
      const nums = (answer.match(/\b\d+\b/g) || []).map(Number);
      return ok(nums.includes(sys.cpus), `want ${sys.cpus}; answer: ${answer.slice(0, 120)}`);
    },
  },

  /* ── Documents ─────────────────────────────────────────────────── */
  {
    id: 'doc-create', category: 'Documents',
    prompt: (dir) => `Create a Word document at ${path.join(dir, 'memo.docx')} with the heading "Lab Safety" (as a real Heading 1) followed by three bullet points: Wear goggles, No food in the lab, Report spills at once.`,
    setup() {},
    check({ dir }) {
      if (!exists(dir, 'memo.docx')) return ok(false, 'no memo.docx');
      const ps = readDocx(path.join(dir, 'memo.docx')).filter((p) => p.text.trim());
      const head = ps.find((p) => /lab safety/i.test(p.text));
      const isH1 = head && /^(heading ?1|title)$/i.test(head.style.replace(/\s+/g, ' ').trim()) ;
      const items = ['wear goggles', 'no food in the lab', 'report spills at once'];
      const bullets = items.every((t) => ps.some((p) => p.text.toLowerCase().includes(t) && (p.numbered || /list/i.test(p.style))));
      return ok(isH1 && bullets, `heading style "${head?.style}", bullets ${bullets}`);
    },
  },
  {
    id: 'xlsx-total', category: 'Documents',
    prompt: (dir) => `In ${path.join(dir, 'sales.xlsx')}, add a column D called Total (price × quantity) for every row, and a last row with the grand total in column D.`,
    setup(dir) {
      fs.mkdirSync(dir, { recursive: true });
      writeXlsx(path.join(dir, 'sales.xlsx'), [['Item', 'Price', 'Quantity'], ['Pens', 20, 12], ['Notebooks', 65, 8], ['Folders', 40, 5], ['Markers', 35, 10]]);
    },
    check({ dir }) {
      if (!exists(dir, 'sales.xlsx')) return ok(false, 'no sales.xlsx');
      const c = readXlsx(path.join(dir, 'sales.xlsx'));
      const rows = [[20, 12], [65, 8], [40, 5], [35, 10]];
      const header = /total/i.test(String(c.D1?.v ?? ''));
      const rowOk = rows.every(([p, q], i) => {
        const cell = c[`D${i + 2}`];
        if (!cell) return false;
        if (typeof cell.v === 'number' && Math.abs(cell.v - p * q) < 0.01) return true;
        const f = (cell.f || '').replace(/\s|\$/g, '').toUpperCase();
        const r = i + 2;
        return [`B${r}*C${r}`, `C${r}*B${r}`, `PRODUCT(B${r}:C${r})`, `PRODUCT(B${r},C${r})`].includes(f);
      });
      const grand = rows.reduce((s, [p, q]) => s + p * q, 0);
      const totalCell = [6, 7].map((r) => c[`D${r}`]).find(Boolean);
      const totalOk = totalCell && ((typeof totalCell.v === 'number' && Math.abs(totalCell.v - grand) < 0.01) || /^SUM\(D2:D5\)$/i.test((totalCell.f || '').replace(/\s|\$/g, '')));
      return ok(header && rowOk && totalOk, `header ${header} rows ${rowOk} grand ${JSON.stringify(totalCell)}`);
    },
  },
  {
    id: 'csv-clean', category: 'Documents',
    prompt: (dir) => `${path.join(dir, 'grades.csv')} has duplicate students and blank lines. Write a cleaned copy to ${path.join(dir, 'grades_clean.csv')}: keep the header, each student once (their first row), no blank lines, sorted by name.`,
    setup(dir) {
      write(dir, 'grades.csv', 'name,grade\nRavi,B\n\nAnita,A\nZoe,C\nRavi,A\n\nMarco,B\nAnita,B\n');
    },
    check({ dir }) {
      if (!exists(dir, 'grades_clean.csv')) return ok(false, 'no grades_clean.csv');
      const got = read(dir, 'grades_clean.csv').trim().split(/\r?\n/).map((l) => l.trim().replace(/"/g, ''));
      const want = ['name,grade', 'Anita,A', 'Marco,B', 'Ravi,B', 'Zoe,C'];
      return ok(JSON.stringify(got) === JSON.stringify(want), got.join(' | '));
    },
  },
  {
    id: 'doc-edit', category: 'Documents',
    prompt: (dir) => `In ${path.join(dir, 'letter.docx')}, change every "Acme Ltd" to "Dex Labs". Keep the formatting as it is.`,
    setup(dir) {
      fs.mkdirSync(dir, { recursive: true });
      writeDocx(path.join(dir, 'letter.docx'), [
        { runs: [{ text: 'Dear customer,' }] },
        { runs: [{ text: 'Thank you for choosing ' }, { text: 'Acme Ltd', bold: true }, { text: '.' }] },
        { runs: [{ text: 'Acme Ltd will ship your order on Monday.' }] },
        { runs: [{ text: 'Regards, the Acme Ltd team' }] },
      ]);
    },
    check({ dir }) {
      if (!exists(dir, 'letter.docx')) return ok(false, 'no letter.docx');
      const ps = readDocx(path.join(dir, 'letter.docx'));
      const all = ps.map((p) => p.text).join('\n');
      const count = (all.match(/Dex Labs/g) || []).length;
      const boldKept = ps.some((p) => p.runs.some((r) => r.bold && /Dex Labs/.test(r.text)));
      return ok(!/Acme Ltd/.test(all) && count === 3 && boldKept && /Monday/.test(all), `Dex Labs ×${count}, bold kept ${boldKept}`);
    },
  },

  /* ── Windows apps ──────────────────────────────────────────────── */
  {
    id: 'app-notepad', category: 'Windows apps',
    prompt: (dir) => `Open Notepad, write "Benchmark note 7: all systems go" and save it as ${path.join(dir, 'note.txt')}.`,
    setup(dir) { fs.mkdirSync(dir, { recursive: true }); },
    check({ dir }) {
      return ok(exists(dir, 'note.txt') && read(dir, 'note.txt').replace(/^﻿/, '').trim() === 'Benchmark note 7: all systems go', exists(dir, 'note.txt') ? JSON.stringify(read(dir, 'note.txt')) : 'no note.txt');
    },
  },
  {
    id: 'app-calc', category: 'Windows apps',
    prompt: () => 'Use the Calculator app to work out 1234 × 5678 and tell me the result.',
    setup() {},
    check({ answer }) {
      return ok(/7[,\s]?006[,\s]?652/.test(answer), answer.slice(0, 160));
    },
  },
  {
    id: 'app-display', category: 'Windows apps',
    prompt: () => "What's the resolution of this PC's main display right now?",
    setup() {},
    check({ answer, sys }) {
      const pairs = [...answer.matchAll(/(\d{3,5})\s*[x×*by ]+\s*(\d{3,5})/gi)].map((m) => `${m[1]}x${m[2]}`);
      return ok(pairs.some((p) => sys.resolutions.includes(p)), `want one of ${sys.resolutions.join('/')}; answer: ${answer.slice(0, 160)}`);
    },
  },
  {
    id: 'app-explorer', category: 'Windows apps',
    prompt: (dir) => `Open the folder ${path.join(dir, 'inbox')} in File Explorer and tell me how many files are in it.`,
    setup(dir) { for (let i = 1; i <= 13; i++) write(dir, `inbox/scan-${String(i).padStart(2, '0')}.pdf`, `scan ${i}`); },
    check({ answer }) {
      return ok(/\b13\b|thirteen/i.test(answer), answer.slice(0, 160));
    },
  },

  /* ── Workflows across apps ─────────────────────────────────────── */
  {
    id: 'multi-web-xlsx', category: 'Multi-app',
    prompt: (dir, site) => `Put every product on ${site}/shop into a spreadsheet at ${path.join(dir, 'products.xlsx')}: a header row "Name, Price", then one row per product with its price in rupees as a number.`,
    setup(dir) { fs.mkdirSync(dir, { recursive: true }); },
    check({ dir }) {
      if (!exists(dir, 'products.xlsx')) return ok(false, 'no products.xlsx');
      const c = readXlsx(path.join(dir, 'products.xlsx'));
      const header = /name/i.test(String(c.A1?.v ?? '')) && /price/i.test(String(c.B1?.v ?? ''));
      const got = new Map();
      for (let r = 2; r < 40; r++) if (c[`A${r}`]?.v) got.set(String(c[`A${r}`].v).trim(), num(c[`B${r}`]?.v));
      const good = PRODUCTS.every((p) => got.get(p.name) === p.price) && got.size === PRODUCTS.length;
      return ok(header && good, `header ${header}; ${got.size} rows; mismatches: ${PRODUCTS.filter((p) => got.get(p.name) !== p.price).map((p) => p.name).join(', ') || 'none'}`);
    },
  },
  {
    id: 'multi-reply', category: 'Multi-app',
    prompt: (dir) => `Read ${path.join(dir, 'meeting.txt')} and write a short reply to Sana in ${path.join(dir, 'reply.txt')} that confirms the meeting time and lists the three action items.`,
    setup(dir) {
      write(dir, 'meeting.txt', 'From: Sana\nSubject: Planning\n\nHi! Can we meet on Thursday at 3:30 pm in room B?\nBefore then:\n1) send the Q3 deck\n2) book room B for an hour\n3) invite Priya from design\n\nThanks, Sana\n');
    },
    check({ dir }) {
      if (!exists(dir, 'reply.txt')) return ok(false, 'no reply.txt');
      const t = read(dir, 'reply.txt');
      const checks = { thursday: /thursday/i.test(t), time: /3[:.]30/.test(t), deck: /deck/i.test(t), room: /room b/i.test(t), priya: /priya/i.test(t), sana: /sana/i.test(t) };
      return ok(Object.values(checks).every(Boolean), JSON.stringify(checks));
    },
  },
  {
    id: 'multi-chart', category: 'Multi-app',
    prompt: (dir) => `Make a bar chart of the scores in ${path.join(dir, 'scores.csv')} and save it as an image at ${path.join(dir, 'chart.png')}.`,
    setup(dir) { write(dir, 'scores.csv', 'student,score\nAsha,78\nBen,92\nChen,65\nDara,88\nEli,71\n'); },
    check({ dir }) {
      if (!exists(dir, 'chart.png')) return ok(false, 'no chart.png');
      const b = fs.readFileSync(path.join(dir, 'chart.png'));
      const png = b.length > 24 && b.readUInt32BE(0) === 0x89504e47;
      const w = png ? b.readUInt32BE(16) : 0;
      const h = png ? b.readUInt32BE(20) : 0;
      return ok(png && w >= 300 && h >= 200 && b.length > 1500, `png ${png}, ${w}×${h}, ${b.length} bytes`);
    },
  },

  /* ── Impossible (the right answer is to say so) ────────────────── */
  {
    id: 'infeasible-file', category: 'Infeasible',
    prompt: (dir) => `Open ${path.join(dir, 'budget-2019.xlsx')} and tell me the total for March.`,
    setup(dir) { write(dir, 'budget-2020.xlsx.txt', 'not the file you want'); },
    check({ dir, answer }) {
      return ok(SAYS_NO.test(answer) && !exists(dir, 'budget-2019.xlsx'), answer.slice(0, 160));
    },
  },
  {
    id: 'infeasible-web', category: 'Infeasible',
    prompt: (dir, site) => `On ${site}/shop, switch the prices to Bitcoin.`,
    setup() {},
    check({ answer, state }) {
      return ok(SAYS_NO.test(answer) && ['INR', 'USD'].includes(state.currency), `currency ${state.currency}; answer: ${answer.slice(0, 160)}`);
    },
  },
];
