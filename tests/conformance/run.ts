/**
 * Conformance: does every action Dex advertises actually work?
 *
 *   npm run conformance                  read-only + round-trip
 *   npm run conformance -- --destructive adds wifi and process-kill
 *
 * The list of things to check is not written here. It is `OS_ACTION_NAMES` from
 * core/brain/capabilities.ts — literally the list the Brain is shown — so an
 * action that is advertised but has no probe fails the run. That is the whole
 * mechanism: it is not possible to add a capability the planner will offer
 * without also proving it runs.
 *
 * Requires the daemon. Privileged actions additionally require it to be
 * elevated, and the report says so per action rather than leaving you to guess
 * which of the failures were the same failure.
 */
import { OS_ACTION_NAMES } from '../../core/brain/capabilities';
import { AgentResult } from '../../core/events/types';
import { verifyStep } from '../../core/reliability/verification_policy';
import { SystemAgent } from '../../agents/system/system_agent';
import { Ctx, DESCRIBE_PROBE, PROBES, Probe, Tier, step } from './probes';

const DESTRUCTIVE = process.argv.includes('--destructive');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

const TIER_ORDER: Tier[] = ['readonly', 'roundtrip', 'destructive'];

const c = {
  dim: (s: string) => `\x1b[90m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

interface Outcome {
  action: string;
  tier: Tier;
  verdict: 'pass' | 'fail' | 'skip';
  detail: string;
  restoreError?: string;
}

async function main(): Promise<void> {
  const agent = new SystemAgent();
  const notes: string[] = [];

  const ctx: Ctx = {
    async attempt(action, params = {}) {
      return agent.execute(action, params, 'conformance', action);
    },
    async call(action, params = {}) {
      const result = await agent.execute(action, params, 'conformance', action);
      if (!result.success) throw new Error(`${action}: ${result.error}`);
      return result.data as any;
    },
    async verify(action, params, result) {
      const verdict = await verifyStep(step(action, params), undefined, result);
      if (verdict.status !== 'VERIFIED') {
        throw new Error(`${verdict.status} — ${verdict.reason}`);
      }
      notes.push(verdict.reason);
    },
    note(message) {
      notes.push(message);
    },
  };

  // Is anything listening at all? Every other failure would be this one wearing
  // a different message.
  const alive = await ctx.attempt('describe');
  if (!alive.success) {
    console.error(c.red('\nThe daemon is not running.'));
    console.error('  Start it:  python daemon/DexDaemon.py');
    console.error(`  It said:   ${alive.error}\n`);
    process.exit(2);
  }

  const daemon = alive.data as { elevated?: boolean; session_id?: number };
  header(daemon);

  // The anti-drift guard. An advertised action with no probe is a capability
  // nobody has ever proven, which is exactly how thirteen of them got here.
  const unprobed = OS_ACTION_NAMES.filter((a) => !PROBES[a]);
  if (unprobed.length > 0) {
    console.error(
      c.red(`\n${unprobed.length} advertised action(s) have no conformance probe:`),
    );
    console.error(`  ${unprobed.join(', ')}`);
    console.error(
      '\nAdd one in tests/conformance/probes.ts, or remove the action from\n' +
        'core/brain/capabilities.ts. The Brain must not be offered an action\n' +
        'that nothing has ever run.\n',
    );
    process.exit(1);
  }

  const outcomes: Outcome[] = [];
  const entries: Array<[string, Probe]> = [
    ['describe', DESCRIBE_PROBE],
    ...OS_ACTION_NAMES.map((a): [string, Probe] => [a, PROBES[a]]),
  ];

  for (const tier of TIER_ORDER) {
    if (tier === 'destructive' && !DESTRUCTIVE) continue;
    const inTier = entries.filter(([, p]) => p.tier === tier);
    if (inTier.length === 0) continue;

    console.log(`\n${c.bold(tier)} ${c.dim('·'.repeat(60 - tier.length))}`);
    for (const [action, probe] of inTier) {
      if (ONLY && action !== ONLY) continue;
      notes.length = 0;
      outcomes.push(await runProbe(ctx, action, probe, notes));
    }
  }

  report(outcomes, daemon);
  process.exit(outcomes.some((o) => o.verdict === 'fail') ? 1 : 0);
}

async function runProbe(
  ctx: Ctx,
  action: string,
  probe: Probe,
  notes: string[],
): Promise<Outcome> {
  process.stdout.write(`  ${action.padEnd(18)} `);
  const fail = (detail: string): Outcome => {
    console.log(c.red(`fail  ${detail}`));
    return { action, tier: probe.tier, verdict: 'fail', detail };
  };

  try {
    const skipped = probe.skip ? await probe.skip(ctx) : null;
    if (skipped) {
      console.log(c.yellow(`skip  ${skipped}`));
      return { action, tier: probe.tier, verdict: 'skip', detail: skipped };
    }
  } catch (err) {
    return fail(`could not decide whether to skip — ${message(err)}`);
  }

  let captured: unknown;
  try {
    captured = probe.capture ? await probe.capture(ctx) : undefined;
  } catch (err) {
    return fail(`could not read the state to restore later — ${message(err)}`);
  }

  let ran: Outcome;
  try {
    await probe.run(ctx, captured);
    const detail = notes.join(' · ');
    console.log(`${c.green('pass')}  ${c.dim(detail)}`);
    ran = { action, tier: probe.tier, verdict: 'pass', detail };
  } catch (err) {
    ran = fail(message(err));
  }

  // Restore regardless of the verdict — a half-applied change is the worst
  // state to leave a machine in, and a probe that fails halfway through is
  // exactly when that happens.
  if (probe.restore) {
    try {
      await probe.restore(ctx, captured);
    } catch (err) {
      ran.restoreError = message(err);
      console.log(c.red(`  ${' '.repeat(18)} RESTORE FAILED — ${ran.restoreError}`));
      console.log(
        c.red(`  ${' '.repeat(18)} it was: ${JSON.stringify(captured)}`),
      );
    }
  }

  return ran;
}

function header(daemon: { elevated?: boolean; session_id?: number }): void {
  console.log(c.bold('\nDex capability conformance'));
  console.log(
    c.dim(
      `  daemon: elevated=${daemon.elevated} session=${daemon.session_id}` +
        `  ·  destructive tier: ${DESTRUCTIVE ? 'ON' : 'off'}`,
    ),
  );
  if (daemon.elevated === false) {
    console.log(
      c.yellow(
        '  Not elevated — set_dns, set_wifi, set_power_plan and HKLM writes\n' +
          '  will fail. That is now a reported failure rather than a silent one.',
      ),
    );
  }
  if (daemon.session_id === 0) {
    console.log(
      c.yellow(
        '  Session 0 — set_volume, set_mute, launch_app and close_app cannot\n' +
          '  reach your desktop from here.',
      ),
    );
  }
}

function report(
  outcomes: Outcome[],
  daemon: { elevated?: boolean },
): void {
  const pass = outcomes.filter((o) => o.verdict === 'pass');
  const fail = outcomes.filter((o) => o.verdict === 'fail');
  const skip = outcomes.filter((o) => o.verdict === 'skip');

  console.log(
    `\n${c.bold('Result')}  ${c.green(`${pass.length} pass`)}  ` +
      `${fail.length ? c.red(`${fail.length} fail`) : `${fail.length} fail`}  ` +
      `${c.yellow(`${skip.length} skip`)}` +
      `  ${c.dim(`of ${OS_ACTION_NAMES.length} advertised actions`)}`,
  );

  for (const f of fail) {
    console.log(`  ${c.red('✗')} ${f.action.padEnd(18)} ${f.detail}`);
  }

  const restoreFailures = outcomes.filter((o) => o.restoreError);
  if (restoreFailures.length > 0) {
    console.log(
      c.red(
        `\n${restoreFailures.length} probe(s) could not put your machine back. ` +
          'Check the original state printed above.',
      ),
    );
  }

  if (fail.length > 0 && daemon.elevated === false) {
    console.log(
      c.dim(
        '\nSome of these are the same failure: the daemon is not elevated.\n' +
          'Run scripts/install-daemon-service.ps1 once, then re-run.',
      ),
    );
  }
  console.log('');
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

main().catch((err) => {
  console.error(c.red(`\nHarness crashed: ${message(err)}\n`));
  process.exit(2);
});
