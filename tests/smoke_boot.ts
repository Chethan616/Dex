/**
 * Does Dex actually start?
 *
 * Written after `npm run dev` was broken for an entire slice without a single
 * test noticing. Every other suite imports the pieces directly, so nothing ever
 * executed `src/main.ts` — and a module-level `const` declared below `main()`
 * threw ReferenceError from its temporal dead zone on every single start.
 *
 * Type-checking cannot catch that: the code is well-typed, and only the
 * *ordering* is wrong. The only thing that catches it is starting the process.
 *
 * Deliberately shallow. It boots the real entry point, waits for the prompt,
 * sends "exit", and checks it left cleanly. No task is run, no key is required
 * beyond whatever is already configured.
 *
 * Run: npm run test:boot
 */
import './support/isolate';
import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';

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

interface BootResult {
  code: number | null;
  output: string;
}

function boot(): Promise<BootResult> {
  return new Promise((resolve) => {
    // `node` directly rather than `npx ts-node`: on Windows npx is a .cmd
    // shim, and spawning it without a shell fails with EINVAL.
    const child = spawn(
      process.execPath,
      ['-r', 'ts-node/register', 'src/main.ts'],
      {
        env: {
          ...process.env,
          // A disposable database, and no WebSocket port to collide with a
          // running instance.
          DEX_TEST: '1',
          DEX_DB: path.join(os.tmpdir(), `dex-boot-${Date.now()}.db`),
          DEX_UI_SERVER: 'false',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    let output = '';
    const collect = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      // The prompt means the CLI reached its loop — everything before it
      // constructed successfully.
      if (output.includes('dex>')) child.stdin.write('exit\n');
    };

    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: null, output: `${output}\n[timed out]` });
    }, 90_000);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

async function main(): Promise<void> {
  console.log('\x1b[1mBoot — does src/main.ts actually start?\x1b[0m\n');

  const { code, output } = await boot();

  check(
    'the process starts without throwing',
    !/ReferenceError|TypeError|SyntaxError|Cannot access/.test(output),
    firstError(output),
  );
  check(
    'it reaches the CLI prompt',
    output.includes('dex>'),
    'everything before the prompt has to construct successfully to get there',
  );
  check('it reports which Brain provider it will use', /\[brain\]/.test(output));
  check('it exits cleanly on "exit"', code === 0, `exit code ${code}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\n\x1b[90m--- output ---\x1b[0m');
    console.log(output.slice(-1600));
    process.exit(1);
  }
  console.log('\x1b[32mAll checks passed\x1b[0m');
  process.exit(0);
}

function firstError(output: string): string {
  const line = output
    .split('\n')
    .find((l) => /Error|Cannot access/.test(l));
  return line?.trim() ?? '';
}

void main();
