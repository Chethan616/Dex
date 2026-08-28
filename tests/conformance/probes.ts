/**
 * One probe per advertised OS action.
 *
 * The reason this file exists: of the seventeen actions the planner advertises,
 * the telemetry database says exactly three had ever executed. `set_dns` had
 * never once reached the daemon — the two "successful" DNS rows were written by
 * a test against a mocked agent. Everything else was written, catalogued,
 * documented in USECASES.md, and never run.
 *
 * So the deliverable is not "fix DNS". Fixing DNS by hand leaves the other
 * thirteen in exactly the state that let this happen. The deliverable is a
 * harness that makes an unrun action impossible to ship: `run.ts` walks
 * OS_ACTION_NAMES — the same list the Brain is shown — and fails if any action
 * has no probe here.
 *
 * Every probe drives the **real daemon over the real pipe** and confirms
 * through `verifyStep`, the same verification the Orchestrator uses. Mocks are
 * what produced the two fake DNS successes; a conformance harness that mocked
 * anything would be theatre.
 */
import { AgentResult, ExecutionStep } from '../../core/events/types';

export type Tier = 'readonly' | 'roundtrip' | 'destructive';

export interface Ctx {
  /** Call the daemon. Throws if it reports failure. */
  call(action: string, params?: Record<string, unknown>): Promise<any>;
  /** Call the daemon and hand back the raw result, failure included. */
  attempt(
    action: string,
    params?: Record<string, unknown>,
  ): Promise<{ success: boolean; data?: unknown; error?: string }>;
  /** Run the production verification for a step and require VERIFIED. */
  verify(
    action: string,
    params: Record<string, unknown>,
    result: AgentResult,
  ): Promise<void>;
  note(message: string): void;
}

export interface Probe {
  tier: Tier;
  /** One line: what passing this actually proves. Printed in the report. */
  proves: string;
  /** Return a reason to skip, or null to run. */
  skip?(ctx: Ctx): Promise<string | null>;
  /** Read the current state, before anything is touched. */
  capture?(ctx: Ctx): Promise<unknown>;
  /** Exercise the action and confirm it happened. Throw to fail. */
  run(ctx: Ctx, captured: any): Promise<void>;
  /** Put back what was there. Runs in a finally, even when `run` threw. */
  restore?(ctx: Ctx, captured: any): Promise<void>;
}

