/**
 * Slice 3 smoke test: protocol + stale-approval guard + cancellation.
 * Runs the real DexServer / ConfirmationManager / Orchestrator against a stub agent.
 */
import * as fs from 'fs';
import WebSocket from 'ws';
import { DexServer } from '../core/server/ws_server';
import { ConfirmationManager, stepVersion } from '../core/confirmation/confirmation_manager';
import { CancellationRegistry } from '../core/orchestrator/cancellation';
import { Orchestrator } from '../core/orchestrator/orchestrator';
import { AgentRegistry } from '../core/orchestrator/registry';
import { ReliabilityLayer } from '../core/reliability/observation_engine';
import { EvidenceStore } from '../core/reliability/evidence_store';
import { Gateway } from '../core/gateway';
import { OwnerGate } from '../core/owner_gate';
import { handshakePath } from '../core/server/handshake';
import { ExecutionPlan, ExecutionStep } from '../core/events/types';

const PORT = 8899;
let failures = 0;
function check(name: string, ok: boolean, extra = ''): void {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
}

// set_volume, not set_dns: the stub agent only pretends to act, and the
// Reliability Layer would (correctly) fail a set_dns read-back against the
// real machine. set_volume has no read-back yet, so it lands UNVERIFIABLE and
// the orchestrator completes — which is what this test is actually exercising.
const step: ExecutionStep = {
  id: 'step_1',
  capability: 'can_control_os',
  action: 'set_volume',
  params: { level: 40 },
  confirmationTier: 2,
  dependsOn: [],
};

const plan: ExecutionPlan = {
  requestId: 'req-smoke-0001',
  intent: 'Set system volume to 40',
  tier: 1,
  steps: [step],
};

class StubBrain {
  async plan(): Promise<ExecutionPlan> {
    return plan;
  }
}

class StubAgent {
  name = 'StubAgent';
  capabilities = ['can_control_os'];
  async execute(): Promise<{ success: boolean }> {
    return { success: true };
  }
}

/** Submit once, answer any card with [verdict], and report what happened. */
function runOnce(
  ws: WebSocket,
  verdict: string,
): Promise<{ raisedCard: boolean; status: string }> {
  return new Promise((resolve) => {
    let raisedCard = false;
    const handler = (raw: WebSocket.RawData): void => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'confirmation') {
        raisedCard = true;
        ws.send(JSON.stringify({
          type: 'respond',
          requestId: msg.request.requestId,
          stepId: msg.request.stepId,
          stepVersion: msg.request.stepVersion,
          verdict,
        }));
      }
      if (msg.type === 'result') {
        ws.off('message', handler);
        resolve({ raisedCard, status: msg.status as string });
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ type: 'submit', text: 'set my volume to 40' }));
  });
}

function requestStatus(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const handler = (raw: WebSocket.RawData): void => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'status') {
        ws.off('message', handler);
        resolve(msg as Record<string, unknown>);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ type: 'get_status' }));
  });
}

