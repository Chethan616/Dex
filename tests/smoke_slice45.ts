/**
 * Slice 4.5 checks — deterministic-first execution.
 *
 * The thing being proved here is a routing discipline, not a feature: the
 * cheapest tier that can do a job is the one that does it, vision is a last
 * resort, and Full Access never becomes a way around a safety rule.
 *
 * Run: npm run test:slice45
 */
import './support/isolate';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

// Isolated database — see the note in tests/smoke_ws.ts.
import { AgentContext, AgentResult, ExecutionPlan, ExecutionStep } from '../core/events/types';
import { AgentRegistry } from '../core/orchestrator/registry';
import { Orchestrator } from '../core/orchestrator/orchestrator';
import { CancellationRegistry } from '../core/orchestrator/cancellation';
import { ConfirmationManager } from '../core/confirmation/confirmation_manager';
import { ReliabilityLayer } from '../core/reliability/observation_engine';
import { EvidenceStore } from '../core/reliability/evidence_store';
import { OS_ACTION_NAMES, capabilityCatalogue } from '../core/brain/capabilities';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? `\n      ${detail}` : ''}`);
  }
}

/** Tools print progress before their JSON; only the last line is the result. */
function lastLine(stdout: string | null | undefined): string {
  const lines = (stdout ?? '').trim().split(String.fromCharCode(10))
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

function section(title: string): void {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

function step(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    id: 'step_1',
    capability: 'can_control_app',
    action: 'click_element',
    params: { window: 'Test', name: 'Save' },
    confirmationTier: 4,
    dependsOn: [],
    ...overrides,
  };
}

function plan(steps: ExecutionStep[]): ExecutionPlan {
  return { requestId: 'req_slice45', intent: 'test', tier: 1, steps };
}

function buildOrchestrator(agents: Array<{ name: string; capabilities: string[] }>) {
  const registry = new AgentRegistry();
  for (const agent of agents) registry.register(agent as never);
  const confirmations = new ConfirmationManager(4_000, 4_000);
  const reliability = new ReliabilityLayer(
    new EvidenceStore(path.join(os.tmpdir(), 'dex-slice45-evidence')),
  );
  return {
    orchestrator: new Orchestrator(
      registry, reliability, false, confirmations, new CancellationRegistry(),
    ),
    confirmations,
  };
}

/** Tier 2 stand-in that cannot see the window and says so. */
class BlindAppAgent {
  name = 'AppAgent';
  capabilities = ['can_control_app'];
  calls = 0;
  async execute(): Promise<AgentResult> {
    this.calls += 1;
    return {
      success: false,
      error: 'This window exposes no accessible controls (custom-drawn UI)',
      retryable: false,
      escalate: 'can_control_gui',
    };
  }
}

/** Tier 3 stand-in that succeeds. */
class VisionAgent {
  name = 'DesktopAgent';
  capabilities = ['can_control_gui'];
  calls = 0;
  lastAction = '';
  async execute(action: string): Promise<AgentResult> {
    this.calls += 1;
    this.lastAction = action;
    return { success: true, data: { method: 'vision' } };
  }
}

/** Tier 2 stand-in that works, and reports a read-back like the real driver. */
class WorkingAppAgent {
  name = 'AppAgent';
  capabilities = ['can_control_app'];
  constructor(private readBack: string, private wrote: string) {}
  async execute(): Promise<AgentResult> {
    return {
      success: true,
      data: {
        wrote: this.wrote,
        read_back: this.readBack,
        verified: this.readBack === this.wrote,
      },
    };
  }
}

// ── tests ────────────────────────────────────────────────────────────────────

async function testEscalation(): Promise<void> {
  section('Escalation — Tier 2 hands off to Tier 3 instead of failing');

  {
    const app = new BlindAppAgent();
    const vision = new VisionAgent();
    const { orchestrator } = buildOrchestrator([app, vision]);

    const result = await orchestrator.execute(plan([step()]));

    check('Tier 2 is tried first', app.calls === 1, `app ran ${app.calls}x`);
    check('Tier 3 picks the step up', vision.calls === 1, `vision ran ${vision.calls}x`);
    check('the task completes', result.status === 'COMPLETED', result.summary);
    check(
      'the same action is carried across, not a new one',
      vision.lastAction === 'click_element',
      vision.lastAction,
    );
  }

  {
    // Nothing to escalate to: must fail cleanly rather than loop or hang.
    const app = new BlindAppAgent();
    const { orchestrator } = buildOrchestrator([app]);
    const result = await orchestrator.execute(plan([step()]));
    check(
      'escalation with no vision agent fails cleanly',
      result.status === 'FAILED' && app.calls === 1,
      `${result.status}, app ran ${app.calls}x`,
    );
  }
}

async function testAppVerification(): Promise<void> {
  section('Verification — the UI is read back, not taken on trust');

  {
    const { orchestrator } = buildOrchestrator([new WorkingAppAgent('hello world', 'hello world')]);
    const result = await orchestrator.execute(
      plan([step({ action: 'set_text', params: { window: 'W', name: 'Editor', text: 'hello world' } })]),
    );
    check('matching read-back verifies', result.status === 'COMPLETED', result.summary);
  }

  {
    // The agent claims success; the control holds something else. Verification
    // must side with the control.
    const { orchestrator } = buildOrchestrator([new WorkingAppAgent('hello wrld', 'hello world')]);
    const result = await orchestrator.execute(
      plan([step({ action: 'set_text', params: { window: 'W', name: 'Editor', text: 'hello world' } })]),
    );
    check(
      'a mismatched read-back FAILS even though the agent said success',
      result.status === 'FAILED',
      `${result.status} — ${result.summary}`,
    );
  }
}

function testRegistryBands(): void {
  section('Registry — three bands, and Full Access does not open the red one');

  // Runs from a file, not an inlined string: registry paths are all
  // backslashes, and passing them through a template literal into `python -c`
  // doubles every one of them.
  const result = spawnSync('python', ['tests/registry_policy_check.py'], { encoding: 'utf8' });
  const line = lastLine(result.stdout);

  let parsed: {
    wrong_bands?: string[];
    red_refused_with_full_access?: boolean;
    amber_gated_without_full_access?: boolean;
  };
  try {
    parsed = JSON.parse(line);
  } catch {
    check('registry policy check ran', false, (result.stderr || line).slice(0, 300));
    return;
  }

  check(
    'every path lands in the right band',
    (parsed.wrong_bands ?? ['?']).length === 0,
    (parsed.wrong_bands ?? []).join('; '),
  );
  check(
    'a RED key is refused WITH Full Access enabled',
    parsed.red_refused_with_full_access === true,
    'Full Access grants elevation, not permission to touch security settings',
  );
  check(
    'an AMBER key is gated when Full Access is off',
    parsed.amber_gated_without_full_access === true,
  );
}

function testDriftGuard(): void {
  section('Drift guard — the planner cannot advertise what the daemon lacks');

  const result = spawnSync(
    'python',
    ['-c', "import sys; sys.path.insert(0,'daemon'); from DexDaemon import DISPATCH; print(' '.join(sorted(DISPATCH)))"],
    { encoding: 'utf8' },
  );
  const available = new Set((result.stdout ?? '').trim().split(/\s+/).filter(Boolean));

  if (available.size === 0) {
    check('daemon dispatch table is importable', false, (result.stderr ?? '').slice(0, 300));
    return;
  }

  const missing = OS_ACTION_NAMES.filter((a) => !available.has(a));
  check(
    'every advertised OS action exists in the daemon',
    missing.length === 0,
    `daemon is missing: ${missing.join(', ')}`,
  );
  check('the daemon exposes describe for the startup check', available.has('describe'));

  // The bug that started this: these four were advertised and unimplemented.
  const regression = ['set_volume', 'get_volume', 'list_processes', 'kill_process'];
  check(
    'the four originally-missing actions are now implemented',
    regression.every((a) => available.has(a)),
    regression.filter((a) => !available.has(a)).join(', '),
  );
}

function testRoutingPrompt(): void {
  section('Routing — the prompt tells the Brain to climb the ladder');

  const catalogue = capabilityCatalogue();
  check('Tier 1 is marked as the preferred tier', catalogue.includes('TIER 1 — always prefer this'));
  check('Tier 3 is marked as a last resort', catalogue.includes('TIER 3 — last resort'));
  check('launch_app is offered on Tier 1, not the GUI tier', /can_control_os[\s\S]*?- launch_app/.test(catalogue));
  check(
    'the app tier advertises set_text rather than keystrokes',
    catalogue.includes('never types keystrokes'),
  );
}

function testUiaDriver(): void {
  section('UIA driver — against the real Windows accessibility tree');

  const script = `
