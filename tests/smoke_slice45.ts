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
import {
  AgentContext,
  AgentResult,
  AgentSignal,
  AgentStepSummary,
  ExecutionPlan,
  ExecutionStep,
} from '../core/events/types';
import { AgentRegistry } from '../core/orchestrator/registry';
import { Orchestrator } from '../core/orchestrator/orchestrator';
import { CancellationRegistry } from '../core/orchestrator/cancellation';
import { ConfirmationManager } from '../core/confirmation/confirmation_manager';
import { ReliabilityLayer } from '../core/reliability/observation_engine';
import { EvidenceStore } from '../core/reliability/evidence_store';
import { OS_ACTION_NAMES, capabilityCatalogue, ROUTING_RULES } from '../core/brain/capabilities';
import { bus } from '../core/events/bus';

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
  const cancellation = new CancellationRegistry();
  const reliability = new ReliabilityLayer(
    new EvidenceStore(path.join(os.tmpdir(), 'dex-slice45-evidence')),
  );
  return {
    orchestrator: new Orchestrator(
      registry, reliability, false, confirmations, cancellation,
    ),
    confirmations,
    cancellation,
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

/** Tier 2 stand-in that returns a live value from a generic UI element read. */
class ReadingAppAgent {
  name = 'AppAgent';
  capabilities = ['can_control_app'];
  constructor(private value: string) {}
  async execute(): Promise<AgentResult> {
    return {
      success: true,
      data: {
        element: { name: 'Battery level' },
        value: this.value,
      },
    };
  }
}

/** File-tier stand-in used to prove the planner passes handoff context forward. */
class ContextRecordingFileAgent {
  name = 'FileAgent';
  capabilities = ['can_control_files'];
  contexts: Array<{
    instruction?: string;
    previousSteps?: readonly AgentStepSummary[];
    signal?: AgentSignal;
  }> = [];

  async execute(
    _action: string,
    _params: Record<string, unknown>,
    _requestId: string,
    _stepId: string,
    ctx?: AgentContext,
  ): Promise<AgentResult> {
    this.contexts.push({
      instruction: ctx?.instruction,
      previousSteps: ctx?.previousSteps,
      signal: ctx?.signal?.(),
    });
    return { success: true, data: { matches: [], count: 0 } };
  }
}

/** App-tier stand-in used to prove a retry is explicit and well-described. */
class RetryContextAppAgent {
  name = 'AppAgent';
  capabilities = ['can_control_app'];
  calls = 0;
  retryInstruction = '';
  retrySignal?: AgentSignal;

  async execute(
    _action: string,
    _params: Record<string, unknown>,
    _requestId: string,
    _stepId: string,
    ctx?: AgentContext,
  ): Promise<AgentResult> {
    this.calls += 1;
    if (this.calls === 2) {
      this.retryInstruction = ctx?.instruction ?? '';
      this.retrySignal = ctx?.signal?.();
    }
    return {
      success: true,
      data: {
        wrote: 'hello world',
        read_back: this.calls === 1 ? 'hello wrld' : 'hello world',
        verified: this.calls > 1,
      },
    };
  }
}

/** Long-running stand-in used to prove owner cancellation reaches the agent. */
class InterruptibleFileAgent {
  name = 'FileAgent';
  capabilities = ['can_control_files'];
  lastSignal?: AgentSignal;

  async execute(
    _action: string,
    _params: Record<string, unknown>,
    _requestId: string,
    _stepId: string,
    ctx?: AgentContext,
  ): Promise<AgentResult> {
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        const signal = ctx?.signal?.();
        if (!signal) return;
        this.lastSignal = signal;
        if (!signal.shouldContinue) {
          clearInterval(timer);
          resolve({ success: false, error: signal.message, retryable: false });
        }
      }, 10);
    });
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

  {
    const { orchestrator } = buildOrchestrator([new ReadingAppAgent('87%')]);
    const result = await orchestrator.execute(
      plan([step({
        action: 'read_element',
        params: { window: 'Settings', name: 'Battery level' },
      })]),
    );
    check(
      'a live read value reaches the task summary',
      result.status === 'COMPLETED' && result.summary.includes('87%'),
      result.summary,
    );
  }
}

