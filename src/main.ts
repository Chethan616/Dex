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
import { SystemAgent } from '../agents/system/system_agent';
import { DesktopAgent } from '../agents/desktop/desktop_agent';
import { BrowserAgent } from '../agents/browser/browser_agent';
import { WorkspaceAgent } from '../agents/workspace/workspace_agent';
import { defaultRoutes, defaultServers } from '../agents/workspace/servers';
import { startCli } from '../channels/cli';

function main(): void {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('\x1b[31mERROR: ANTHROPIC_API_KEY not set.\x1b[0m Copy .env.example to .env and add your key.');
    process.exit(1);
  }

  const fullAccess = process.env.FULL_ACCESS === 'true';
  if (fullAccess) {
    console.log('\x1b[32m[Full Access]\x1b[0m Daemon runs as LocalSystem — no admin prompts.');
  }

  const evidenceStore = new EvidenceStore('data/evidence');
  const reliability = new ReliabilityLayer(evidenceStore);

  const registry = new AgentRegistry();
  registry.register(new SystemAgent());
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

  const orchestrator = new Orchestrator(registry, reliability, fullAccess, confirmations, cancellation);
  const ownerGate = new OwnerGate({});
  const brain = new Brain(apiKey);
  const gateway = new Gateway(ownerGate, brain, orchestrator);

  if (process.env.DEX_UI_SERVER !== 'false') {
    const server = new DexServer(gateway, confirmations, cancellation, {
      port: parseInt(process.env.DEX_UI_PORT ?? '8770', 10),
      fullAccess,
      evidenceDir: 'data/evidence',
    });
    server.start();
  }

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
