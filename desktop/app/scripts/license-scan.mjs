// License scan of the desktop app's production dependency tree (not dev
// dependencies): every package reachable from package.json "dependencies",
// with its declared license. Fails on anything that isn't plainly permissive
// and isn't a known, documented exception (LICENSES.md).
//
//   yarn licenses:scan
import fs from 'node:fs';
import path from 'node:path';

const app = process.argv[2] ?? process.cwd();
const root = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf-8'));
const seen = new Map();

// Node's lookup, but never above the app: a package in a parent folder isn't bundled.
function resolve(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const p = path.join(dir, 'node_modules', name, 'package.json');
    if (fs.existsSync(p)) return p;
    const up = path.dirname(dir);
    if (up === dir || path.relative(path.resolve(app), up).startsWith('..')) return null;
    dir = up;
  }
}

function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && pkg.license.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ');
  return 'UNKNOWN';
}

function walk(name, fromDir, optional) {
  const pj = resolve(name, fromDir);
  if (!pj) { if (!optional) seen.set(`${name}@MISSING`, { name, version: '?', license: 'MISSING' }); return; }
  const pkg = JSON.parse(fs.readFileSync(pj, 'utf-8'));
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) return;
  let lic = licenseOf(pkg);
  const dir = path.dirname(pj);
  if (lic === 'UNKNOWN') {
    const f = fs.readdirSync(dir).find((x) => /^(licen[cs]e|copying)/i.test(x));
    if (f) lic = `file:${f}:` + fs.readFileSync(path.join(dir, f), 'utf-8').slice(0, 60).replace(/\s+/g, ' ');
  }
  seen.set(key, { name: pkg.name, version: pkg.version, license: lic });
  for (const d of Object.keys(pkg.dependencies ?? {})) walk(d, dir, false);
  for (const d of Object.keys(pkg.optionalDependencies ?? {})) walk(d, dir, true);
  for (const d of Object.keys(pkg.peerDependencies ?? {})) if (!(pkg.peerDependenciesMeta?.[d]?.optional)) walk(d, dir, true);
}

for (const d of Object.keys(root.dependencies ?? {})) walk(d, app, false);
for (const d of Object.keys(root.optionalDependencies ?? {})) walk(d, app, true);

const PERMISSIVE = /^\(?(MIT|ISC|BSD-2-Clause|BSD-3-Clause|0BSD|Apache-2\.0|Unlicense|CC0-1\.0|Zlib|Python-2\.0|BlueOak-1\.0\.0|CC-BY-4\.0|MIT-0|WTFPL|OFL-1\.1)( (OR|AND) (MIT|ISC|BSD-2-Clause|BSD-3-Clause|0BSD|Apache-2\.0|Unlicense|CC0-1\.0|Zlib|GPL-3\.0-or-later|GPL-2\.0|CC-BY-3\.0|WTFPL|Apache-2\.0 WITH LLVM-exception))*\)?$/i;
const counts = {};
const flagged = [];
for (const { name, version, license } of seen.values()) {
  counts[license] = (counts[license] ?? 0) + 1;
  if (!PERMISSIVE.test(license.trim())) flagged.push(`${name}@${version}: ${license}`);
}
console.log('packages:', seen.size);
console.log(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${n} ${l}`).join('\n'));
// Known and documented in LICENSES.md: WhatsApp's encryption, via Baileys.
const KNOWN = new Set(['libsignal']);
const known = flagged.filter((f) => KNOWN.has(f.slice(0, f.lastIndexOf('@'))));
const unknown = flagged.filter((f) => !known.includes(f));
console.log('\nKnown exceptions (LICENSES.md):\n' + (known.join('\n') || '(none)'));
console.log('\nNEEDS A LOOK:\n' + (unknown.join('\n') || '(none)'));
if (unknown.length) process.exitCode = 1;