async function testPlannerAgentProtocol(): Promise<void> {
  section('Planner handoff — context, signals, and recovery are explicit');

  const agent = new ContextRecordingFileAgent();
  const { orchestrator } = buildOrchestrator([agent]);
  const requestId = 'req_slice45_context';
  const events: Array<{ type: string; message: string; data?: unknown }> = [];
  const unsubscribe = bus.subscribe(requestId, (event) => events.push(event));

  const result = await orchestrator.execute({
    requestId,
    intent: 'find the project files',
    tier: 1,
    steps: [
      step({
        id: 'step_1',
        capability: 'can_control_files',
        action: 'find_files',
        params: { root: '.', query: 'package' },
      }),
      step({
        id: 'step_2',
        capability: 'can_control_files',
        action: 'find_files',
        params: { root: '.', query: 'test' },
        dependsOn: ['step_1'],
      }),
    ],
  });
  unsubscribe();

  const second = agent.contexts[1];
  const secondPrevious = second?.previousSteps ?? [];
  const dispatch = events.find((event) => event.type === 'dispatching');
  const dispatchData = dispatch?.data as { agent?: string; signal?: AgentSignal } | undefined;

  check('dependent steps receive the planner instruction', Boolean(second?.instruction?.includes('Now search')));
  check(
    'the next agent receives a safe summary of the completed step',
    secondPrevious.length === 1 && secondPrevious[0].status === 'succeeded',
    JSON.stringify(secondPrevious),
  );
  check('a normal handoff says continue', second?.signal?.shouldContinue === true);
  check('a dispatch event names the receiving agent', dispatchData?.agent === 'FileAgent');
  check('the task completes after both handoffs', result.status === 'COMPLETED', result.summary);

  const retryAgent = new RetryContextAppAgent();
  const retryOrchestrator = buildOrchestrator([retryAgent]).orchestrator;
  const retryResult = await retryOrchestrator.execute({
    requestId: 'req_slice45_retry',
    intent: 'set the greeting',
    tier: 1,
    steps: [step({
      action: 'set_text',
      params: { window: 'W', name: 'Editor', text: 'hello world' },
    })],
  });

  check('a failed verification asks the same agent to try again', retryAgent.calls === 2);
  check('the retry signal is true and keeps the attempt number', retryAgent.retrySignal?.shouldRetry === true && retryAgent.retrySignal.attempt === 2);
  check('the retry instruction explains the previous action', /previous attempt.*did not verify.*try again/i.test(retryAgent.retryInstruction));
  check('the verified retry lets the plan continue', retryResult.status === 'COMPLETED', retryResult.summary);

  const interruptAgent = new InterruptibleFileAgent();
  const interruptControl = buildOrchestrator([interruptAgent]);
  const interruptRequestId = 'req_slice45_interrupt';
  const running = interruptControl.orchestrator.execute({
    requestId: interruptRequestId,
    intent: 'wait for the file agent',
    tier: 1,
    steps: [step({
      capability: 'can_control_files',
      action: 'find_files',
      params: { root: '.', query: 'anything' },
    })],
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  interruptControl.cancellation.cancel(interruptRequestId);
  const interrupted = await running;

  check('an owner interrupt reaches the running agent', interruptAgent.lastSignal?.interrupted === true);
  check(
    'the interrupt tells the agent to stop',
    interruptAgent.lastSignal?.shouldContinue === false &&
      /stop safely/i.test(interruptAgent.lastSignal?.message ?? ''),
  );
  check('an interrupted task finishes as cancelled', interrupted.status === 'CANCELLED', interrupted.summary);
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
  check('local files and code have a deterministic capability', catalogue.includes('can_control_files'));
  check('game creation is routed to code execution, not screenshots', /create, write, or run source code/.test(ROUTING_RULES));
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
  await testPlannerAgentProtocol();
  testUiaDriver();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log('\x1b[32mAll checks passed\x1b[0m');
  process.exit(0);
}

void main();
