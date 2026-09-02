/**
 * What a non-zero exit code actually means.
 *
 *     npm run test:exit-codes
 *
 * The failure this exists for, with the real numbers: asked to set up a C
 * compiler, Dex ran `winget install --id LLVM.LLVM`, got `2316632107`, called
 * it a failure, retried the identical command, got the same code, and gave up
 * after a minute and forty-four seconds. `0x8A15002B` means *the package is
 * already installed and there is no upgrade to apply* — which is the state the
 * plan wanted, reported as an error.
 *
 * Two properties carry the weight here, and the second is the one that cost the
 * time:
 *
 *   - a recognised "nothing to do" code **verifies**, and
 *   - it is **never retried**, because the second attempt returns the same code
 *     by definition.
 *
 * Everything not in the table is still a failure. This is a list of known
 * exceptions, not a reason to stop trusting exit codes — so the last group
 * matters as much as the first.
 */
import assert from 'assert';
import { meaningOf, worthRetrying } from '../core/reliability/exit_codes';

let failures = 0;
function check(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok   ${label}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL ${label}\n     ${err instanceof Error ? err.message : err}`);
  }
}

const WINGET = ['winget', 'install', '--id', 'LLVM.LLVM', '-e'];

console.log('— the exact failure from the screenshot —');

check('2316632107 is "already installed", not a failure', () => {
  const meaning = meaningOf(WINGET, 2316632107);
  assert.ok(meaning, 'still treated as a failure');
  assert.strictEqual(meaning.kind, 'satisfied');
  assert.ok(/already installed/i.test(meaning.reason), meaning.reason);
});

check('and it is never retried', () => {
  // This is where the minute and forty-four seconds went.
  assert.strictEqual(worthRetrying(WINGET, 2316632107), false);
});

check('2316632080 — no applicable installer — is still a real failure', () => {
  // Caused by `--scope user` on a machine-scope package. A real problem with a
  // real cause, and not something to paper over.
  assert.strictEqual(meaningOf(WINGET, 2316632080), undefined);
});

console.log('\n— the sign of the code does not matter —');

check('the signed form resolves', () => {
  assert.ok(meaningOf(WINGET, 0x8A150061 | 0));
});

check('and so does the unsigned form', () => {
  // A process exit code arrives unsigned; JavaScript sign-extends the high bit
  // of an HRESULT. A lookup that handled only one of those would miss half the
  // time depending on where the number came from.
  assert.ok(meaningOf(WINGET, 0x8A150061 >>> 0));
});

console.log('\n— programs that use exit codes to say something —');

check('robocopy under 8 is success', () => {
  for (const code of [1, 2, 3, 7]) {
    assert.ok(meaningOf(['robocopy', 'a', 'b'], code), `robocopy ${code} failed`);
  }
});

check('robocopy 8 and above is not', () => {
  for (const code of [8, 16]) {
    assert.strictEqual(meaningOf(['robocopy', 'a', 'b'], code), undefined);
  }
});

check('findstr 1 means no match, which is an answer', () => {
  assert.ok(meaningOf(['findstr', 'needle', 'file.txt'], 1));
});

check('diff 1 means the files differ, which is an answer', () => {
  assert.ok(meaningOf(['diff', 'a', 'b'], 1));
});

console.log('\n— and everything else is still a failure —');

check('a compiler that could not compile', () => {
  assert.strictEqual(meaningOf(['gcc', 'main.c'], 1), undefined);
  assert.strictEqual(worthRetrying(['gcc', 'main.c'], 1), true);
});

check('a program not in the table', () => {
  assert.strictEqual(meaningOf(['some-tool', '--go'], 3), undefined);
});

check('a winget code that is not one of the known ones', () => {
  assert.strictEqual(meaningOf(WINGET, 1), undefined);
});

check('findstr 2 — a real error — is not excused', () => {
  // 1 is "no match"; 2 is "bad arguments". Excusing the whole program rather
  // than the specific code is how a table like this stops being a boundary.
  assert.strictEqual(meaningOf(['findstr', 'x'], 2), undefined);
});

console.log('\n— the program is found however it was written —');

check('a full path resolves to the program', () => {
  assert.ok(meaningOf(['C:\\Windows\\System32\\winget.exe', 'install'], 2316632107));
});

check('a command given as one string works too', () => {
  assert.ok(meaningOf('winget install --id LLVM.LLVM', 2316632107));
});

check('nothing sensible in, nothing rash out', () => {
  assert.strictEqual(meaningOf(undefined, 1), undefined);
  assert.strictEqual(meaningOf([], 1), undefined);
  assert.strictEqual(meaningOf('', 1), undefined);
  // Unknown means retryable, which is the safe direction: the old behaviour.
  assert.strictEqual(worthRetrying(undefined, 1), true);
});

console.log();
if (failures > 0) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('PASSED  a non-zero exit is read for what it means, and "already done" is not retried.');
