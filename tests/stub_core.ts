/**
 * A DEX core with a stub Brain and a stub agent — everything real except the
 * LLM call. Lets you drive the Dex Bar UI end to end without an API key.
 *
 *   npx ts-node tests/stub_core.ts
 */
import { DexServer } from '../core/server/ws_server';
import { ConfirmationManager } from '../core/confirmation/confirmation_manager';
import { CancellationRegistry } from '../core/orchestrator/cancellation';
import { Orchestrator } from '../core/orchestrator/orchestrator';
import { AgentRegistry } from '../core/orchestrator/registry';
import { ReliabilityLayer } from '../core/reliability/observation_engine';
import { EvidenceStore } from '../core/reliability/evidence_store';
import { Gateway } from '../core/gateway';
import { OwnerGate } from '../core/owner_gate';
import { emit } from '../core/events/bus';
import { DexRequest, ExecutionPlan } from '../core/events/types';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Fakes a plan without calling Claude. A request containing "notepad" produces
 * a two-step GUI plan; anything else produces a Tier 2 OS plan so the
 * confirmation card is easy to exercise.
 */
class StubBrain {
  async plan(request: DexRequest): Promise<ExecutionPlan> {
    emit('routing', 'Brain thinking (stub)…', request.requestId);
    await sleep(600);

    // "status" → a single Tier 4 step: the bar still grows and re-centres, but
    // no confirmation card appears. Useful for isolating resize-related input.
    if (/status/i.test(request.text)) {
      return {
        requestId: request.requestId,
        intent: 'Check status',
        tier: 1,
        steps: [
          {
            id: 'step_1',
            capability: 'can_control_os',
            action: 'get_volume',
            params: {},
            confirmationTier: 4,
            dependsOn: [],
          },
        ],
      };
    }

    const gui = /notepad|type|open /i.test(request.text);

    return gui
      ? {
          requestId: request.requestId,
          intent: 'Open Notepad and save a note',
          tier: 2,
          steps: [
            {
              id: 'step_1',
              capability: 'can_control_gui',
              action: 'run_task',
              params: { task: 'open Notepad and type hello world' },
              confirmationTier: 4,
              dependsOn: [],
            },
            {
              id: 'step_2',
              capability: 'can_control_gui',
              action: 'run_task',
              params: { task: 'save as test.txt', verify_file: 'C:/temp/test.txt' },
              confirmationTier: 3,
              dependsOn: ['step_1'],
            },
          ],
        }
      : {
          requestId: request.requestId,
          intent: `Handle: ${request.text}`,
          tier: 1,
          steps: [
            {
              id: 'step_1',
              capability: 'can_control_os',
              action: 'set_volume',
              params: { level: 40 },
              confirmationTier: 2,
              dependsOn: [],
            },
          ],
        };
  }
}

class StubAgent {
  constructor(
    public name: string,
    public capabilities: string[],
  ) {}

  async execute(
    action: string,
    _params: Record<string, unknown>,
    requestId: string,
    stepId: string,
  ): Promise<{ success: boolean }> {
    for (const note of ['observing screen', 'resolving target', `running ${action}`]) {
      emit('executing', `  ${note}`, requestId, stepId);
      await sleep(450);
    }
    return { success: true };
  }
}

function main(): void {
  const registry = new AgentRegistry();
  registry.register(new StubAgent('StubSystem', ['can_control_os']) as never);
  registry.register(new StubAgent('StubDesktop', ['can_control_gui']) as never);

  const confirmations = new ConfirmationManager();
  const cancellation = new CancellationRegistry();
  const reliability = new ReliabilityLayer(new EvidenceStore('data/evidence'));
  const orchestrator = new Orchestrator(registry, reliability, false, confirmations, cancellation);
  const gateway = new Gateway(new OwnerGate({}), new StubBrain() as never, orchestrator);

  new DexServer(gateway, confirmations, cancellation, {
    port: parseInt(process.env.DEX_UI_PORT ?? '8770', 10),
    fullAccess: false,
    evidenceDir: 'data/evidence',
  }).start();

  console.log('Stub core running. Launch the Dex Bar and type anything.');
  console.log('Try "open notepad and save a note" for the multi-step GUI plan.');
}

main();
