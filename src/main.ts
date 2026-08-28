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
import { Scheduler } from '../core/scheduler/scheduler';
import { quietSqliteWarning } from '../core/memory/db';
import { DaemonDescription, SystemAgent } from '../agents/system/system_agent';
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

/**
 * Adapters that are running, so shutdown can close them.
 *
 * Declared above main() deliberately. main() is invoked at module load, and a
 * `const` further down the file is still in its temporal dead zone then — which
 * threw ReferenceError on every start until it was moved here.
 */
const started: ChannelAdapter[] = [];

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

  // DEX_FULL_ACCESS is the name; FULL_ACCESS is still read so an existing .env
  // keeps working. One idea had two names, which is one too many.
  const fullAccessConfigured =
    process.env.DEX_FULL_ACCESS === 'true' || process.env.FULL_ACCESS === 'true';

  // Configured is not the same as real. Full Access turns on only once the
  // daemon says it is actually elevated — see reportAccess below.
  let fullAccessEffective = false;

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
    registry, reliability, () => fullAccessEffective,
    confirmations, cancellation, telemetry,
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
      get fullAccess() {
        return fullAccessEffective;
      },
      evidenceDir: 'data/evidence',
    });
    server.start();
  }

  // Ask the daemon whether it implements everything the Brain will offer to
  // plan. Fire-and-forget: it must not delay the prompt, and a daemon that is
  // simply not running is a separate, already-reported condition.
  void systemAgent.checkForDrift().catch(() => undefined);

  // ...and whether Full Access is real, which only the daemon can answer.
  void systemAgent
    .describe()
    .then((daemon) => {
      fullAccessEffective = fullAccessConfigured && daemon?.elevated === true;
      reportAccess(fullAccessConfigured, fullAccessEffective, daemon);
    })
    .catch(() => undefined);

  // MCP servers are child processes. Without this they outlive the core and
  // pile up one orphan per restart.
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`
${signal} — closing workspace servers…`);
    scheduler.stop();
    await workspace.close().catch(() => undefined);
    await Promise.all(started.map((c) => c.stop().catch(() => undefined)));
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Schedules fire whether or not anyone is watching, so they are started
  // last — after the agents are registered and the daemon has been asked what
  // it can do. A schedule that fires into a half-built registry is worse than
  // one that fires a few seconds late.
  const scheduler = new Scheduler(gateway);
  scheduler.start();

  void startChannels(gateway, ownerGate, confirmations, credentials);

  // Headless: no console, so no CLI. `startCli` builds a readline over stdin,
  // and with no console stdin is already closed — `close` fires at once and the
  // prompt ends before it starts. The Dex Bar is the interface; the WebSocket
  // server is what keeps the process alive.
  if (process.env.DEX_HEADLESS === 'true') {
    console.log('[headless] no console — the Dex Bar is the interface.');
    return;
  }

  startCli(gateway, confirmations).catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}

/**
 * Say what Full Access is actually doing, once, in one line.
 *
 * Configured-but-not-elevated was previously invisible, and it is the worst
 * state available: confirmations skipped for privileged actions that then fail
 * at the daemon anyway. It now downgrades to cards and says why.
 */
function reportAccess(
  configured: boolean,
  effective: boolean,
  daemon: DaemonDescription | null,
): void {
  if (!configured) return;

  if (effective) {
    const red = daemon?.allow_red ? 'RED unlocked (always confirmed)' : 'RED locked';
    console.log(
      `[32m[Full Access] ON[0m  elevated, session ${daemon?.session_id}, ` +
        `confirmations bypassed, ${red}`,
    );
    return;
  }

  console.log(
    '[33m[Full Access] OFF[0m  configured, but the daemon is not ' +
      'elevated — using confirmation cards.',
  );
  console.log(
    '                       Fix it once:  .\scripts\install-daemon-service.ps1',
  );
}

main();



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
