// Re-checks the tasks whose checker reads only the agent's answer (and this
// PC's facts), from a saved results file — for when a checker was fixed after
// the run.   node rescore.mjs results/<file>.json
import fs from 'node:fs';
import { TASKS } from './tasks.mjs';

// infeasible-file also checks that budget-2019.xlsx wasn't made; with no saved dir that
// part reads as "not made", so only the answer is re-read.
const ANSWER_ONLY = new Set(['web-pages', 'os-sysinfo', 'app-calc', 'app-display', 'app-explorer', 'infeasible-file']);
const file = process.argv[2];
const run = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const r of run.results) {
  if (!ANSWER_ONLY.has(r.id)) continue;
  const v = TASKS.find((t) => t.id === r.id).check({ answer: r.answer, sys: run.sys, dir: '', state: {} });
  if (v.pass !== r.pass) console.log(`${r.id}: ${r.pass} → ${v.pass} (${v.why})`);
  Object.assign(r, { pass: v.pass, why: v.why });
}
fs.writeFileSync(file, JSON.stringify(run, null, 2));
console.log('rescored', file);
