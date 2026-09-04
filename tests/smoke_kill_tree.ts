/**
 * Stop actually stops.
 *
 *     npm run test:kill-tree
 *
 * The complaint: pressing Stop while Dex was thinking did not stop the model,
 * and the tokens were spent anyway.
 *
 * The Stop button did reach the provider and the provider did call
 * `child.kill()`. What it killed was the wrong process. npm installs global
 * binaries as shims, so `claude` is `claude.cmd`, and spawning a `.cmd` makes
 * Node run `cmd.exe /d /c claude.cmd …` — verified, that is exactly what
 * `resolveCommand` returns here. `kill()` signals one process, which is
 * `cmd.exe`; the CLI doing the generating is its child and survives.
 *
 * This spawns the same shape — a cmd.exe with a long-lived child — and checks
 * that both are gone afterwards. A test that only killed a single process
 * would pass with the bug still in place.
 */
import { spawn } from 'child_process';
import { execSync } from 'child_process';
import { killTree } from '../core/llm/kill_tree';

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? `\n      ${detail}` : ''}`);
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Children of a process, by pid. */
function childrenOf(pid: number): number[] {
  if (process.platform !== 'win32') return [];
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process ' +
        `-Filter \\"ParentProcessId=${pid}\\" | Select-Object -ExpandProperty ProcessId"`,
      { encoding: 'utf8' },
    );
    return out.split(/\r?\n/).map((n) => parseInt(n.trim(), 10)).filter(Boolean);
  } catch {
    return [];
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log('\n\x1b[1mStop kills the process that is generating\x1b[0m');

  if (process.platform !== 'win32') {
    console.log('  (skipped: the shim behaviour this covers is Windows-only)');
    console.log('\n0 passed, 0 failed');
    return;
  }

  // The same shape as `cmd.exe /d /c claude.cmd …`: a cmd that starts
  // something long-lived and waits for it.
  const parent = spawn(
    'cmd.exe',
    ['/d', '/c', 'ping', '-n', '120', '127.0.0.1'],
    { windowsHide: true, stdio: 'ignore' },
  );

  await wait(1200);

  const pid = parent.pid!;
  const kids = childrenOf(pid);
  check('the shim really does start a separate child process', kids.length > 0,
    `children of ${pid}: ${JSON.stringify(kids)}`);

  // What the provider used to do. The child survives it, which is the bug.
  parent.kill();
  await wait(1200);

  const survivors = kids.filter(alive);
  check(
    'child.kill() leaves the real work running — the bug this fixes',
    survivors.length > 0,
    survivors.length === 0
      ? 'the grandchild died on its own, so this run proves nothing'
      : `still alive: ${JSON.stringify(survivors)}`,
  );

  // Tidy up the leaked one before moving on.
  for (const kid of survivors) killTree(kid);

  // And what it does now — on a fresh tree, because `taskkill /T` walks
  // *living* descendants. Once the parent is gone Windows re-parents its
  // children and there is no tree left to walk, which is exactly why this is
  // called instead of `child.kill()` rather than after it. The first version
  // of this test killed the parent first and then wondered why the children
  // survived.
  const second = spawn(
    'cmd.exe',
    ['/d', '/c', 'ping', '-n', '120', '127.0.0.1'],
    { windowsHide: true, stdio: 'ignore' },
  );
  await wait(1200);

  const secondPid = second.pid!;
  const secondKids = childrenOf(secondPid);
  check('a second tree started', secondKids.length > 0);

  killTree(secondPid);
  await wait(2500);

  check(
    'killTree takes the whole tree with it',
    secondKids.every((kid) => !alive(kid)),
    `still alive: ${JSON.stringify(secondKids.filter(alive))}`,
  );
  check('and the parent too', !alive(secondPid));

  for (const kid of secondKids.filter(alive)) killTree(kid);

  console.log('\n\x1b[1mIt is safe to call in the situations it is called in\x1b[0m');

  killTree(undefined);
  check('a process that never started is not an error', true);

  let fellBack = false;
  killTree(999_999_999, () => { fellBack = true; });
  await wait(600);
  check('a pid that does not exist does not throw', true);
  void fellBack;
}

main().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
});
