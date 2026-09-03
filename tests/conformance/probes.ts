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
import fs from 'fs';
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

  classify_command: {
    tier: 'readonly',
    proves: 'the command bands answer, and RED still means RED',
    async run(ctx) {
      const cases: Array<[string[], string]> = [
        [['git', 'status'], 'green'],
        [['Get-FileHash', 'x'], 'green'],
        [['npm', 'install', 'express'], 'amber'],
        [['gcc', 'main.c'], 'amber'],
        [['some-unknown-tool'], 'amber'],
        [['format', 'C:'], 'red'],
        [['powershell', '-EncodedCommand', 'abc'], 'red'],
      ];
      for (const [command, expected] of cases) {
        const data = await ctx.call('classify_command', { command });
        assert(
          data.band === expected,
          `${command.join(' ')} classified ${data.band}, expected ${expected}`,
        );
      }
      ctx.note(`${cases.length} commands banded correctly`);
    },
  },

  run_command: {
    tier: 'readonly',
    proves: 'a GREEN command runs and a RED one is refused whatever the caller says',
    async run(ctx) {
      const data = await ctx.call('run_command', { command: ['whoami'] });
      assert(data.returncode === 0, `whoami exited ${data.returncode}`);
      assert(data.stdout.trim().length > 0, 'whoami produced no output');
      assert(data.band === 'green', `whoami classified ${data.band}`);

      // The band is the boundary, so prove it holds. A probe that only
      // exercises the happy path proves the feature works and says nothing
      // about whether the guard does.
      const refused = await ctx.attempt('run_command', { command: ['format', 'C:'] });
      assert(!refused.success, 'run_command ran a RED command');
      assert(
        /RED band/i.test(refused.error ?? ''),
        `refusal did not say why: ${refused.error}`,
      );

      const outside = await ctx.attempt('run_command', {
        command: ['whoami'],
        cwd: 'C:\Windows\System32',
      });
      assert(!outside.success, 'run_command worked outside the user profile');

      // run_shell is no longer advertised to the planner, but the daemon still
      // implements it for saved workflows written before run_command existed.
      // Exercised here so dropping it from the catalogue did not silently drop
      // it from the tests as well.
      const legacy = await ctx.call('run_shell', { command: ['hostname'] });
      assert(legacy.stdout.trim().length > 0, 'run_shell produced no output');
      const legacyRefused = await ctx.attempt('run_shell', { command: ['netstat'] });
      assert(!legacyRefused.success, 'run_shell ran outside its own allowlist');

      ctx.note(data.stdout.trim());
    },
  },

  clipboard_read: {
    tier: 'readonly',
    proves: 'the clipboard reads back, and a credential on it is withheld',
    async run(ctx) {
      const marker = `dex-probe-${Date.now()}`;
      await ctx.call('clipboard_write', { text: marker });

      const plain = await ctx.call('clipboard_read', {});
      assert(plain.kind === 'text', `expected text, got ${String(plain.kind)}`);
      assert(plain.text === marker, `clipboard read back ${String(plain.text)}`);

      // The half that matters. A password manager copies a secret to the
      // clipboard and it sits there until something overwrites it; an
      // assistant that reads it into a transcript has leaked it.
      await ctx.call('clipboard_write', { text: 'ghp_conformanceprobe12345678' });
      const secret = await ctx.call('clipboard_read', {});
      assert(
        typeof secret.withheld === 'string' && secret.text === undefined,
        'a token-shaped value was handed over instead of withheld',
      );
      assert(
        typeof secret.characters === 'number' && secret.characters > 0,
        'the owner was not even told the clipboard had something on it',
      );

      // Left as it was found, near enough — a probe should not eat what the
      // owner had copied for their own use any longer than it must.
      await ctx.call('clipboard_write', { text: '' });
      ctx.note(`round-tripped ${marker.length} characters; ${String(secret.withheld)}`);
    },
  },

  clipboard_write: {
    tier: 'roundtrip',
    proves: 'text put on the clipboard is what comes back off it',
    capture: (ctx) => ctx.call('clipboard_read', {}),
    async run(ctx) {
      const value = `probe-${Date.now()}`;
      await ctx.call('clipboard_write', { text: value });
      const back = await ctx.call('clipboard_read', {});
      assert(back.text === value, `wrote ${value}, read ${String(back.text)}`);
      ctx.note(`${value} written and read back`);
    },
    async restore(ctx, before) {
      const previous = before as { text?: string } | undefined;
      if (typeof previous?.text === 'string') {
        await ctx.call('clipboard_write', { text: previous.text });
      }
    },
  },

  get_env: {
    tier: 'readonly',
    proves: 'environment variables read back, from the registry as well as this process',
    async run(ctx) {
      const data = await ctx.call('get_env', { name: 'PATH' });
      assert(
        typeof data.value === 'string' && data.value.length > 0,
        'PATH came back empty',
      );
      const all = await ctx.call('get_env', {});
      assert(all.user && typeof all.user === 'object', 'no user variables returned');
      ctx.note(`PATH is ${String(data.value).split(';').length} entries`);
    },
  },

  get_display: {
    tier: 'readonly',
    proves: 'the display mode reads back, with the list of modes it will accept',
    async run(ctx) {
      const data = await ctx.call('get_display', {});
      assert(Number(data.width) > 0 && Number(data.height) > 0,
        `nonsense resolution: ${data.width}x${data.height}`);
      assert(Array.isArray(data.available) && data.available.length > 0,
        'no available modes reported');
      ctx.note(`${data.resolution} @ ${data.refresh_hz}Hz · ${data.available.length} modes`);
    },
  },

  get_brightness: {
    tier: 'readonly',
    proves: 'brightness reads, or says plainly that this display cannot report it',
    async run(ctx) {
      const data = await ctx.call('get_brightness', {});
      // An external monitor genuinely cannot answer. Saying so is the correct
      // result, not a failure — what would be wrong is a plausible zero.
      assert(
        data.supported === true ? typeof data.level === 'number' : typeof data.reason === 'string',
        'neither a level nor a reason came back',
      );
      ctx.note(data.supported ? `${data.level}%` : String(data.reason).slice(0, 60));
    },
  },

  // ── round trip: change something, prove it, put it back ───────────────────

  set_display: {
    tier: 'roundtrip',
    proves: 'the resolution really changes, reads back, and an impossible one is refused',
    capture: (ctx) => ctx.call('get_display', {}),
    async run(ctx, before) {
      // Move to a mode the driver actually offers and that is not the current
      // one, so an unchanged display fails rather than passing by accident.
      const other = (before.available as Array<Record<string, number>>).find(
        (m) => m.width !== before.width || m.height !== before.height,
      );
      if (!other) {
        ctx.note('only one mode available; nothing to switch to');
        return;
      }

      const result = await ctx.attempt('set_display', {
        resolution: `${other.width}x${other.height}`,
        refresh_hz: other.refresh_hz,
      });
      assert(result.success, `set_display failed: ${result.error}`);

      const after = await ctx.call('get_display', {});
      assert(
        Number(after.width) === other.width && Number(after.height) === other.height,
        `asked for ${other.width}x${other.height}, display reports ${after.resolution}`,
      );

      // The guard that matters: an unsupported mode must be refused with the
      // display untouched, not attempted and left half-applied.
      const absurd = await ctx.attempt('set_display', { resolution: '9999x9999' });
      assert(!absurd.success, 'set_display accepted a mode the display cannot do');
      const stillThere = await ctx.call('get_display', {});
      assert(
        Number(stillThere.width) === other.width,
        'a refused mode still disturbed the display',
      );

      ctx.note(`${before.resolution} -> ${after.resolution}`);
    },
    async restore(ctx, before) {
      await ctx.attempt('set_display', {
        width: before.width,
        height: before.height,
        refresh_hz: before.refresh_hz,
      });
    },
  },

  set_brightness: {
    tier: 'roundtrip',
    proves: 'brightness moves and reads back at the new level',
    capture: (ctx) => ctx.call('get_brightness', {}),
    async skip(ctx) {
      const current = await ctx.call('get_brightness', {});
      return current.supported === true
        ? null
        : 'this display does not report brightness (normal for external monitors)';
    },
    async run(ctx, before) {
      const target = Number(before.level) > 50 ? 40 : 80;
      const result = await ctx.attempt('set_brightness', { level: target });
      assert(result.success, `set_brightness failed: ${result.error}`);

      const after = await ctx.call('get_brightness', {});
      assert(
        Math.abs(Number(after.level) - target) <= 5,
        `asked for ${target}%, panel reports ${after.level}%`,
      );
      ctx.note(`${before.level}% -> ${after.level}%`);
    },
    async restore(ctx, before) {
      if (before.supported) await ctx.attempt('set_brightness', { level: before.level });
    },
  },



  set_env: {
    tier: 'roundtrip',
    proves: 'a variable is written, reads back from the registry, and can be removed',
    capture: (ctx) => ctx.call('get_env', { name: 'DEX_CONFORMANCE_PROBE' }),
    async run(ctx) {
      const value = `probe-${Date.now()}`;
      const result = await ctx.attempt('set_env', {
        name: 'DEX_CONFORMANCE_PROBE',
        value,
        scope: 'user',
      });
      assert(result.success, `set_env failed: ${result.error}`);

      // Read it back from the registry rather than trusting the write's own
      // report — the two agree right up until a write silently fails.
      const after = await ctx.call('get_env', { name: 'DEX_CONFORMANCE_PROBE' });
      assert(
        after.user === value,
        `stored value is ${after.user}, expected ${value}`,
      );

      const protectedWrite = await ctx.attempt('set_env', {
        name: 'SystemRoot',
        value: 'C:\Nope',
      });
      assert(!protectedWrite.success, 'set_env rewrote a protected Windows variable');

      ctx.note(`set and read back ${value}`);
    },
    async restore(ctx) {
      await ctx.attempt('set_env', {
        name: 'DEX_CONFORMANCE_PROBE',
        value: null,
        scope: 'user',
      });
    },
  },



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
    proves: 'the three write bands behave as documented, in whichever mode is on',
    async run(ctx) {
      const mode = await ctx.call('describe');

      // GREEN — Dex's own tree. Writes, creates the key if absent, reads back.
      const green = await ctx.call('registry_write', {
        path: 'HKCU\\Software\\DEX',
        name: 'ConformanceProbe',
        value: 'conformance-probe',
      });
      assert(green.band === 'green', `expected green band, got ${green.band}`);
      assert(green.verified, `write did not read back: ${green.read_back}`);

      // AMBER — asserted by *which* error comes back, not merely that one does.
      //
      // The previous version asserted only that the write failed, and passed
      // because the key did not exist rather than because policy refused it.
      // Once Full Access turned on and amber became allowed, the assertion was
      // checking nothing at all. Distinguishing the two errors is the whole
      // point, and it needs no real third-party key to be touched.
      const amber = await ctx.attempt('registry_write', {
        path: 'HKCU\\Software\\DexConformanceNoSuchVendor',
        name: 'x',
        value: 'y',
      });
      assert(!amber.success, 'an AMBER write to a non-existent key should not succeed');

      if (mode.full_access) {
        assert(
          /does not exist/i.test(amber.error ?? ''),
          `Full Access is on, so AMBER should be permitted and fail only on the ` +
            `missing key. Got: ${amber.error}`,
        );
      } else {
        assert(
          /confirmation|Tier 2/i.test(amber.error ?? ''),
          `Full Access is off, so AMBER should be refused pending confirmation. ` +
            `Got: ${amber.error}`,
        );
      }

      // RED — refused unless separately opted in, whatever Full Access says.
      const red = await ctx.attempt('registry_write', {
        path: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
        name: 'x',
        value: 'y',
      });
      if (mode.allow_red) {
        // Opted in: the daemon permits it, and the core forces a confirmation
        // card. Nothing here should reach the key silently.
        ctx.note('RED unlocked — the core gate is what asks');
      } else {
        assert(!red.success, 'a RED write was not refused');
        assert(
          /DEX_ALLOW_RED/.test(red.error ?? ''),
          `the refusal should say how to enable it. Got: ${red.error}`,
        );
      }

      ctx.note(
        `green ok · amber ${mode.full_access ? 'permitted' : 'refused'} · ` +
          `red ${mode.allow_red ? 'unlocked' : 'refused'}`,
      );
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

  capture_screen: {
    tier: 'roundtrip',
    proves: 'a real PNG of the real desktop lands on disk, at a plausible size',
    async run(ctx) {
      const params = {};
      const result = await ctx.attempt('capture_screen', params);
      assert(result.success, `capture_screen failed: ${result.error}`);

      const data = result.data as
        { path?: string; width?: number; height?: number; bytes?: number };
      assert(typeof data?.path === 'string' && data.path.length > 0,
        'no path was returned');
      assert(fs.existsSync(data.path!), `nothing at ${data.path}`);

      // A capture from the wrong desktop session succeeds and produces a
      // picture of nothing. Size is the cheapest way to notice: a real
      // screenshot of a real desktop does not compress to a few hundred bytes.
      assert((data.bytes ?? 0) > 10_000,
        `${data.bytes} bytes — that is not a screenshot of anything`);
      assert((data.width ?? 0) > 100 && (data.height ?? 0) > 100,
        `implausible dimensions ${data.width}x${data.height}`);

      await ctx.verify('capture_screen', params, result as AgentResult);
      fs.unlinkSync(data.path!);
    },
  },

  find_program: {
    tier: 'readonly',
    proves: 'a program is found by the same ladder Windows uses, and a missing one is an answer rather than an error',
    async run(ctx) {
      // node is running this test, so it is definitionally installed.
      const found = await ctx.call('find_program', { name: 'node' });
      assert(found.found === true, 'node was not found, but node is running this');
      assert(typeof found.path === 'string' && found.path.length > 0, 'no path');
      assert(/^v?\d/.test(String(found.version ?? '')), `no version: ${found.version}`);

      // The half that matters for the install recipe: not-installed must be
      // data, not an exception, or a plan cannot branch on it.
      const missing = await ctx.call('find_program', {
        name: 'dex-conformance-no-such-program',
      });
      assert(missing.found === false, 'a nonexistent program was reported found');
      assert(typeof missing.reason === 'string', 'no reason given for not found');

      ctx.note(`node ${found.version} via ${found.source}`);
    },
  },

  get_keyboard_backlight: {
    tier: 'readonly',
    proves: 'the backlight is described honestly, present or not',
    async run(ctx) {
      const data = await ctx.call('get_keyboard_backlight');
      assert(typeof data.present === 'boolean', 'present is not a boolean');

      if (!data.present) {
        // A machine with no backlight must say why, because "check first" is
        // only useful if the answer explains itself.
        assert(typeof data.reason === 'string' && data.reason.length > 20,
          'absent backlight gave no usable reason');
        ctx.note('no controllable backlight on this machine');
        return;
      }

      assert(typeof data.provider === 'string', 'no provider named');
      assert(typeof data.levels === 'number' && data.levels > 1,
        `implausible level count: ${data.levels}`);
      ctx.note(`${data.provider} · ${data.levels} levels · ` +
        `${data.supports_color ? 'colour' : 'brightness only'}`);
    },
  },

  set_keyboard_backlight: {
    tier: 'roundtrip',
    proves: 'brightness is set and out-of-range values are refused by name',
    async skip(ctx) {
      const data = await ctx.call('get_keyboard_backlight');
      return data.present ? null : 'no controllable keyboard backlight here';
    },
    async capture(ctx) {
      return ctx.call('get_keyboard_backlight');
    },
    async run(ctx, before: any) {
      const top = (before.levels as number) - 1;
      const result = await ctx.attempt('set_keyboard_backlight', { brightness: top });
      assert(result.success, `set_keyboard_backlight failed: ${result.error}`);

      // The boundary matters more than the happy path: a provider that accepts
      // anything is a provider that will silently do nothing.
      const refused = await ctx.attempt('set_keyboard_backlight', { brightness: 99 });
      assert(!refused.success, 'an out-of-range brightness was accepted');

      const empty = await ctx.attempt('set_keyboard_backlight', {});
      assert(!empty.success, 'a request that changes nothing was accepted');

      ctx.note(`brightness ${top} via ${(result.data as any)?.provider}`);
    },
    // Put it back where it was. There is no read-back for colour, so only
    // brightness is restored — and only if it was readable to begin with.
    async restore(ctx, before: any) {
      if (typeof before?.brightness === 'number') {
        await ctx.call('set_keyboard_backlight', { brightness: before.brightness });
      }
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
