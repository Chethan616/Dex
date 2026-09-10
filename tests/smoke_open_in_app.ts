import './support/isolate';
/**
 * A multi-step, multi-capability plan actually executes end to end.
 *
 *     npm run test:open-in-app
 *
 * The gap this closes, found live: "download the Wikipedia homepage and
 * open it in VS Code" failed, and not because step-to-step value passing was
 * broken — smoke_step_refs.ts already proved that mechanism works — but
 * because no action existed that could take a path and open it in a named
 * app. `open_file_in_app` fills that gap (agents/browser side has the mirror
 * fix, download_media, covered by tests/test_download_media.py).
 *
 * What matters here specifically: this crosses TWO capabilities
 * (can_control_files -> can_control_os), which no existing smoke test does —
 * smoke_step_refs.ts tests resolution in isolation with synthetic fixtures,
 * and smoke_repair.ts stays within can_control_os throughout. This is the
 * first test that runs a plan spanning two different capabilities through
 * the real Orchestrator and checks the second one receives the first one's
 * resolved output, not the placeholder string.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Orchestrator } from '../core/orchestrator/orchestrator';
import { AgentRegistry } from '../core/orchestrator/registry';
import { ReliabilityLayer } from '../core/reliability/observation_engine';
import { EvidenceStore } from '../core/reliability/evidence_store';
import { ConfirmationManager } from '../core/confirmation/confirmation_manager';
import { CancellationRegistry } from '../core/orchestrator/cancellation';
import { AgentResult, ExecutionPlan } from '../core/events/types';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${label}`);
  else {
    failures += 1;
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

/** Stands in for both the file agent and the daemon in one fake, for this test only. */
class FakeAgent {
  name = 'FakeFilesAndOS';
  capabilities = ['can_control_files', 'can_control_os'];
  readonly calls: Array<{ action: string; params: Record<string, unknown> }> = [];
  downloadShouldFail = false;

  async execute(action: string, params: Record<string, unknown>): Promise<AgentResult> {
    this.calls.push({ action, params: JSON.parse(JSON.stringify(params)) });

    if (action === 'download_file') {
      if (this.downloadShouldFail) {
        return { success: false, error: 'ENOTFOUND: could not reach the host' };
      }
      // download_file's own verification checks real disk state (fs.existsSync
      // + byte count) — a fake path would make that step FAIL for reasons
      // unrelated to what this test is actually proving, so this writes a
      // real, small file the same way the real handler would have.
      const content = '<html><body>Wikipedia Main Page (fake, for this test)</body></html>';
      const target = path.join(os.tmpdir(), `dex-test-Main_Page-${Date.now()}.html`);
      fs.writeFileSync(target, content, 'utf8');
      return {
        success: true,
        data: { path: target, name: path.basename(target), bytes: Buffer.byteLength(content, 'utf8') },
      };
    }

    if (action === 'open_file_in_app') {
      const path = String(params.path ?? '');
      const app = String(params.app ?? '');
      return {
        success: true,
        data: { launched: app || 'default handler', path: 'code.exe', file: path, image: 'Code', found_via: 'known' },
      };
    }

    return { success: true, data: { ok: true } };
  }
}

function build(agent: FakeAgent) {
  const registry = new AgentRegistry();
  registry.register(agent as never);

  const confirmations = new ConfirmationManager(5_000, 5_000);
  confirmations.registerProvider({
    name: 'test',
    present(request) {
      setTimeout(() => {
        confirmations.respond(request.requestId, request.stepId, request.stepVersion, 'approved');
      }, 0);
    },
    withdraw() {},
  });

  return new Orchestrator(
    registry,
    new ReliabilityLayer(new EvidenceStore('data/test-evidence')),
    () => true,
    confirmations,
    new CancellationRegistry(),
  );
}

/** "download the Wikipedia homepage and open it in VS Code", as a plan. */
function wikipediaPlan(): ExecutionPlan {
  return {
    requestId: `req_${Math.random().toString(36).slice(2, 10)}`,
    intent: 'Download the Wikipedia homepage and open it in VS Code',
    tier: 2,
    steps: [
      {
        id: 'step_1',
        capability: 'can_control_files',
        action: 'download_file',
        params: { url: 'https://en.wikipedia.org/wiki/Main_Page' },
        confirmationTier: 4,
        dependsOn: [],
      },
      {
        id: 'step_2',
        capability: 'can_control_os',
        action: 'open_file_in_app',
        params: { path: '{{step_1.output.path}}', app: 'code' },
        confirmationTier: 4,
        dependsOn: ['step_1'],
      },
    ],
  };
}

async function main(): Promise<void> {
  console.log('— a plan spanning two capabilities executes end to end —');

  {
    const agent = new FakeAgent();
    const orchestrator = build(agent);
    const result = await orchestrator.execute(wikipediaPlan());

    check('the task completes', result.status === 'COMPLETED', result.summary);

    const downloadCall = agent.calls.find((c) => c.action === 'download_file');
    const openCall = agent.calls.find((c) => c.action === 'open_file_in_app');
    check('open_file_in_app was called', !!openCall);
    check(
      'it received the RESOLVED path, not the placeholder string',
      typeof openCall?.params.path === 'string'
        && openCall.params.path !== '{{step_1.output.path}}'
        && fs.existsSync(String(openCall.params.path)),
      String(openCall?.params.path),
    );
    check('the app name passed through unresolved (a plain literal, not a reference)',
      openCall?.params.app === 'code', String(openCall?.params.app));
    check('download_file ran first', agent.calls.indexOf(downloadCall!) === 0);

    if (typeof downloadCall?.params === 'object') {
      // Cleanup: the fake download wrote a real temp file.
      const written = agent.calls.find((c) => c.action === 'open_file_in_app')?.params.path;
      if (typeof written === 'string' && fs.existsSync(written)) fs.unlinkSync(written);
    }
  }

  console.log('\n— dependsOn is honored: a failed download never lets the open step run —');

  {
    const agent = new FakeAgent();
    agent.downloadShouldFail = true;
    const orchestrator = build(agent);
    const result = await orchestrator.execute(wikipediaPlan());

    check('the task fails', result.status === 'FAILED', result.summary);
    check(
      'open_file_in_app was never called',
      !agent.calls.some((c) => c.action === 'open_file_in_app'),
      'a dependent step ran after its dependency failed',
    );
  }

  console.log();
  if (failures > 0) {
    console.log(`${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('PASSED  a multi-capability plan resolves values across the boundary and honors dependsOn.');
}

void main();