async function main(): Promise<void> {
  const registry = new AgentRegistry();
  registry.register(new StubAgent() as never);

  const confirmations = new ConfirmationManager(8000);
  const cancellation = new CancellationRegistry();
  const reliability = new ReliabilityLayer(new EvidenceStore('data/evidence'));
  const orchestrator = new Orchestrator(registry, reliability, false, confirmations, cancellation);
  const gateway = new Gateway(new OwnerGate({}), new StubBrain() as never, orchestrator);

  const server = new DexServer(gateway, confirmations, cancellation, {
    port: PORT,
    fullAccess: false,
    evidenceDir: 'data/evidence',
  });
  server.start();

  const hs = JSON.parse(fs.readFileSync(handshakePath(), 'utf8'));
  check('handshake file written with port + token', hs.port === PORT && typeof hs.token === 'string' && hs.token.length > 20);

  // --- 1. bad token is rejected ------------------------------------------
  await new Promise<void>((resolve) => {
    const bad = new WebSocket(`ws://127.0.0.1:${PORT}`);
    bad.on('open', () => bad.send(JSON.stringify({ type: 'auth', token: 'wrong-token' })));
    bad.on('close', (code) => {
      check('bad token closes the socket', code === 4403, `code ${code}`);
      resolve();
    });
    setTimeout(() => { check('bad token closes the socket', false, 'timed out'); resolve(); }, 3000);
  });

  // --- 2. unauthenticated command is refused ------------------------------
  await new Promise<void>((resolve) => {
    const rude = new WebSocket(`ws://127.0.0.1:${PORT}`);
    rude.on('open', () => rude.send(JSON.stringify({ type: 'submit', text: 'do a thing' })));
    rude.on('close', (code) => {
      check('command before auth closes the socket', code === 4401, `code ${code}`);
      resolve();
    });
    setTimeout(() => { check('command before auth closes the socket', false, 'timed out'); resolve(); }, 3000);
  });

  // --- 3. full flow --------------------------------------------------------
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  const events: string[] = [];
  let confirmation: { stepVersion: string; description: string; tier: number } | undefined;
  const acks: Array<{ accepted: boolean; reason?: string }> = [];
  let result: { status: string; summary: string } | undefined;

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: hs.token })));
    ws.on('error', reject);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      switch (msg.type) {
        case 'ready':
          check('auth succeeds and returns ready', msg.fullAccess === false && Array.isArray(msg.pending));
          ws.send(JSON.stringify({ type: 'submit', text: 'set my dns to 1.1.1.1' }));
          break;
        case 'event':
          events.push(msg.event.type);
          break;
        case 'confirmation':
          confirmation = msg.request;
          // Stale card first: right step, wrong version.
          ws.send(JSON.stringify({
            type: 'respond',
            requestId: msg.request.requestId,
            stepId: msg.request.stepId,
            stepVersion: 'deadbeef0000',
            verdict: 'approved',
          }));
          break;
        case 'respond_ack':
          acks.push(msg);
          if (acks.length === 1) {
            // Now the real one.
            ws.send(JSON.stringify({
              type: 'respond',
              requestId: confirmation ? plan.requestId : plan.requestId,
              stepId: 'step_1',
              stepVersion: confirmation!.stepVersion,
              verdict: 'approved',
            }));
          }
          break;
        case 'result':
          result = msg;
          resolve();
          break;
      }
    });
    setTimeout(() => reject(new Error('flow timed out')), 20000);
  });

  check('a Tier 2 step raises a confirmation card', confirmation !== undefined);
  check(
    'card carries the exact action, not a paraphrase',
    confirmation?.description === 'set_volume (level=40)',
    confirmation?.description,
  );
  check(
    'card version matches the step content hash',
    confirmation?.stepVersion === stepVersion(step),
  );
  check('stale approval is rejected', acks[0]?.accepted === false, acks[0]?.reason);
  check('matching approval is accepted', acks[1]?.accepted === true);
  check('awaiting event reached the client', events.includes('awaiting'));
  check('planning event reached the client', events.includes('planning'));
  check('task reached a terminal state', result?.status === 'COMPLETED', result?.status);

  // --- 4. rejection cancels the task --------------------------------------
  const rejectRun = new Promise<string>((resolve) => {
    const handler = (raw: WebSocket.RawData): void => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'confirmation') {
        ws.send(JSON.stringify({
          type: 'respond',
          requestId: msg.request.requestId,
          stepId: msg.request.stepId,
          stepVersion: msg.request.stepVersion,
          verdict: 'rejected',
        }));
      }
      if (msg.type === 'result') {
        ws.off('message', handler);
        resolve(msg.status as string);
      }
    };
    ws.on('message', handler);
  });
  ws.send(JSON.stringify({ type: 'submit', text: 'set my volume to 40' }));
  check('rejecting a card cancels the task', (await rejectRun) === 'CANCELLED');

  // --- 5. Tier 2 cannot be pre-approved -----------------------------------
  // The client asks for a session pass on a Tier 2 step. The core must approve
  // this once and NOT remember it, so the next run asks again.
  const askedAgain = await runOnce(ws, 'approved_session');
  check('Tier 2 session pass is downgraded to approve-once', askedAgain.raisedCard);
  const secondTime = await runOnce(ws, 'approved');
  check('Tier 2 asks again on the next run', secondTime.raisedCard);

  const status1 = await requestStatus(ws);
  check(
    'no Tier 2 pre-approval was recorded',
    (status1.preApprovals as string[]).length === 0,
    JSON.stringify(status1.preApprovals),
  );

  // --- 6. Tier 3 pre-approval sticks for the session -----------------------
  step.confirmationTier = 3;
  const tier3First = await runOnce(ws, 'approved_session');
  check('Tier 3 raises a card the first time', tier3First.raisedCard);

  const status2 = await requestStatus(ws);
  check(
    'Tier 3 pre-approval is recorded',
    (status2.preApprovals as string[]).includes('can_control_os:set_volume'),
    JSON.stringify(status2.preApprovals),
  );

  const tier3Second = await runOnce(ws, 'approved');
  check('Tier 3 does not ask again this session', !tier3Second.raisedCard);
  check('pre-approved run still completes', tier3Second.status === 'COMPLETED');

  ws.send(JSON.stringify({ type: 'clear_preapprovals' }));
  const status3 = await requestStatus(ws);
  check('clearing revokes the pre-approval', (status3.preApprovals as string[]).length === 0);

  const tier3Third = await runOnce(ws, 'approved');
  check('Tier 3 asks again after revoking', tier3Third.raisedCard);

  ws.close();
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('smoke test crashed:', err);
  process.exit(1);
});
