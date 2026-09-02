/**
 * What a non-zero exit code actually means.
 *
 * Verification treated every non-zero exit as a failure, which is true of most
 * programs and false of exactly the ones an install plan uses. Asked to set up
 * a C compiler, Dex ran winget, got `2316632107`, called it a failure, retried
 * the identical command, got it again, and gave up after a minute and
 * forty-four seconds. That code is `0x8A15002B` — *the package is already
 * installed and there is no upgrade to apply*. It is the plan's goal, reported
 * as an error.
 *
 * So a table, not a special case. The convention that zero means success and
 * everything else means failure is a convention, and a familiar set of tools
 * break it deliberately:
 *
 *   winget      a whole HRESULT range, several of which mean "nothing to do"
 *   robocopy    below 8 is success; it uses the low bits as a summary
 *   diff / fc   1 means the files differ, which is an answer
 *   findstr     1 means no match, which is also an answer
 *   grep        same
 *
 * Two shapes of verdict, and the difference matters more than the codes:
 *
 *   `satisfied`  the goal already holds. Verified, and **never retried** —
 *                a second attempt returns the identical code by definition,
 *                so retrying only spends the owner's time.
 *   `informational` the command ran correctly and is reporting a fact through
 *                its exit code. Verified.
 *
 * Anything not in the table is still a failure. This is a list of known
 * exceptions, not a reason to stop trusting exit codes.
 */

export interface ExitMeaning {
  /** 'satisfied' | 'informational' — see the note above. */
  kind: 'satisfied' | 'informational';
  /** Said to the owner, in place of the raw number. */
  reason: string;
}

interface Rule {
  /** Matched against the program name, lowercased, without .exe. */
  program: RegExp;
  codes: Map<number, ExitMeaning>;
  /** For programs whose success is a range rather than a set. */
  range?: (code: number) => ExitMeaning | undefined;
}

/**
 * winget's documented HRESULTs.
 *
 * The whole family is `0x8A15xxxx`. Only the ones that mean the plan can carry
 * on are here — an install that genuinely failed still fails.
 */
const WINGET = new Map<number, ExitMeaning>([
  [0x8A15002B | 0, {
    kind: 'satisfied',
    reason: 'it is already installed and up to date',
  }],
  [0x8A150061 | 0, {
    kind: 'satisfied',
    reason: 'it is already installed',
  }],
  [0x8A15010C | 0, {
    kind: 'satisfied',
    reason: 'no applicable upgrade — the installed version is current',
  }],
  [0x8A150056 | 0, {
    kind: 'informational',
    reason: 'a reboot is required to finish, but the install itself succeeded',
  }],
]);

const RULES: Rule[] = [
  {
    program: /^winget$/,
    // JavaScript sign-extends the high bit; a process exit code arrives
    // unsigned. Both forms are accepted so the lookup cannot miss on a sign.
    codes: new Map([...WINGET, ...[...WINGET].map(
      ([code, meaning]) => [code >>> 0, meaning] as [number, ExitMeaning],
    )]),
  },
  {
    program: /^robocopy$/,
    codes: new Map(),
    // 0-7 are success; the bits say what was copied. 8 and above is a genuine
    // failure, and this is documented behaviour rather than a quirk.
    range: (code) => (code < 8
      ? { kind: 'informational', reason: `robocopy finished (status ${code})` }
      : undefined),
  },
  {
    program: /^(diff|fc|comp)$/,
    codes: new Map([[1, {
      kind: 'informational',
      reason: 'the files differ — which is the answer, not an error',
    }]]),
  },
  {
    program: /^(findstr|find|grep|rg|ripgrep)$/,
    codes: new Map([[1, {
      kind: 'informational',
      reason: 'nothing matched — which is an answer, not an error',
    }]]),
  },
];

/**
 * What this exit code means for this command, or undefined for "a failure".
 *
 * `command` is the argv the step ran, so the program is its first element.
 * Passing the whole thing rather than a program name keeps the caller from
 * having to parse it, and keeps the parsing in one place.
 */
export function meaningOf(
  command: unknown,
  code: number,
): ExitMeaning | undefined {
  const program = programOf(command);
  if (!program) return undefined;

  for (const rule of RULES) {
    if (!rule.program.test(program)) continue;
    const known = rule.codes.get(code) ?? rule.codes.get(code >>> 0);
    if (known) return known;
    if (rule.range) return rule.range(code);
    return undefined;
  }
  return undefined;
}

/**
 * Whether a step that exited this way is worth running again.
 *
 * "Already installed" is the clearest possible no: the state the command was
 * asked to reach already holds, so a second attempt returns the same code. The
 * retry that followed this exact code is most of where the minute and
 * forty-four seconds went.
 */
export function worthRetrying(command: unknown, code: number): boolean {
  return meaningOf(command, code)?.kind !== 'satisfied';
}

function programOf(command: unknown): string | null {
  const first = Array.isArray(command)
    ? command[0]
    : typeof command === 'string'
      ? command.trim().split(/\s+/)[0]
      : null;
  if (typeof first !== 'string' || !first) return null;

  // `C:\Windows\System32\winget.exe` and `winget` are the same program.
  const leaf = first.split(/[\\/]/).pop() ?? first;
  return leaf.toLowerCase().replace(/\.(exe|com|cmd|bat)$/, '');
}
