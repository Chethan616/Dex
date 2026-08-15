import * as readline from 'readline';
import { Gateway } from '../core/gateway';
import { bus } from '../core/events/bus';
import { DexEvent } from '../core/events/types';

const COLOR: Record<string, string> = {
  thinking:  '\x1b[90m',
  routing:   '\x1b[90m',
  planning:  '\x1b[36m',
  selecting: '\x1b[33m',
  executing: '\x1b[34m',
  retrying:  '\x1b[33m',
  done:      '\x1b[32m',
  failed:    '\x1b[31m',
  reset:     '\x1b[0m',
};

function printEvent(event: DexEvent): void {
  const c = COLOR[event.type] ?? COLOR.reset;
  const prefix = event.stepId ? `[${event.type}:${event.stepId}]` : `[${event.type}]`;
  process.stdout.write(`${c}${prefix}${COLOR.reset} ${event.message}\n`);
}

export async function startCli(gateway: Gateway): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = (): Promise<string> =>
    new Promise((resolve) => rl.question('dex> ', resolve));

  console.log('\x1b[1mDEX V3\x1b[0m  Slice 1 — Core Loop');
  console.log('Type a command or "exit" to quit.\n');

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const raw = (await ask()).trim();
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
