// Turns the latest results of each agent into results/REPORT.md.
//   node report.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASKS } from './tasks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, 'results');
const latest = (prefix) => {
  const f = fs.readdirSync(DIR).filter((n) => n.startsWith(prefix) && n.endsWith('.json')).sort().at(-1);
  return f ? { file: f, ...JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) } : null;
};
const runs = [latest('dex-'), latest('claude-code-')].filter(Boolean);
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const cats = [...new Set(TASKS.map((t) => t.category))];
let md = '# DEX-Bench results\n\n';
md += `24 OSWorld-style tasks on this Windows PC, each checked by a script that reads the end state (files, the local test site's records). Same prompts and same model for every agent. See README.md for the method.\n\n`;
md += '## Score\n\n| Agent | Passed | Rate | Median time | Median steps |\n|---|---|---|---|---|\n';
for (const r of runs) {
  const p = r.results.filter((x) => x.pass).length;
  md += `| ${r.agent} | ${p}/${r.results.length} | **${pct(p, r.results.length)}** | ${median(r.results.map((x) => x.seconds)) ?? '—'} s | ${median(r.results.map((x) => x.steps)) ?? '—'} |\n`;
}
md += '\n## By category\n\n| Category | Tasks | ' + runs.map((r) => r.agent).join(' | ') + ' |\n|---|---|' + runs.map(() => '---').join('|') + '|\n';
for (const c of cats) {
  const n = TASKS.filter((t) => t.category === c).length;
  md += `| ${c} | ${n} | ` + runs.map((r) => { const xs = r.results.filter((x) => x.category === c); return `${xs.filter((x) => x.pass).length}/${xs.length}`; }).join(' | ') + ' |\n';
}
md += '\n## Every task\n\n| Task | ' + runs.map((r) => r.agent).join(' | ') + ' |\n|---|' + runs.map(() => '---').join('|') + '|\n';
for (const t of TASKS) {
  md += `| \`${t.id}\` | ` + runs.map((r) => {
    const x = r.results.find((y) => y.id === t.id);
    return x ? `${x.pass ? '✅' : '❌'} ${x.seconds}s${x.timedOut ? ' (timed out)' : ''}` : '—';
  }).join(' | ') + ' |\n';
}
md += '\n## Why each failure failed\n\n';
for (const r of runs) {
  const fails = r.results.filter((x) => !x.pass);
  md += `**${r.agent}:** ${fails.length ? '' : 'none.'}\n\n`;
  for (const f of fails) md += `- \`${f.id}\`: ${String(f.why).replace(/\n/g, ' ').slice(0, 300)}\n`;
  md += '\n';
}
md += `Raw results: ${runs.map((r) => `\`results/${r.file}\``).join(', ')}.\n`;
fs.writeFileSync(path.join(DIR, 'REPORT.md'), md);
console.log(md);
