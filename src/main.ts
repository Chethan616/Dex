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
import { ChannelAdapter, ChannelRuntime } from '../channels/base_channel';
import { TelegramChannel } from '../channels/telegram';
import { DiscordChannel } from '../channels/discord';
import { WhatsAppChannel } from '../channels/whatsapp';
import { CredentialStore } from '../core/secrets/credential_store';

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
  const credentials = new CredentialStore();

  // Owner identity per channel. Ids are not secret — they are the equivalent of
  // a username — so they read from the environment; the bot *tokens* below come
  // from the OS credential store.
  const ownerGate = new OwnerGate({
    telegram_id: process.env.DEX_OWNER_TELEGRAM ?? null,
    discord_id: process.env.DEX_OWNER_DISCORD ?? null,
    whatsapp: process.env.DEX_OWNER_WHATSAPP ?? null,
    trigger_prefix: process.env.DEX_TRIGGER_PREFIX ?? '@dex',
  });
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
    await Promise.all(started.map((c) => c.stop().catch(() => undefined)));
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  void startChannels(gateway, ownerGate, confirmations, credentials);

  startCli(gateway, confirmations).catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}

main();


/** Adapters that are running, so shutdown can close them. */
const started: ChannelAdapter[] = [];

/**
 * Start every channel the owner has actually configured.
 *
 * A channel needs two things: a bot token, and the owner's id on that platform.
 * Missing either is a normal state — most people will not wire up all three —
 * so it is reported once and skipped, never treated as an error.
 *
 * Refusing to start without an owner id is deliberate rather than defensive:
 * a bot listening with no configured owner would reject every message anyway,
 * and a bot that is *running* but silently ignoring everything is far harder to
 * diagnose than one that says why it did not start.
 */
async function startChannels(
  gateway: Gateway,
  ownerGate: OwnerGate,
  confirmations: ConfirmationManager,
  credentials: CredentialStore,
): Promise<void> {
  const runtime = new ChannelRuntime(gateway, ownerGate, confirmations);

  const telegramToken = credentials.resolve('telegram_bot_token', 'TELEGRAM_BOT_TOKEN');
  if (telegramToken && process.env.DEX_OWNER_TELEGRAM) {
    started.push(new TelegramChannel(telegramToken, runtime));
  } else if (telegramToken) {
    console.warn('[33m[telegram][0m token found but DEX_OWNER_TELEGRAM is unset — not starting.');
  }

  const discordToken = credentials.resolve('discord_bot_token', 'DISCORD_BOT_TOKEN');
  if (discordToken && process.env.DEX_OWNER_DISCORD) {
    started.push(new DiscordChannel(discordToken, runtime));
  } else if (discordToken) {
    console.warn('[33m[discord][0m token found but DEX_OWNER_DISCORD is unset — not starting.');
  }

  // WhatsApp pairs by QR rather than a token, so its opt-in is explicit.
  if (process.env.DEX_WHATSAPP === 'true' && process.env.DEX_OWNER_WHATSAPP) {
    started.push(new WhatsAppChannel(runtime));
  }

  for (const channel of started) {
    try {
      await channel.start();
    } catch (err) {
      // One channel failing to connect must not take the others, or the CLI,
      // down with it.
      console.warn(
        `[33m[${channel.name.toLowerCase()}][0m did not start — ` +
          `${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
