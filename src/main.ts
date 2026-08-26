import dotenv from 'dotenv';
dotenv.config();

import { OwnerGate } from '../core/owner_gate';
import { Brain } from '../core/brain/planner';
import { Gateway } from '../core/gateway';
import { AgentRegistry } from '../core/orchestrator/registry';
import { Orchestrator } from '../core/orchestrator/orchestrator';
import { CancellationRegistry } from '../core/orchestrator/cancellation';
import { ConfirmationManager } from '../core/confirmation/confirmation_manager';
import { ReliabilityLayer } from '../core/reliability/observation_engine';
import { EvidenceStore } from '../core/reliability/evidence_store';
import { DexServer } from '../core/server/ws_server';
import { Telemetry } from '../core/memory/telemetry';
import { WorkflowStore } from '../core/workflows/store';
import { quietSqliteWarning } from '../core/memory/db';
import { SystemAgent } from '../agents/system/system_agent';
import { DesktopAgent } from '../agents/desktop/desktop_agent';
import { AppAgent } from '../agents/app/app_agent';
import { BrowserAgent } from '../agents/browser/browser_agent';
import { WorkspaceAgent } from '../agents/workspace/workspace_agent';
import { defaultRoutes, defaultServers } from '../agents/workspace/servers';
import { startCli } from '../channels/cli';

function main(): void {
  quietSqliteWarning();

  // Created before the Brain, which needs to read it to advertise workflows.
  const workflowStore = new WorkflowStore();

  // Which vendor answers is core/llm's business, not main's. All main needs to
  // know is whether *some* provider could be built, so it can say something
  // useful instead of throwing a stack trace at the owner.
  let brain: Brain;
  try {
    // The Brain is shown the saved workflows so it can pick one from any
    // phrasing — "make it louder" should reach the volume workflow even though
    // it shares no words with how it was saved.
    brain = new Brain(undefined, () =>
      workflowStore.list().map((w) => ({
        name: w.name,
        description: w.description,
        params: w.params,
        triggerText: w.triggerText,
        steps: w.template.length,
      })),
    );
  } catch (err) {
    console.error(`[31mERROR:[0m ${err instanceof Error ? err.message : err}`);
    process.exit(1);
    return;
  }
  console.log(`[90m[brain][0m ${brain.model}`);

  const fullAccess = process.env.FULL_ACCESS === 'true';
  if (fullAccess) {
    console.log('\x1b[32m[Full Access]\x1b[0m Daemon runs as LocalSystem — no admin prompts.');
  }

  const evidenceStore = new EvidenceStore('data/evidence');
  const reliability = new ReliabilityLayer(evidenceStore);

  const registry = new AgentRegistry();
  const systemAgent = new SystemAgent();
  registry.register(systemAgent);
  registry.register(new AppAgent());
  registry.register(new DesktopAgent());
  registry.register(new BrowserAgent());

  // MCP servers are spawned on first use, not here — starting three OAuth
  // handshakes at boot would make `npm run dev` feel broken for anyone who has
  // not connected an account yet.
  const workspace = new WorkspaceAgent({
    servers: defaultServers(),
    routes: defaultRoutes(),
  });
  registry.register(workspace);

  const confirmations = new ConfirmationManager();
  const cancellation = new CancellationRegistry();

  const telemetry = new Telemetry();

  const orchestrator = new Orchestrator(
    registry, reliability, fullAccess, confirmations, cancellation, telemetry,
  );
  const ownerGate = new OwnerGate({});
  const gateway = new Gateway(ownerGate, brain, orchestrator, telemetry, workflowStore);

  if (process.env.DEX_UI_SERVER !== 'false') {
    const server = new DexServer(gateway, confirmations, cancellation, {
      port: parseInt(process.env.DEX_UI_PORT ?? '8770', 10),
      fullAccess,
      evidenceDir: 'data/evidence',
    });
    server.start();
  }

  // Ask the daemon whether it implements everything the Brain will offer to
  // plan. Fire-and-forget: it must not delay the prompt, and a daemon that is
  // simply not running is a separate, already-reported condition.
  void systemAgent.checkForDrift().catch(() => undefined);

  // MCP servers are child processes. Without this they outlive the core and
  // pile up one orphan per restart.
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`
${signal} — closing workspace servers…`);
    await workspace.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  startCli(gateway, confirmations).catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}

main();
