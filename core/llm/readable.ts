/**
 * Turning extracted text into something a person can read.
 *
 * What the owner saw, verbatim, from a one-page Aadhaar PDF:
 *
 *     రిజి□□□షన్ / Enrolment  No .: 0014/02310/04085
 *     To
 *     మని□□ండ  చేతన్  □□ఫ□
 *     Manikonda  Chethan  KrishnaC / O : M  V  Raghavendra  Prasad ,13-12-95
 *     Kodanda  Ram  Nagar ,P and T Colony ,Dilsukh  Nagar ,VTC : Saroornagar…
 *
 * Every character of that is really in the file. PDF text extraction gives no
 * layout, doubles its spaces, runs fields together, and turns glyphs a font
 * could not map into boxes — so a document that is perfectly legible on screen
 * comes out as a wall. Printing it is honest and useless.
 *
 * **A small model, on purpose, whatever the owner has chosen.** This is
 * reformatting, not reasoning: the facts are all present and the job is to lay
 * them out. Spending Opus on that would cost the owner real money to do badly
 * what Haiku does instantly. The configured model is deliberately ignored, and
 * that is worth saying out loud because it is the one place in Dex that
 * overrides the owner's choice.
 *
 * **It never adds anything.** The prompt says so and the fallback enforces it:
 * if the model returns nothing, or returns more than the input could support,
 * the original text is kept. A tidy summary that invented a postcode would be
 * worse than the wall.
 */
import { spawn } from 'child_process';
import { resolveCommand } from '../settings/which';
import { killTree } from './kill_tree';
import { cliEnvironment } from './providers';
import { lastAssistantText } from './vision';

/** Below this there is nothing to tidy. */
const MIN_CHARS = 200;

/** Above this it is a document, not a card, and summarising would lose things. */
const MAX_CHARS = 12_000;

const TIMEOUT_MS = 45_000;

const PROMPT = `You are formatting text that was extracted from a document.
Extraction loses layout: spaces are doubled, fields run together, and glyphs a
font could not map appear as boxes. Your job is to lay the SAME information out
so a person can read it.

Rules:
- Add nothing. Every name, number, date and address must already be in the input.
- Remove nothing that carries meaning. Dropped digits are worse than ugly text.
- Where a value is unreadable in the input, leave it out rather than guessing.
- Use short labelled lines. No preamble, no commentary, no markdown headings.
- Keep it in the language it is written in.

The text:

`;

export interface Readable {
  text: string;
  /** True when a model actually reformatted it. */
  tidied: boolean;
  reason?: string;
}

/**
 * Make extracted text readable, or return it unchanged.
 *
 * Never throws. This runs on the way to showing the owner something they can
 * already see; a failure here means they see the raw version, which is what
 * they saw before this existed.
 */
export async function makeReadable(
  raw: string,
  { cliPath = 'claude', signal }: { cliPath?: string; signal?: AbortSignal } = {},
): Promise<Readable> {
  const text = (raw ?? '').trim();

  if (text.length < MIN_CHARS) {
    return { text, tidied: false, reason: 'short enough already' };
  }
  if (text.length > MAX_CHARS) {
    // Reformatting a whole book is a different job with a different failure
    // mode — it would summarise, and summarising is where things get dropped.
    return { text, tidied: false, reason: 'too long to reformat safely' };
  }

  const tidy = await ask(PROMPT + text, cliPath, signal);
  if (!tidy) return { text, tidied: false, reason: 'the model returned nothing' };

  // A guard against the failure that matters. Reformatting cannot invent
  // content, so a result much longer than its input is a model that has
  // started writing rather than laying out.
  if (tidy.length > text.length * 1.4) {
    return { text, tidied: false, reason: 'the model added to it, so the original is kept' };
  }

  return { text: tidy, tidied: true };
}

function ask(prompt: string, cliPath: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve('');
      return;
    }

    // Haiku, always. See the note at the top: this is layout work, and the
    // owner choosing Opus for planning is not a request to spend Opus on
    // tidying a page of extracted text.
    const invocation = resolveCommand(cliPath, [
      '--print',
      '--output-format', 'stream-json',
      '--verbose',
      '--model', 'haiku',
      '--allowedTools', '',
    ]);
    if (!invocation) {
      resolve('');
      return;
    }

    let child;
    try {
      child = spawn(invocation.file, invocation.args, {
        windowsHide: true,
        env: cliEnvironment(),
      });
    } catch {
      resolve('');
      return;
    }

    let stdout = '';
    let settled = false;
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(value);
    };

    const timer = setTimeout(() => {
      killTree(child.pid, () => child.kill());
      finish('');
    }, TIMEOUT_MS);

    const onAbort = () => {
      killTree(child.pid, () => child.kill());
      finish('');
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.on('error', () => finish(''));
    child.on('close', () => finish(lastAssistantText(stdout)));

    // On stdin, not as an argument. The CLI is reached through `cmd.exe /d /c
    // claude.cmd`, and a multi-line prompt does not survive that — the first
    // version passed it as an argument and the CLI answered "Input must be
    // provided either through stdin or as a prompt argument", having received
    // neither.
    child.stdin.end(prompt);
  });
}
