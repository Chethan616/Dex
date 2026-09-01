import './support/isolate';
/**
 * Retrieving a file from this PC while away from it.
 *
 *   npm run test:delivery
 *
 * "Download that zip and send it to me on WhatsApp" is two halves that have to
 * meet: something fetches a file, and something puts it in the conversation
 * that asked. The interesting failures are all at the seam.
 *
 * The property being defended, and the reason delivery is keyed by request id
 * rather than by channel:
 *
 *   **A file goes to the conversation that asked for it, and nowhere else.**
 *
 * Dex has one owner and several open chats. A plan that says "send it to me"
 * must not be able to choose which one, because the thing writing plans reads
 * web pages.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { delivery } from '../core/delivery/registry';
import { DeliveryAgent } from '../agents/delivery/delivery_agent';
import { downloadFile } from '../agents/files/file_ops';
import { DELIVERY_ACTIONS, FILE_ACTIONS, CAPABILITY_NAMES, capabilityCatalogue } from '../core/brain/capabilities';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`ok   ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

async function throwsAsync(label: string, fn: () => Promise<unknown>, expected: RegExp): Promise<void> {
  try {
    await fn();
    check(label, false, 'did not throw');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    check(label, expected.test(message), message);
  }
}

/** A stand-in chat that records what it was given. */
function fakeChat(source: string) {
  const sent: string[] = [];
  const files: Array<{ path: string; caption?: string }> = [];
  return {
    sent,
    files,
    target: {
      source,
      send: async (text: string) => {
        sent.push(text);
        return undefined;
      },
      sendFile: async (filePath: string, caption?: string) => {
        files.push({ path: filePath, caption });
      },
    },
  };
}

async function main(): Promise<void> {
  const agent = new DeliveryAgent();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-delivery-'));

  // The delivery agent only accepts paths inside the profile, so the fixture
  // has to live there too — the same boundary every file action uses.
  const home = os.homedir();
  const fixtureDir = path.join(home, 'Dex', 'test-delivery');
  fs.mkdirSync(fixtureDir, { recursive: true });
  const fixture = path.join(fixtureDir, 'report.zip');
  fs.writeFileSync(fixture, Buffer.alloc(2048, 7));

  console.log('— a file goes to the chat that asked —');

  {
    const whatsapp = fakeChat('whatsapp');
    const telegram = fakeChat('telegram');
    delivery.register('req-A', whatsapp.target);
    delivery.register('req-B', telegram.target);

    const result = await agent.execute('send_file', { path: fixture }, 'req-A', 's1');
    check('the send succeeds', result.success, result.error ?? '');
    check('it went to WhatsApp', whatsapp.files.length === 1, JSON.stringify(whatsapp.files));
    check(
      'and NOT to the other open conversation',
      telegram.files.length === 0,
      'a file reached a chat that did not ask for it',
    );
    check(
      'the result names where it went',
      (result.data as Record<string, unknown>)?.to === 'whatsapp',
    );

    delivery.release('req-A');
    delivery.release('req-B');
  }

  {
    // Release must actually release. A stale target is a live socket to a chat
    // that a later, unrelated task could deliver into.
    const chat = fakeChat('whatsapp');
    delivery.register('req-C', chat.target);
    delivery.release('req-C');
    const result = await agent.execute('send_file', { path: fixture }, 'req-C', 's1');
    check(
      'a released request has nowhere to send',
      (result.data as Record<string, unknown>)?.delivered === false,
    );
    check('and nothing was sent', chat.files.length === 0);
  }

  console.log('\n— when there is no chat, say where the file is —');

  {
    // The desktop app and the CLI. The task genuinely produced the file and
    // the owner is at the machine it is on, so reporting the path is the
    // truthful outcome — not a failure, and certainly not a pretend success.
    const result = await agent.execute('send_file', { path: fixture }, 'req-none', 's1');
    check('it does not fail', result.success);
    const data = result.data as Record<string, unknown>;
    check('but does not claim delivery', data.delivered === false);
    check('and gives the path', String(data.path).endsWith('report.zip'));
  }

  {
    // A channel that can receive messages but not files.
    const textOnly = {
      source: 'sms',
      send: async (text: string) => {
        (textOnly as unknown as { said: string[] }).said.push(text);
        return undefined;
      },
      said: [] as string[],
    };
    delivery.register('req-D', textOnly);
    const result = await agent.execute('send_file', { path: fixture }, 'req-D', 's1');
    check('a text-only channel does not fail the task', result.success);
    check(
      'and the owner is told where the file is instead',
      textOnly.said.some((m) => m.includes(fixture)),
      JSON.stringify(textOnly.said),
    );
    delivery.release('req-D');
  }

  console.log('\n— refusals —');

  {
    const chat = fakeChat('whatsapp');
    delivery.register('req-E', chat.target);

    const outside = await agent.execute(
      'send_file', { path: 'C:\\Windows\\System32\\drivers\\etc\\hosts' }, 'req-E', 's1',
    );
    check(
      'a file outside the profile is refused',
      !outside.success,
      'delivery would be a way around the file boundary',
    );

    const folder = await agent.execute('send_file', { path: fixtureDir }, 'req-E', 's1');
    check('a folder is refused with advice', !folder.success && /[Cc]ompress/.test(folder.error ?? ''));

    delivery.release('req-E');
  }

  console.log('\n— downloading —');

  await throwsAsync(
    'file:// is refused',
    () => downloadFile({ url: 'file:///C:/Windows/win.ini' }),
    /not a web address/,
  );
  await throwsAsync(
    'a non-URL is refused',
    () => downloadFile({ url: 'not a url' }),
    /Not a URL/,
  );

  {
    // A real fetch, against a URL that will not exist, to prove the failure
    // path reports the server rather than a stack trace.
    await throwsAsync(
      'a 404 says which host refused',
      () => downloadFile({ url: 'https://example.com/definitely-not-here-xyz.zip' }),
      /example\.com answered|fetch failed|getaddrinfo/,
    );
  }

  console.log('\n— the planner is told this is possible —');

  check('send_file is advertised', 'send_file' in DELIVERY_ACTIONS);
  check('download_file is advertised', 'download_file' in FILE_ACTIONS);
  check(
    'can_deliver is a capability the planner may name',
    (CAPABILITY_NAMES as readonly string[]).includes('can_deliver'),
  );
  check(
    'and it is described in the prompt',
    capabilityCatalogue().includes('CAPABILITY: can_deliver'),
  );
  check(
    'with the two-step recipe spelled out, since neither half is obvious alone',
    /download_file\s+then\s+send_file/.test(capabilityCatalogue()),
  );
  check(
    'send_file warns that the desktop app has nowhere to send',
    /desktop app/.test(DELIVERY_ACTIONS.send_file.note ?? ''),
  );

  fs.rmSync(fixtureDir, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log();
  console.log(failures === 0
    ? 'PASSED  a file reaches the conversation that asked for it.'
    : `${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
