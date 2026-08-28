/**
 * Memory, end to end through the real Gateway.
 *
 * The units are covered in smoke_memory.ts. What this proves is the wiring
 * between them, which is where integration bugs actually live: does an artifact
 * recorded by the Orchestrator reach the ReferenceResolver on the *next*
 * request, does the resolved locator reach the agent, and does an ambiguous
 * reference genuinely stop a task rather than being logged and ignored.
 *
 * Uses a stub Brain and a stub agent so the result is deterministic and needs
 * no API key. The Gateway, Orchestrator, ArtifactStore, SessionStore and
 * ReferenceResolver are all the real ones.
 *
 * Run: npm run test:e2e-memory
 */
import './support/isolate';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { closeDb, db, quietSqliteWarning } from '../core/memory/db';

const TEMP_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dex-e2emem-')), 'test.db');
quietSqliteWarning();
db(TEMP_DB);

// eslint-disable-next-line import/first
import { AgentResult, DexRequest, ExecutionPlan } from '../core/events/types';
// eslint-disable-next-line import/first
import { Brain } from '../core/brain/planner';
// eslint-disable-next-line import/first
import { ConfirmationManager } from '../core/confirmation/confirmation_manager';
// eslint-disable-next-line import/first
import { Gateway } from '../core/gateway';
// eslint-disable-next-line import/first
import { ArtifactStore } from '../core/memory/artifacts';
// eslint-disable-next-line import/first
import { EvidenceStore } from '../core/reliability/evidence_store';
// eslint-disable-next-line import/first
import { CancellationRegistry } from '../core/orchestrator/cancellation';
// eslint-disable-next-line import/first
import { Orchestrator } from '../core/orchestrator/orchestrator';
// eslint-disable-next-line import/first
import { AgentRegistry } from '../core/orchestrator/registry';
// eslint-disable-next-line import/first
import { OwnerGate } from '../core/owner_gate';
// eslint-disable-next-line import/first
import { ReliabilityLayer } from '../core/reliability/observation_engine';

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? `\n      ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

/** A real file, so verifyGuiStep's existence check actually passes. */
const REPORT = path.join(os.tmpdir(), 'dex_e2e_Q3_Report.pdf');
fs.writeFileSync(REPORT, 'not really a pdf');

/** Records exactly what text the agent was handed. */
class RecordingAgent {
  name = 'RecordingAgent';
  capabilities = ['can_control_gui'];
  seen: Array<Record<string, unknown>> = [];

  async execute(_action: string, params: Record<string, unknown>): Promise<AgentResult> {
    this.seen.push(params);
    return { success: true, data: {} };
  }
}

/** Plans one step that "produces" the report, echoing the request text. */
class StubBrain extends Brain {
  calls: string[] = [];

  constructor() {
    super({ label: 'stub', callTool: async () => ({}) });
  }

  async plan(request: DexRequest): Promise<ExecutionPlan> {
    this.calls.push(request.text);
    return {
      requestId: request.requestId,
      intent: 'produce the report',
      tier: 1,
      steps: [{
        id: 'step_1',
        capability: 'can_control_gui',
        action: 'run_task',
        // The request text rides along, so the test can see whether the
        // resolved locator actually reached the agent.
        params: { task: request.text, verify_file: REPORT },
        confirmationTier: 4,
        dependsOn: [],
      }],
    };
  }
}

function build() {
  const agent = new RecordingAgent();
  const registry = new AgentRegistry();
  registry.register(agent as never);

  const orchestrator = new Orchestrator(
    registry,
    new ReliabilityLayer(new EvidenceStore(path.join(os.tmpdir(), 'dex-e2emem-evidence'))),
    false,
    new ConfirmationManager(3_000, 3_000),
    new CancellationRegistry(),
  );

  const brain = new StubBrain();
  const gateway = new Gateway(new OwnerGate({}), brain, orchestrator);
  return { gateway, agent, brain };
}

async function main(): Promise<void> {
  console.log('\x1b[1mMemory end-to-end — through the real Gateway\x1b[0m');

  section('An artifact from one task is referable in the next');

  const { gateway, agent } = build();

  const first = await gateway.handle('cli', 'owner', 'make me a report');
  check('the first task completes', first.status === 'COMPLETED', first.summary);

  const artifacts = new ArtifactStore().recent(10);
  check(
    'and the Orchestrator recorded what it produced',
    artifacts.some((a) => a.name === path.basename(REPORT)),
    JSON.stringify(artifacts.map((a) => a.name)),
  );
  check(
    'attributed to the session it happened in',
    artifacts[0]?.sessionId?.length > 0,
    JSON.stringify(artifacts[0]),
  );

  // The point of the whole slice: a later request says "the report" and the
  // agent receives a path.
  const second = await gateway.handle('cli', 'owner', 'email me the report');
  check('the follow-up completes', second.status === 'COMPLETED', second.summary);

  const handed = String(agent.seen[agent.seen.length - 1]?.task ?? '');
  check(
    'the agent was handed the actual file, not the words "the report"',
    handed.includes(REPORT),
    handed,
  );

  section('A follow-up from a different channel joins the same conversation');

  const before = new ArtifactStore().recent(1)[0];
  await gateway.handle('telegram', 'owner', 'email me the report');
  const after = new ArtifactStore().recent(1)[0];
  check(
    'the session carries across channels',
    before.sessionId === after.sessionId,
    `${before.sessionId} vs ${after.sessionId}`,
  );

  section('An ambiguous reference stops the task');

  // A second, equally good candidate, close enough in time that recency
  // cannot break the tie.
  const store = new ArtifactStore();
  const now = Date.now();
  db().prepare('UPDATE artifacts SET created_at = ?').run(now - 60_000);
  store.save({
    requestId: 'x', sessionId: 's', kind: 'file',
    name: 'Q4_Report.pdf', locator: 'C:\\docs\\Q4_Report.pdf',
  });
  db().prepare("UPDATE artifacts SET created_at = ? WHERE name = 'Q4_Report.pdf'")
    .run(now - 30_000);

  const callsBefore = agent.seen.length;
  const third = await gateway.handle('cli', 'owner', 'email me the report');

  check(
    'the task is ABORTED, not guessed at',
    third.status === 'ABORTED',
    `${third.status} — ${third.summary}`,
  );
  check(
    'nothing was executed',
    agent.seen.length === callsBefore,
    `agent ran ${agent.seen.length - callsBefore} extra time(s)`,
  );
  check(
    'and the owner is asked which one, by name',
    Boolean(third.needsClarification?.includes('Q3_Report.pdf')) &&
      Boolean(third.needsClarification?.includes('Q4_Report.pdf')),
    third.needsClarification,
  );

  section('Naming it resolves the ambiguity');

  const fourth = await gateway.handle('cli', 'owner', 'email me the q4_report.pdf');
  check('the task runs once named', fourth.status === 'COMPLETED', fourth.summary);
  check(
    'and the right one was chosen',
    String(agent.seen[agent.seen.length - 1]?.task ?? '').includes('Q4_Report.pdf'),
    String(agent.seen[agent.seen.length - 1]?.task ?? ''),
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  closeDb();
  for (const p of [REPORT, path.dirname(TEMP_DB)]) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch {
      /* leftovers are not worth failing a green run over */
    }
  }
  if (failed > 0) process.exit(1);
  console.log('\x1b[32mAll checks passed\x1b[0m');
  process.exit(0);
}

void main();
