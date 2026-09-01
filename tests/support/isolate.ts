/**
 * Point this test at a throwaway database. Import it FIRST, before anything
 * that might open one.
 *
 *     import '../support/isolate';
 *
 * Only three of eleven test files used to do this by hand, so the rest wrote
 * into the real `data/dex.db`. The damage was not just noise in `/stats`: the
 * task table ended up holding two `set_dns` rows marked COMPLETED, written by
 * a test against a mocked agent, for an action that had never once reached the
 * daemon. Reading the database to find out what actually works — the obvious
 * thing to do, and the thing that eventually found the real bug — gave the
 * wrong answer for weeks.
 *
 * A test that can write to the real store is a test that can lie about
 * production, so `core/memory/db.ts` now refuses to open the real file when
 * DEX_TEST is set.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-test-'));

process.env.DEX_TEST = '1';
process.env.DEX_DB = path.join(dir, 'dex.db');
// ...and its settings. Without this the suite reads the owner's real
// settings.json, so a test asserting a default fails on a machine where
// someone has chosen something else — which is exactly what happened.
process.env.DEX_CONFIG = path.join(dir, 'settings.json');

/** Where this test's throwaway database lives, if it needs to look. */
export const testDbPath = process.env.DEX_DB;
export const testConfigPath = process.env.DEX_CONFIG;

process.on('exit', () => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // A leftover temp directory is not worth failing a passing test over.
  }
});
