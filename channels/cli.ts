import * as readline from 'readline';
import { Gateway } from '../core/gateway';
import { bus } from '../core/events/bus';
import { DexEvent, ConfirmationRequest } from '../core/events/types';
import { ConfirmationManager } from '../core/confirmation/confirmation_manager';

const COLOR: Record<string, string> = {
  thinking:  '\x1b[90m',
  routing:   '\x1b[90m',
  planning:  '\x1b[36m',
  selecting: '\x1b[33m',
  executing: '\x1b[34m',
  retrying:  '\x1b[33m',
  awaiting:  '\x1b[35m',
  cancelled: '\x1b[35m',
  done:      '\x1b[32m',
  failed:    '\x1b[31m',
  reset:     '\x1b[0m',
};

function printEvent(event: DexEvent): void {
  const c = COLOR[event.type] ?? COLOR.reset;
  const prefix = event.stepId ? `[${event.type}:${event.stepId}]` : `[${event.type}]`;
  process.stdout.write(`${c}${prefix}${COLOR.reset} ${event.message}\n`);
}

const TIER_LABEL: Record<number, string> = {
  1: 'HAND-OFF — you need to do this part',
  2: 'CONFIRM — always asks',
  3: 'PRE-APPROVE — once per session',
  4: 'SILENT',
};

export async function startCli(
  gateway: Gateway,
  confirmations: ConfirmationManager,
): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // Lines are queued rather than pulled one at a time with rl.question().
  //
  // Piped input ends the stream as soon as it has been buffered, so `close`
  // fires while lines are still unread. Treating close as "no more input"
  // silently dropped every command after the first —
  // `printf 'a\nb\nc\n' | npm run dev` ran only `a` and exited looking healthy.
  // Draining the queue before honouring close fixes that, and behaves
  // identically when a person is typing.
  const queued: string[] = [];
  let waiting: ((line: string | null) => void) | null = null;
  let closed = false;

  rl.on('line', (line) => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(line);
    } else {
      queued.push(line);
    }
  });

  rl.on('close', () => {
    closed = true;
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(null);
    }
  });

  /** `null` means input is genuinely exhausted, not merely ended. */
  const ask = (prompt: string): Promise<string | null> => {
    if (queued.length > 0) return Promise.resolve(queued.shift() as string);
    if (closed) return Promise.resolve(null);
    process.stdout.write(prompt);
    return new Promise((resolve) => {
      waiting = resolve;
    });
  };

  // The CLI is an approval surface too — same manager, same version check.
  confirmations.registerProvider({
    name: 'cli',
    present: (request: ConfirmationRequest) => {
      void promptForApproval(request);
    },
    withdraw: () => {
      /* CLI prompt resolves inline; nothing to tear down */
    },
  });

  async function promptForApproval(request: ConfirmationRequest): Promise<void> {
    process.stdout.write(
      `\n${COLOR.awaiting}┌─ ${request.tier === 1 ? 'Over to you' : 'Approval needed'}${COLOR.reset}\n` +
        `${COLOR.awaiting}│${COLOR.reset} Tier ${request.tier} — ${TIER_LABEL[request.tier]}\n` +
        `${COLOR.awaiting}│${COLOR.reset} ${request.capability}:${request.action}\n` +
        `${COLOR.awaiting}│${COLOR.reset} ${request.description}\n` +
        `${COLOR.awaiting}└─${COLOR.reset}\n`,
    );

    // Tier 1 has nothing to approve — the owner does it, then DEX continues.
    // Tier 3 can be waved through for the session. Tier 2 always re-asks.
    const prompt = request.tier === 1
      ? 'done? [y/N] '
      : request.tier === 3
        ? 'approve? [y]es / [s]ession / [N]o '
        : 'approve? [y/N] ';

    // stdin gone mid-approval: nobody is there to say yes, so this is a
    // rejection. Defaulting to approval because the pipe closed would be the
    // worst possible reading of silence.
    const raw = await ask(prompt);
    const answer = (raw ?? '').trim().toLowerCase();

    const verdict = request.tier === 1
      ? (answer.startsWith('y') ? 'handed_off' : 'rejected')
      : answer === 's' || answer === 'session'
        ? 'approved_session'
        : answer.startsWith('y')
          ? 'approved'
          : 'rejected';

    confirmations.respond(request.requestId, request.stepId, request.stepVersion, verdict);
  }

  console.log('\x1b[1mDEX V3\x1b[0m  natural language, or:');
  console.log(
    '\x1b[90m  /save <name>   save the last task as a workflow\n' +
      '  /workflows     list saved workflows      /forget <name>\n' +
      '  /history [q]   what you have asked       /stats [days]\n' +
      '  run <name> …   replay a workflow         exit\x1b[0m\n',
  );

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const answer = await ask('dex> ');
    if (answer === null) {
      console.log('');
      rl.close();
      return;
    }
    const raw = answer.trim();
    if (!raw) continue;
    if (raw === 'exit' || raw === 'quit') {
      rl.close();
      process.exit(0);
    }

    if (raw.startsWith('/')) {
      handleLocalCommand(gateway, raw);
      continue;
    }

    // Subscribe to all events before calling handle so we catch every emission
    const unsub = bus.subscribeAll(printEvent);
    const result = await gateway.handle('cli', 'local_owner', raw);
    unsub();

    console.log(`\n\x1b[90mStatus: ${result.status}${
      result.workflow ? ` — via workflow "${result.workflow}"` : ''
    }\x1b[0m`);

    // Noticing repetition is the whole point of keeping the history; offering
    // beats waiting to be asked.
    if (result.suggestSave) {
      console.log(
        `\x1b[36m  You've done this ${result.suggestSave.times} times. ` +
          `Save it: /save <name>\x1b[0m`,
      );
    }
    console.log('');
  }
}