import sys, json
sys.path.insert(0, r'agents/app')
import uia_driver as u
out = {}
try:
    r = u.list_elements('Program Manager')
    out['elements'] = len(r['elements'])
except Exception as e:
    out['elements'] = f'{type(e).__name__}'
try:
    u.list_elements('NoSuchWindow_ZZZ')
    out['missing_window'] = 'no error'
except u.WindowNotFound:
    out['missing_window'] = 'WindowNotFound'
except Exception as e:
    out['missing_window'] = type(e).__name__
print(json.dumps(out))
`;
  const result = spawnSync('python', ['-c', script], { encoding: 'utf8' });
  const line = lastLine(result.stdout) || '{}';
  let parsed: { elements?: unknown; missing_window?: string } = {};
  try {
    parsed = JSON.parse(line);
  } catch {
    check('uia driver script ran', false, (result.stderr || line).slice(0, 300));
    return;
  }

  check(
    'reads a real window from the live desktop',
    typeof parsed.elements === 'number' && (parsed.elements as number) > 0,
    String(parsed.elements),
  );
  check('a missing window raises WindowNotFound', parsed.missing_window === 'WindowNotFound', parsed.missing_window);
}

async function main(): Promise<void> {
  console.log('\x1b[1mDEX Slice 4.5 — deterministic-first execution\x1b[0m');

  testDriftGuard();
  testRoutingPrompt();
  testRegistryBands();
  await testEscalation();
  await testAppVerification();
  testUiaDriver();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log('\x1b[32mAll checks passed\x1b[0m');
  process.exit(0);
}

void main();
