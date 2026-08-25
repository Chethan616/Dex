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

  // `null` means stdin closed. That is how a piped run ends
  // (`echo "..." | npm run dev`), so it has to unwind cleanly rather than
  // throwing ERR_USE_AFTER_CLOSE out of a bare readline callback.
  let stdinClosed = false;
  rl.on('close', () => { stdinClosed = true; });

  const ask = (prompt: string): Promise<string | null> =>
    new Promise((resolve) => {
      if (stdinClosed) return resolve(null);
      rl.once('close', () => resolve(null));
      rl.question(prompt, resolve);
    });

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

  console.log('\x1b[1mDEX V3\x1b[0m  Slices 1–3 — core loop, desktop agent, live UI');
  console.log('Type a command or "exit" to quit.\n');

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

    // Subscribe to all events before calling handle so we catch every emission
    const unsub = bus.subscribeAll(printEvent);
    const result = await gateway.handle('cli', 'local_owner', raw);
    unsub();

    console.log(`\n\x1b[90mStatus: ${result.status}\x1b[0m\n`);
  }
}
