/**
 * Which tiers can actually work right now.
 *
 * Registration is not availability, and the difference cost fifty-two seconds
 * on screen. Asked to send a WhatsApp message, Dex planned four steps, the
 * fourth failed on the App tier, the Orchestrator escalated it to the vision
 * tier exactly as designed — and the vision agent's server was not running,
 * because `desktopAgent: false` in settings turns it off. The registry knew the
 * agent existed; nobody knew its process did not. So the plan was made, three
 * steps were spent, and the fourth waited out an HTTP timeout to discover
 * something knowable before the first word was planned.
 *
 * A tier is available when three things hold, and they fail differently:
 *
 *   registered   an agent claims the capability at all
 *   enabled      the owner has not switched it off in Settings
 *   answering    its process is actually listening
 *
 * "Off in Settings" and "should be on but is not" are different sentences and
 * get different ones. The first is a choice and is stated as one; the second is
 * a fault and comes with the command that fixes it.
 *
 * Cached briefly. This is asked once before planning and again before any
 * escalation, and a probe per step would add a round trip to every step for an
 * answer that changes at the speed of a person opening Settings.
 */
import { readConfig, reloadConfig } from '../settings/config_store';

export type TierState = 'ready' | 'disabled' | 'down' | 'absent';

export interface TierStatus {
  capability: string;
  state: TierState;
  /** Shown to the owner and given to the planner. Empty when ready. */
  reason: string;
  /** The one command that fixes a `down` tier. */
  fix?: string;
}

interface Probe {
  capability: string;
  /** The HTTP port its server listens on, when it has one. */
  port?: number;
  /** The settings flag that turns it off, when it has one. */
  setting?: 'desktopAgent' | 'browserAgent';
  label: string;
  fix?: string;
}

/**
 * Only the tiers that are a separate process.
 *
 * `can_control_os` goes through the daemon, which has its own reporting and is
 * required rather than optional. `can_control_files` runs in the core. Neither
 * can be "not started" in the way these three can.
 */
const PROBES: Probe[] = [
  {
    capability: 'can_control_app',
    port: 8767,
    label: 'the app tier (UI Automation)',
    fix: 'python agents/app/server.py',
  },
  {
    capability: 'can_browse_web',
    port: 8766,
    setting: 'browserAgent',
    label: 'the web tier',
    fix: 'python agents/browser/server.py',
  },
  {
    capability: 'can_control_gui',
    port: 8765,
    setting: 'desktopAgent',
    label: 'the vision tier',
    fix: 'python agents/desktop/server.py',
  },
];

const CACHE_MS = 15_000;

let cached: { at: number; statuses: TierStatus[] } | null = null;

/**
 * Forget what was probed. For tests, and after Settings changes a flag.
 *
 * Drops the settings cache too. A tier's availability is half a fact about the
 * network and half a fact about the config, and clearing only one of them
 * leaves the answer stale in exactly the case this is called for.
 */
export function forgetLiveness(): void {
  cached = null;
  reloadConfig();
}

export async function tierStatuses(): Promise<TierStatus[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.statuses;

  const config = readConfig() as unknown as Record<string, unknown>;

  const statuses = await Promise.all(
    PROBES.map(async (probe): Promise<TierStatus> => {
      if (probe.setting && config[probe.setting] === false) {
        return {
          capability: probe.capability,
          state: 'disabled',
          reason: `${probe.label} is switched off in Settings`,
        };
      }

      const answering = await listening(probe.port);
      if (answering) {
        return { capability: probe.capability, state: 'ready', reason: '' };
      }

      return {
        capability: probe.capability,
        state: 'down',
        reason: `${probe.label} is not running`,
        fix: probe.fix,
      };
    }),
  );

  cached = { at: Date.now(), statuses };
  return statuses;
}

/** The capabilities a plan must not use, with the reason for each. */
export async function unavailable(): Promise<TierStatus[]> {
  return (await tierStatuses()).filter((status) => status.state !== 'ready');
}

/**
 * What to tell the planner.
 *
 * Deliberately phrased as a fact about this machine rather than as an
 * instruction, and it names what to do instead. A model told only "you may not
 * use the vision tier" will plan around it by inventing something; told "it is
 * off, prefer Tier 1 and Tier 2, and say so if the task genuinely needs it",
 * it does the right thing and reports honestly when it cannot.
 */
export function describeUnavailable(statuses: TierStatus[]): string {
  if (statuses.length === 0) return '';

  const lines = statuses.map((s) => `  ${s.capability} — ${s.reason}`);
  return (
    '\nNOT AVAILABLE ON THIS MACHINE RIGHT NOW\n\n' +
    lines.join('\n') +
    '\n\n  Do not plan steps that use these. If the request genuinely cannot be\n' +
    '  done without one, say so plainly and name which one — do not substitute\n' +
    '  a tier that cannot do the job.\n'
  );
}

/** Whether one capability can be used, for the escalation check. */
export async function statusOf(capability: string): Promise<TierStatus> {
  const found = (await tierStatuses()).find((s) => s.capability === capability);
  // A capability with no probe is one that cannot be "not started" — the
  // daemon and the file agent. Absent from the list means fine, not missing.
  return found ?? { capability, state: 'ready', reason: '' };
}

/**
 * Is something listening on this port?
 *
 * A bare TCP connect rather than an HTTP `/health` request: the question is
 * whether the process exists, a health handler can be slow or absent, and this
 * runs before every plan. 700ms is generous for loopback and short enough that
 * three of them in parallel are not felt.
 */
function listening(port?: number): Promise<boolean> {
  if (!port) return Promise.resolve(true);

  return new Promise((resolve) => {
    // Required lazily so this module stays importable in tests that stub the
    // network, and so the cost is paid only when a probe actually runs.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const net = require('net') as typeof import('net');
    const socket = new net.Socket();
    let settled = false;

    const finish = (answer: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(answer);
    };

    socket.setTimeout(700);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, '127.0.0.1');
  });
}
