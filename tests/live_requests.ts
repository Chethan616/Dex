/**
 * Drive real requests through the running core and print what the owner sees.
 *
 *   npx ts-node tests/live_requests.ts "whats my power plan" "what can u do"
 *
 * Not part of the test suite: it needs a live core, a live daemon, and a model
 * with quota, so it can fail for reasons that have nothing to do with the code.
 * It exists because the failures this release fixes were all found by *using*
 * Dex, and the only way to know they are fixed is to use it again — the same
 * five sentences from the screenshots, through the same path the Dex Bar takes.
 *
 * Connects the way the Dex Bar does, through the handshake file, so it proves
 * the same route rather than a convenient one.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import WebSocket from 'ws';

/**
 * `answers: true` means this request asks a question, so finishing without
 * telling the owner anything is a failure. A request that *does* something —
 * opening a browser, setting the volume — correctly reports what it did and
 * has nothing to answer.
 */
const DEFAULT_REQUESTS: { text: string; answers: boolean }[] = [
  { text: 'whats my power plan', answers: true },
  { text: 'what is my dns', answers: true },
  { text: 'what can u do', answers: true },
  { text: 'who are you', answers: true },
  { text: 'open any browser', answers: false },
];

const dim = (s: string): string => `\x1b[90m${s}\x1b[0m`;
const bold = (s: string): string => `\x1b[1m${s}\x1b[0m`;
const green = (s: string): string => `\x1b[32m${s}\x1b[0m`;
const red = (s: string): string => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string): string => `\x1b[36m${s}\x1b[0m`;

function handshake(): { port: number; token: string } {
  const base =
    process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  const file = path.join(base, 'DEX', 'ui.json');
  if (!fs.existsSync(file)) {
    throw new Error(`No handshake at ${file} — is Dex running?`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main(): Promise<void> {
  // A request given on the command line is assumed to be a question, since
  // that is what someone checking by hand is almost always testing.
  const requests = process.argv.slice(2).length
    ? process.argv.slice(2).map((text) => ({ text, answers: true }))
    : DEFAULT_REQUESTS;

  const { port, token } = handshake();
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);

  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'auth', token }));

  let failures = 0;

  for (const { text, answers } of requests) {
    console.log(`\n${bold(`you> ${text}`)}`);

    const result = await new Promise<Record<string, unknown>>((resolve) => {
      const onMessage = (raw: WebSocket.RawData): void => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'event') {
          const e = msg.event;
          // Only the lines a person would read, not every internal step.
          if (['thinking', 'planning', 'failed', 'awaiting'].includes(e.type)) {
            console.log(dim(`     ${e.type.padEnd(9)} ${e.message}`));
          }
        }
        if (msg.type === 'result') {
          socket.off('message', onMessage);
          resolve(msg);
        }
      };
      socket.on('message', onMessage);
      socket.send(JSON.stringify({ type: 'submit', text }));
    });

    const status = String(result.status);
    const answer = result.answer as string | undefined;

    if (status === 'FAILED') {
      failures += 1;
      console.log(red(`     FAILED   ${result.summary}`));
    } else if (answer) {
      console.log(green(`     ${status.padEnd(9)}`) + ` ${cyan(answer)}`);
    } else if (answers) {
      // The exact defect this release fixes: a question that succeeded and
      // said nothing about what it found.
      console.log(green(`     ${status.padEnd(9)}`) + ` ${result.summary}`);
      console.log(red('     ^ asked a question and got no answer'));
      failures += 1;
    } else {
      // An action reports what it did. There is nothing to answer.
      console.log(green(`     ${status.padEnd(9)}`) + ` ${result.summary}`);
    }
  }

  socket.close();
  console.log(
    failures === 0
      ? `\n${green('Every request produced an answer.')}`
      : `\n${red(`${failures} request(s) failed or answered nothing.`)}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error(red(String(err)));
  process.exit(1);
});