export function step(action: string, params: Record<string, unknown>): ExecutionStep {
  return {
    id: 'conformance',
    capability: 'can_control_os',
    action,
    params,
    confirmationTier: 4,
    dependsOn: [],
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** A DNS server safe to point at briefly: Cloudflare's public resolver. */
const TEST_DNS = { primary: '1.1.1.1', secondary: '1.0.0.1' };

export const PROBES: Record<string, Probe> = {
  // ── read-only ─────────────────────────────────────────────────────────────

  get_dns: {
    tier: 'readonly',
    proves: 'DNS is readable per adapter, not as one blob of text',
    async run(ctx) {
      const data = await ctx.call('get_dns');
      assert(Array.isArray(data.active), 'get_dns returned no active adapter list');
      assert(data.active.length > 0, 'no active network adapter found');
      for (const adapter of data.active) {
        const entry = data.adapters[adapter];
        assert(entry, `active adapter "${adapter}" missing from the DNS table`);
        assert(
          entry.source === 'dhcp' || entry.source === 'static',
          `adapter "${adapter}" has an unparsed DNS source: ${entry.source}`,
        );
      }
      ctx.note(data.active.map((a: string) => `${a}=${data.adapters[a].source}`).join(' '));
    },
  },

  get_volume: {
    tier: 'readonly',
    proves: 'the audio endpoint answers in this session',
    async run(ctx) {
      const data = await ctx.call('get_volume');
      assert(typeof data.level === 'number', 'get_volume returned no level');
      assert(data.level >= 0 && data.level <= 100, `level out of range: ${data.level}`);
      ctx.note(`${data.level}%${data.muted ? ' muted' : ''}`);
    },
  },

  get_power_plan: {
    tier: 'readonly',
    proves: 'the active power scheme is readable and its GUID parses',
    async run(ctx) {
      const data = await ctx.call('get_power_plan');
      assert(/^[0-9a-f-]{36}$/.test(data.guid ?? ''), `unparsed GUID: ${data.guid}`);
      ctx.note(data.plan ?? `unnamed scheme ${data.guid}`);
    },
  },

  get_wifi_status: {
    tier: 'readonly',
    proves: 'wireless state is readable, including when there is no adapter',
    async run(ctx) {
      const data = await ctx.call('get_wifi_status');
      assert(typeof data.enabled === 'boolean', 'get_wifi_status returned no enabled flag');
      ctx.note(data.enabled ? data.adapters.join(', ') : 'no wireless adapter');
    },
  },

  list_processes: {
    tier: 'readonly',
    proves: 'the process table is readable',
    async run(ctx) {
      const data = await ctx.call('list_processes', { limit: 5 });
      assert(data.count > 0, 'no processes returned');
      assert(data.processes[0]?.name, 'process entries have no name');
      ctx.note(`${data.count} processes`);
    },
  },

  registry_read: {
    tier: 'readonly',
    proves: 'the registry is readable through the daemon',
    async run(ctx) {
      const data = await ctx.call('registry_read', {
        path: 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion',
        name: 'ProductName',
      });
      assert(
        String(data.value).toLowerCase().includes('windows'),
        `unexpected ProductName: ${data.value}`,
      );
      ctx.note(String(data.value));
    },
  },

  registry_classify: {
    tier: 'readonly',
    proves: 'the three-band write policy answers, and RED still means RED',
    async run(ctx) {
      const cases: Array<[string, string]> = [
        ['HKCU\\Software\\DEX', 'green'],
        ['HKCU\\Software\\SomeVendor\\Settings', 'amber'],
        ['HKLM\\SYSTEM\\CurrentControlSet\\Services\\Foo', 'red'],
        ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'red'],
      ];
      for (const [path, expected] of cases) {
        const data = await ctx.call('registry_classify', { path });
        assert(
          data.band === expected,
          `${path} classified ${data.band}, expected ${expected}`,
        );
      }
      ctx.note(`${cases.length} paths banded correctly`);
    },
  },

  run_shell: {
    tier: 'readonly',
    proves: 'the read-only shell allowlist runs what it permits and refuses the rest',
    async run(ctx) {
      const data = await ctx.call('run_shell', { command: ['whoami'] });
      assert(data.stdout.trim().length > 0, 'whoami produced no output');

      // The allowlist is the security boundary, so prove it holds rather than
      // only proving the happy path.
      const refused = await ctx.attempt('run_shell', { command: ['del', 'x'] });
      assert(!refused.success, 'run_shell executed a command outside the allowlist');
      ctx.note(data.stdout.trim());
    },
  },

  // ── round trip: change something, prove it, put it back ───────────────────

  set_volume: {
    tier: 'roundtrip',
    proves: 'the volume actually moves and reads back at the new level',
    capture: (ctx) => ctx.call('get_volume'),
    async run(ctx, before) {
      // Move somewhere it demonstrably was not, so an unchanged endpoint fails.
      const target = before.level > 50 ? 30 : 70;
      const result = await ctx.attempt('set_volume', { level: target });
      assert(result.success, `set_volume failed: ${result.error}`);
      await ctx.verify('set_volume', { level: target }, result as AgentResult);
      ctx.note(`${before.level}% -> ${target}%`);
    },
    restore: (ctx, before) => ctx.call('set_volume', { level: before.level }),
  },

  set_mute: {
    tier: 'roundtrip',
    proves: 'mute toggles and the endpoint agrees',
    capture: (ctx) => ctx.call('get_volume'),
    async run(ctx, before) {
      const target = !before.muted;
      const data = await ctx.call('set_mute', { muted: target });
      assert(data.muted === target, `asked for muted=${target}, got ${data.muted}`);

      const readBack = await ctx.call('get_volume');
      assert(readBack.muted === target, 'mute did not survive a fresh read');
      ctx.note(`${before.muted} -> ${target}`);
    },
    restore: (ctx, before) => ctx.call('set_mute', { muted: before.muted }),
  },

  set_power_plan: {
    tier: 'roundtrip',
    proves: 'the active power scheme changes and can be put back',
    async skip(ctx) {
      const now = await ctx.call('get_power_plan');
      return now.plan
        ? null
        : `active scheme ${now.guid} is not one of the three Dex knows, so it ` +
            'could not be restored afterwards';
    },
    capture: (ctx) => ctx.call('get_power_plan'),
    async run(ctx, before) {
      const target = before.plan === 'balanced' ? 'power_saver' : 'balanced';
      const result = await ctx.attempt('set_power_plan', { plan: target });
      assert(result.success, `set_power_plan failed: ${result.error}`);
      await ctx.verify('set_power_plan', { plan: target }, result as AgentResult);
      ctx.note(`${before.plan} -> ${target}`);
    },
    restore: (ctx, before) => ctx.call('set_power_plan', { plan: before.plan }),
  },

  set_dns: {
    tier: 'roundtrip',
    proves: 'DNS is really written to the active adapters — the action that had never once run',
    capture: (ctx) => ctx.call('get_dns'),
    async run(ctx, before) {
      const result = await ctx.attempt('set_dns', TEST_DNS);
      assert(result.success, `set_dns failed: ${result.error}`);
      await ctx.verify('set_dns', TEST_DNS, result as AgentResult);
      ctx.note(`${before.active.join(', ')} -> ${TEST_DNS.primary}`);
    },
    async restore(ctx, before) {
      // Restore only what actually moved. When the exercise failed before
      // touching anything — no elevation, most often — putting it "back" would
      // fail for the same reason and report a scary RESTORE FAILED about a
      // machine nobody had changed.
      const now = await ctx.call('get_dns');

      for (const adapter of before.active) {
        const was = before.adapters[adapter];
        const is = now.adapters[adapter];
        const unchanged =
          was && is &&
          was.source === is.source &&
          was.servers.join() === is.servers.join();
        if (unchanged) continue;

        // Put it back the way it was found, including "it was on DHCP" — which
        // is why get_dns reports a source rather than just addresses.
        if (!was || was.source === 'dhcp') {
          await ctx.call('set_dns', { adapter, dhcp: true });
        } else {
          await ctx.call('set_dns', {
            adapter,
            primary: was.servers[0],
            secondary: was.servers[1],
          });
        }
      }
    },
  },

  registry_write: {
    tier: 'roundtrip',
    proves: 'a GREEN-band write lands and reads back, and an AMBER one is refused unconfirmed',
    async run(ctx) {
      const path = 'HKCU\\Software\\DEX';
      const value = 'conformance-probe';
      const data = await ctx.call('registry_write', {
        path,
        name: 'ConformanceProbe',
        value,
      });
      assert(data.band === 'green', `expected green band, got ${data.band}`);
      assert(data.verified, `write did not read back: ${data.read_back}`);

      // The band policy is the point of the feature, so prove the other half.
      const amber = await ctx.attempt('registry_write', {
        path: 'HKCU\\Software\\SomeVendor',
        name: 'x',
        value: 'y',
      });
      assert(!amber.success, 'an AMBER write went through without confirmation');

      const red = await ctx.attempt('registry_write', {
        path: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
        name: 'x',
        value: 'y',
      });
      assert(!red.success, 'a RED write was not refused');

      ctx.note(`${path}\\ConformanceProbe left in place (Dex-owned key)`);
    },
  },

  launch_app: {
    tier: 'roundtrip',
    proves: 'an app really opens, proven by a window existing rather than by a return code',
    async run(ctx) {
      const params = { name: 'Calculator' };
      const result = await ctx.attempt('launch_app', params);
      assert(result.success, `launch_app failed: ${result.error}`);
      await ctx.verify('launch_app', params, result as AgentResult);
    },
    restore: (ctx) => ctx.call('close_app', { name: 'Calculator' }),
  },

  close_app: {
    tier: 'roundtrip',
    proves: 'an app is asked to close and the window is gone afterwards',
    async capture(ctx) {
      await ctx.call('launch_app', { name: 'Calculator' });
      return null;
    },
    async run(ctx) {
      const params = { name: 'Calculator' };
      const result = await ctx.attempt('close_app', params);
      assert(result.success, `close_app failed: ${result.error}`);
      await ctx.verify('close_app', params, result as AgentResult);
    },
  },

  // ── destructive: opt in with --destructive ────────────────────────────────

  set_wifi: {
    tier: 'destructive',
    proves: 'the wireless adapter is really disabled and re-enabled',
    async skip(ctx) {
      // Deliberately gated behind its own flag, on top of --destructive.
      //
      // It is the only probe that can cut the operator off from the machine it
      // is running on. When its restore failed once here, the network it would
      // have needed to fix itself was the network it had just taken down. That
      // is not a risk to bundle in with "run the thorough suite" — it has to be
      // asked for, in those words, every time.
      if (!process.argv.includes('--allow-network-drop')) {
        return 'needs --allow-network-drop as well: this disconnects you';
      }
      const status = await ctx.call('get_wifi_status');
      return status.enabled ? null : 'no wireless adapter is enabled to toggle';
    },
    capture: (ctx) => ctx.call('get_wifi_status'),
    async run(ctx) {
      const off = await ctx.attempt('set_wifi', { enabled: false });
      assert(off.success, `set_wifi(false) failed: ${off.error}`);
      await ctx.verify('set_wifi', { enabled: false }, off as AgentResult);
      ctx.note('disabled and confirmed');
    },
    async restore(ctx, before) {
      if (!before?.enabled) return;

      // Only if it actually went down. When the exercise failed before touching
      // anything — no elevation — "restoring" fails for the same reason and
      // reports a frightening RESTORE FAILED about a network nobody unplugged.
      const now = await ctx.call('get_wifi_status');
      if (now.enabled) return;

      // Retry: bringing a radio back is slower and less reliable than taking it
      // down, and this is the one restore where giving up strands the machine.
      let lastError = '';
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const result = await ctx.attempt('set_wifi', { enabled: true });
        if (result.success) break;
        lastError = result.error ?? 'unknown';
        await new Promise((r) => setTimeout(r, 2000));
      }
      const back = await ctx.call('get_wifi_status');
      if (!back.enabled) {
        throw new Error(
          `wifi is still down after three attempts (${lastError}). ` +
            'Re-enable it by hand: netsh interface set interface "Wi-Fi" enable',
        );
      }
      // Coming back is the part that matters — a harness that leaves the
      // network down has done more harm than the bug it was looking for.
      await ctx.verify(
        'set_wifi',
        { enabled: true },
        { success: true, data: {} } as AgentResult,
      );
    },
  },

  kill_process: {
    tier: 'destructive',
    proves: 'a named process is ended — against one the harness spawned, never one it found',
    async capture(ctx) {
      const { spawn } = await import('child_process');
      // Node, not `timeout.exe` — timeout exits immediately when stdin is not a
      // console ("input redirection is not supported"), so the harness was
      // killing a process that had already gone and reading the failure as a
      // privilege problem.
      const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      await new Promise((r) => setTimeout(r, 600));
      assert(child.pid, 'could not spawn a throwaway process to end');
      ctx.note(`spawned pid ${child.pid}`);
      return { pid: child.pid };
    },
    async run(ctx, spawned) {
      const params = { pid: spawned.pid };
      const result = await ctx.attempt('kill_process', params);
      assert(result.success, `kill_process failed: ${result.error}`);
      await ctx.verify('kill_process', params, result as AgentResult);

      // The refusal list is a safety boundary; prove it holds too.
      const refused = await ctx.attempt('kill_process', { name: 'csrss.exe' });
      assert(!refused.success, 'kill_process agreed to end a protected process');
    },
    async restore(ctx, spawned) {
      // Best effort: if `run` failed before killing it, do not leave it behind.
      await ctx.attempt('kill_process', { pid: spawned?.pid });
    },
  },
};

/** Not in OS_ACTIONS — the daemon's own self-description. Checked separately. */
export const DESCRIBE_PROBE: Probe = {
  tier: 'readonly',
  proves: 'the daemon reports its actions, elevation and session',
  async run(ctx) {
    const data = await ctx.call('describe');
    assert(Array.isArray(data.actions) && data.actions.length > 0, 'no action list');
    assert(typeof data.elevated === 'boolean', 'daemon does not report elevation');
    ctx.note(
      `v${data.version} · ${data.actions.length} actions · ` +
        `elevated=${data.elevated} · session=${data.session_id}`,
    );
  },
};
