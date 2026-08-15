import dotenv from 'dotenv';
dotenv.config();

import { OwnerGate } from '../core/owner_gate';
import { Brain } from '../core/brain/planner';
import { Gateway } from '../core/gateway';
import { AgentRegistry } from '../core/orchestrator/registry';
import { Orchestrator } from '../core/orchestrator/orchestrator';
import { ReliabilityLayer } from '../core/reliability/observation_engine';
import { EvidenceStore } from '../core/reliability/evidence_store';
import { SystemAgent } from '../agents/system/system_agent';
import { DesktopAgent } from '../agents/desktop/desktop_agent';
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

  const orchestrator = new Orchestrator(registry, reliability, fullAccess);
  const ownerGate = new OwnerGate({});
  const brain = new Brain(apiKey);
  const gateway = new Gateway(ownerGate, brain, orchestrator);

  startCli(gateway).catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}

main();
