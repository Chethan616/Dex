import './support/isolate';
/**
 * Which tiers can actually work, asked before the plan.
 *
 *     npm run test:liveness
 *
 * The failure this exists for: asked to send a WhatsApp message, Dex planned
 * four steps, the fourth failed on the App tier, the Orchestrator escalated to
 * the vision tier — and the vision agent's server was not running, because
 * `desktopAgent: false` in Settings turns it off. Fifty-two seconds to discover
 * something knowable before the first word was planned.
 *
 * The distinction the whole file turns on: **registered is not running.** The
 * registry knew a DesktopAgent existed. Nothing knew its process did not.
 */
import assert from 'assert';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// The module reads settings at probe time, so the config has to be pointed
// somewhere disposable before it is imported.
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-liveness-'));
const configPath = path.join(configDir, 'settings.json');
process.env.DEX_CONFIG = configPath;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const liveness = require('../core/orchestrator/liveness') as
  typeof import('../core/orchestrator/liveness');

let failures = 0;
function check(label: string, condition: boolean, detail = ''): void {
  if (condition) console.log(`ok   ${label}`);
  else {
    failures += 1;
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function writeConfig(config: Record<string, unknown>): void {
  fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');
  liveness.forgetLiveness();
}

/** A socket on a real port, so "answering" means answering. */
function listenOn(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function main(): Promise<void> {
  console.log('— a tier switched off in Settings —');

  writeConfig({ desktopAgent: false, browserAgent: true });
  let statuses = await liveness.tierStatuses();
  const gui = statuses.find((s) => s.capability === 'can_control_gui');

  check('is reported as disabled, not down', gui?.state === 'disabled', gui?.state);
  check('and says it was a choice rather than a fault',
    /switched off in Settings/i.test(gui?.reason ?? ''), gui?.reason);
  check('with no "start it" instruction, because starting it is not the fix',
    gui?.fix === undefined);

  console.log('\n— a tier that should be up and is not —');

  writeConfig({ desktopAgent: true, browserAgent: true });
  statuses = await liveness.tierStatuses();
  const down = statuses.find((s) => s.capability === 'can_control_gui');

  // Nothing is listening on 8765 in a test run.
  check('is reported as down', down?.state === 'down', down?.state);
  check('and names the command that fixes it',
    (down?.fix ?? '').includes('agents/desktop/server.py'), down?.fix);

  console.log('\n— a tier that is actually answering —');

  writeConfig({ desktopAgent: true, browserAgent: true });
  const server = await listenOn(8765).catch(() => null);
  if (!server) {
    console.log('skip port 8765 is in use by something real');
  } else {
    liveness.forgetLiveness();
    const live = (await liveness.tierStatuses())
      .find((s) => s.capability === 'can_control_gui');
    check('is ready', live?.state === 'ready', live?.state);
    check('and says nothing, because there is nothing to say', live?.reason === '');
    server.close();
  }

  console.log('\n— what the planner is told —');

  writeConfig({ desktopAgent: false, browserAgent: false });
  const offline = await liveness.unavailable();
  check('every unavailable tier is listed', offline.length >= 2, `${offline.length}`);

  const described = liveness.describeUnavailable(offline);
  check('the vision tier is named', described.includes('can_control_gui'));
  check('the web tier is named', described.includes('can_browse_web'));
  check('and it says what to do instead of just refusing',
    /say so plainly/i.test(described));
  check('it does not name a tier that is fine',
    !described.includes('can_control_app'), described);

  check('nothing to report is an empty string, not a heading with no list',
    liveness.describeUnavailable([]) === '');

  console.log('\n— the escalation check —');

  writeConfig({ desktopAgent: false, browserAgent: true });
  const guiStatus = await liveness.statusOf('can_control_gui');
  check('a disabled tier is not ready', guiStatus.state !== 'ready');

  // The daemon and the file agent have no port and cannot be "not started".
  const osStatus = await liveness.statusOf('can_control_os');
  check('a tier with no separate process is always ready',
    osStatus.state === 'ready', osStatus.state);
  const madeUp = await liveness.statusOf('can_do_nonsense');
  check('and so is one nobody probes', madeUp.state === 'ready');

  console.log('\n— the cache —');

  writeConfig({ desktopAgent: false, browserAgent: true });
  const first = await liveness.tierStatuses();
  // Changing the file without forgetting must NOT be seen: the whole point of
  // the cache is that a probe per step is not paid.
  fs.writeFileSync(configPath, JSON.stringify({ desktopAgent: true }), 'utf8');
  const second = await liveness.tierStatuses();
  check('a repeated ask inside the window is the same answer',
    JSON.stringify(first) === JSON.stringify(second));

  liveness.forgetLiveness();
  const third = await liveness.tierStatuses();
  check('and forgetting it picks the change up',
    third.find((s) => s.capability === 'can_control_gui')?.state !== 'disabled');

  fs.rmSync(configDir, { recursive: true, force: true });

  console.log();
  if (failures > 0) {
    console.log(`${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('PASSED  a tier that cannot work is known before the plan, not after a timeout.');
}

void main();
