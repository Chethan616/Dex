#!/usr/bin/env node
/**
 * sync-domain-skills.mjs
 *
 * Pulls `domain-skills/` from browser-use/harnessless into
 * `src/main/hl/stock/domain-skills/` and records the upstream commit in
 * `src/main/hl/stock/domain-skills/VERSION`.
 *
 * Run before cutting a release:
 *
 *     yarn sync-domain-skills                 # tracks main
 *     yarn sync-domain-skills --ref=v0.3.1    # pinned tag
 *     yarn sync-domain-skills --ref=<sha>     # pinned commit
 *
 * Then commit the diff. Domain skills are checked into the repo so they
 * are deterministic per release and visible in git history.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/browser-use/harnessless.git';
const SRC_SUBDIR = 'domain-skills';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stockDir = path.resolve(__dirname, '..', 'src', 'main', 'hl', 'stock');
const destDir = path.join(stockDir, 'domain-skills');

function parseRef() {
  const arg = process.argv.slice(2).find((a) => a.startsWith('--ref='));
  return arg ? arg.slice('--ref='.length) : 'main';
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf-8', ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.status})`);
  }
  return (r.stdout ?? '').trim();
}

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

/** Folders under domain-skills/ that DEX wrote itself; a sync keeps them. */
const DEX_OWNED = ['google-travel'];

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function main() {
  const ref = parseRef();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harnessless-sync-'));
  try {
    console.log(`[sync-domain-skills] cloning ${REPO} @ ${ref}`);
    run('git', ['clone', '--depth', '1', '--branch', ref, REPO, tmp], { stdio: 'inherit' });
    const sha = run('git', ['-C', tmp, 'rev-parse', 'HEAD']);

    const srcPath = path.join(tmp, SRC_SUBDIR);
    if (!fs.existsSync(srcPath)) {
      throw new Error(`upstream has no ${SRC_SUBDIR}/ at ref ${ref}`);
    }

    console.log(`[sync-domain-skills] replacing ${path.relative(process.cwd(), destDir)}/`);
    // DEX's own playbooks live beside upstream's: set them aside, put them back.
    const kept = path.join(tmp, '__dex_owned');
    for (const name of DEX_OWNED) {
      const own = path.join(destDir, name);
      if (fs.existsSync(own)) copyDirSync(own, path.join(kept, name));
    }
    rmrf(destDir);
    copyDirSync(srcPath, destDir);
    for (const name of DEX_OWNED) {
      const saved = path.join(kept, name);
      if (fs.existsSync(saved)) copyDirSync(saved, path.join(destDir, name));
    }

    const version = {
      repo: 'browser-use/harnessless',
      ref,
      sha,
      syncedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(destDir, 'VERSION'), JSON.stringify(version, null, 2) + '\n', 'utf-8');

    const fileCount = countFiles(destDir);
    console.log(`[sync-domain-skills] wrote ${fileCount} files from sha ${sha.slice(0, 10)} (ref ${ref})`);
    console.log(`[sync-domain-skills] review + commit:`);
    console.log(`    git add ${path.relative(process.cwd(), destDir)}`);
    console.log(`    git status`);
  } finally {
    rmrf(tmp);
  }
}

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    else n++;
  }
  return n;
}

main();