/**
 * Commands that never reach the Brain: history, stats and workflow management.
 * Kept out of the natural-language path deliberately — "/stats" should show
 * statistics, not be interpreted as a request to do something about them.
 */
function handleLocalCommand(gateway: Gateway, raw: string): void {
  const [command, ...rest] = raw.slice(1).split(/\s+/);
  const arg = rest.join(' ').trim();
  const dim = (s: string) => `\x1b[90m${s}\x1b[0m`;

  switch (command) {
    case 'save': {
      if (!arg) {
        const last = gateway.lastSaveable;
        console.log(
          last
            ? `Usage: /save <name>   (would save: "${last.text}", ${last.steps} step(s))`
            : 'Nothing to save yet — run a task first.',
        );
        return;
      }
      const [name, ...desc] = arg.split(/\s+/);
      try {
        const saved = gateway.saveLast(name, desc.join(' ') || undefined);
        console.log(`\x1b[32mSaved\x1b[0m "${saved.name}" — ${saved.template.length} step(s)`);
        console.log(
          saved.params.length
            ? dim(`  run ${saved.name} ${saved.params.map((p) => `<${p}>`).join(' ')}`)
            : dim(`  run ${saved.name}`),
        );
      } catch (err) {
        console.log(`\x1b[31m${err instanceof Error ? err.message : err}\x1b[0m`);
      }
      return;
    }

    case 'workflows': {
      const all = gateway.workflowStore.list();
      if (all.length === 0) {
        console.log(dim('No saved workflows yet. Run something, then /save <name>.'));
        return;
      }
      for (const w of all) {
        const args = w.params.map((p) => `<${p}>`).join(' ');
        console.log(`  \x1b[1m${w.name}\x1b[0m ${dim(args)}`);
        console.log(dim(`     ${w.description}`));
        console.log(dim(`     ${w.template.length} step(s) · run ${w.runCount}×`));
      }
      return;
    }

    case 'forget': {
      if (!arg) return console.log('Usage: /forget <name>');
      console.log(
        gateway.workflowStore.delete(arg) ? `Forgot "${arg}".` : `No workflow named "${arg}".`,
      );
      return;
    }

    case 'history': {
      const rows = arg
        ? gateway.telemetryStore.search(arg)
        : gateway.telemetryStore.recent();
      if (rows.length === 0) return console.log(dim('Nothing recorded yet.'));
      for (const r of rows) {
        const when = new Date(r.startedAt).toLocaleString();
        const mark = r.status === 'COMPLETED' ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
        const via = r.workflow ? dim(` [${r.workflow}]`) : '';
        console.log(`  ${mark} ${dim(when)}  ${r.text}${via}`);
      }
      return;
    }

    case 'stats': {
      const days = Number(arg) || 7;
      const s = gateway.telemetryStore.summary(days);
      console.log(`\x1b[1mLast ${days} day(s)\x1b[0m`);
      console.log(
        `  ${s.totalTasks} tasks — ${s.completed} completed, ${s.failed} failed, ${s.cancelled} cancelled`,
      );
      console.log(
        `  ${s.brainCalls} planned by the Brain, ${s.workflowRuns} replayed from workflows` +
          (s.workflowRuns ? dim(`  (${s.workflowRuns} planning calls avoided)`) : ''),
      );
      if (s.byDay.length) {
        console.log('\n  Per day');
        const peak = Math.max(...s.byDay.map((d) => d.tasks));
        for (const d of s.byDay) {
          console.log(`    ${d.day}  ${'█'.repeat(Math.ceil((d.tasks / peak) * 24))} ${d.tasks}`);
        }
      }
      if (s.topActions.length) {
        console.log('\n  Most used');
        for (const a of s.topActions) {
          const fail = a.failures ? ` \x1b[31m${a.failures} failed\x1b[0m` : '';
          console.log(`    ${a.runs}× ${a.action} ${dim(a.capability)}${fail}`);
        }
      }
      const worth = s.repeated.filter((r) => !r.saved && r.times >= 2);
      if (worth.length) {
        console.log('\n  Repeated, not yet saved');
        for (const r of worth) console.log(`    ${r.times}×  "${r.example}"`);
      }
      return;
    }

    default:
      console.log(dim('Unknown command. Try /save /workflows /forget /history /stats'));
  }
}
