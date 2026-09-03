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
import { DeliveryAgent } from '../agents/delivery/delivery_agent';
import { WorkspaceAgent } from '../agents/workspace/workspace_agent';
import { FileAgent } from '../agents/files/file_agent';
import { defaultRoutes, defaultServers } from '../agents/workspace/servers';
import { startCli } from '../channels/cli';
import { ChannelAdapter, ChannelRuntime } from '../channels/base_channel';
import { ChannelManager } from '../channels/manager';
import { CredentialStore } from '../core/secrets/credential_store';
import { mirrorConsoleToFile, closeLogFile } from '../core/logging/file_log';
import { readConfig } from '../core/settings/config_store';

/**
 * Adapters that are running, so shutdown can close them.
 *
 * Declared above main() deliberately. main() is invoked at module load, and a
 * `const` further down the file is still in its temporal dead zone then — which
 * threw ReferenceError on every start until it was moved here.
 */
const started: ChannelAdapter[] = [];

/** Held so shutdown can close the chat channels it started. */
let channelManager: ChannelManager | undefined;

function main(): void {
  quietSqliteWarning();

  // Before anything else that might have something to say.
  //
  // Headless means started by the app, with no console and no shell
  // redirecting stdout. Everything printed from here on would otherwise go to
  // a console nobody can see and be kept nowhere — leaving the core as the one
  // process in Dex with no diagnostics, in the release where it also became
  // the one nobody launches from a terminal.
  if (process.env.DEX_HEADLESS === 'true') {
    const file = mirrorConsoleToFile('core');
    process.on('exit', closeLogFile);
    if (file) console.log(`\x1b[90m[log]\x1b[0m ${file}`);
  }

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

  // Settings first, environment second — the same order as everything else the
  // app owns.
  //
  // This read only the environment, which is why granting Full Access appeared
  // to do nothing: the install script set a *Machine* variable, and a Machine
  // variable does not reach a process that is already running. The owner granted
  // it, the core kept saying it was off, and the only fix was a logout. It is a
  // setting now, and settings.json is re-read on the next start.
  //
  // DEX_FULL_ACCESS and FULL_ACCESS are both still honoured so an existing
  // checkout keeps working.
  const fullAccessConfigured =
    readConfig().fullAccess === true ||
    process.env.DEX_FULL_ACCESS === 'true' ||
    process.env.FULL_ACCESS === 'true';

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
  registry.register(new DeliveryAgent());
  registry.register(new FileAgent());

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

  // Who is allowed to talk to Dex, from the settings the pairing screen writes.
  //
  // An id is not a secret — it is the equivalent of a username — so it lives in
  // settings.json with the rest of the configuration. The bot *tokens* go to
  // the OS credential store and never appear here.
  //
  // This read `DEX_OWNER_TELEGRAM` and friends while `telegramOwner` sat in
  // the settings store being written by Settings and read by the health check.
  // The consequence was worse than an inconsistent status: a channel paired in
  // the app would start, receive the owner's message, and reject it, because
  // the gate was looking at an environment variable nobody had set. The
  // environment is still read as a fallback, for a checkout that has one.
  const ownerConfig = readConfig();
  const ownerGate = new OwnerGate({
    telegram_id: ownerConfig.telegramOwner || process.env.DEX_OWNER_TELEGRAM || null,
    discord_id: ownerConfig.discordOwner || process.env.DEX_OWNER_DISCORD || null,
    whatsapp: ownerConfig.whatsappOwner || process.env.DEX_OWNER_WHATSAPP || null,
    trigger_prefix: process.env.DEX_TRIGGER_PREFIX ?? '@dex',
  });
  const gateway = new Gateway(ownerGate, brain, orchestrator, telemetry, workflowStore);

  let uiServer: DexServer | undefined;
  if (process.env.DEX_UI_SERVER !== 'false') {
    const server = new DexServer(gateway, confirmations, cancellation, {
      port: parseInt(process.env.DEX_UI_PORT ?? '8770', 10),
      get fullAccess() {
        return fullAccessEffective;
      },
      evidenceDir: 'data/evidence',
      // For the composer's Take screenshot, which is a direct Tier 4 read.
      agents: registry,
      // So Settings can prove an account connects rather than reporting
      // that a credential was typed into a box.
      workspace,
      // Called after the Full Access script finishes, so the toggle reflects
      // what the daemon says rather than what the script intended. Re-reads
      // settings.json too: the script wrote the owner's choice there, and this
      // process still has the value it read at startup.
      recheckFullAccess: async () => {
        const configured =
          readConfig().fullAccess === true ||
          process.env.DEX_FULL_ACCESS === 'true' ||
          process.env.FULL_ACCESS === 'true';
        const daemon = await systemAgent.describe().catch(() => null);
        fullAccessEffective = configured && daemon?.elevated === true;
        reportAccess(configured, fullAccessEffective, daemon);
        return fullAccessEffective;
      },
    });
    void server.start();
    // Kept, so the chat channels can be handed over once they connect. They
    // start later and take as long as a network round trip to Telegram.
    uiServer = server;
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
    await channelManager?.stopAll().catch(() => undefined);
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

  // Not awaited: a chat platform that is slow to connect must not hold up the
  // rest of the core. The manager is handed to the socket as soon as it
  // exists, so the Settings screen can pair a channel the moment it opens.
  void startChannels(gateway, ownerGate, confirmations, credentials).then(
    (manager) => {
      channelManager = manager;
      uiServer?.useChannels(manager);
    },
  );

  // Headless: no console, so no CLI. `startCli` builds a readline over stdin,
  // and with no console stdin is already closed — `close` fires at once and the
  // prompt ends before it starts. The Dex app is the interface; the WebSocket
  // server is what keeps the process alive.
  if (process.env.DEX_HEADLESS === 'true') {
    console.log('[headless] no console — the Dex app is the interface.');
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
    // Raw string: in a normal one, \s and \i are just "s" and "i", and this
    // line printed ".scriptsinstall-daemon-service.ps1" — an instruction that
    // cannot be followed, in the message telling someone how to fix Dex.
    String.raw`                       Fix it once:  .\scripts\install-daemon-service.ps1`,
  );
}

main();



/**
 * Start every channel the owner has actually configured.
 *
 * A channel needs two things: a way in (a bot token, or a scanned QR code) and
 * the owner's id on that platform. Missing either is a normal state — most
 * people will not wire up all three — so it is reported and skipped, never
 * treated as an error.
 *
 * Refusing to start without an owner id is deliberate rather than defensive: a
 * bot listening with no configured owner would reject every message anyway,
 * and a bot that is *running* but silently ignoring everything is far harder
 * to diagnose than one that says why it did not start.
 *
 * **Where the configuration comes from changed here.** The owner ids were read
 * from `process.env.DEX_OWNER_TELEGRAM` and friends, while the settings store
 * already had `telegramOwner`, the Settings screen already wrote it, and the
 * health check already read it. So the screen could report Telegram ready
 * while this function, looking somewhere else entirely, had never started it.
 * A status computed from different facts than the behaviour is worse than no
 * status at all.
 *
 * The channels now live in a ChannelManager, which also means pairing takes
 * effect where the owner made it instead of at the next restart.
 */
async function startChannels(
  gateway: Gateway,
  ownerGate: OwnerGate,
  confirmations: ConfirmationManager,
  credentials: CredentialStore,
): Promise<ChannelManager> {
  const runtime = new ChannelRuntime(gateway, ownerGate, confirmations);
  const manager = new ChannelManager(runtime, credentials);

  for (const state of await manager.sync()) {
    if (state.running) {
      console.log(`\x1b[32m[${state.id}]\x1b[0m connected.`);
    } else if (state.error) {
      console.warn(`\x1b[33m[${state.id}]\x1b[0m did not start — ${state.error}`);
    } else if (state.reason !== 'not set up' && state.reason !== 'not switched on') {
      console.warn(`\x1b[33m[${state.id}]\x1b[0m ${state.reason}.`);
    }
  }

  // The device mesh — reaching this PC from a phone with no shared network.
  //
  // Not in the manager: it has no token, no owner id and no pairing screen
  // yet, and folding it in ahead of the implementation would mean inventing
  // its configuration twice. It is still a ChannelAdapter, which is what earns
  // it the owner gate, the live step stream, confirmation cards and file
  // delivery without writing any of them again. See docs/MESH.md.
  const mesh = readConfig();
  if (mesh.meshEnabled && mesh.meshRelayUrl) {
    try {
      // Loaded lazily: until the mesh ships, this module does not exist, and a
      // missing optional channel must not stop Dex starting.
      const { MeshChannel } = require('../channels/mesh/mesh_channel') as {
        MeshChannel: new (runtime: ChannelRuntime) => ChannelAdapter;
      };
      const channel = new MeshChannel(runtime);
      started.push(channel);
      await channel.start().catch((err: unknown) => {
        console.warn(
          `\x1b[33m[mesh]\x1b[0m did not start — ` +
            `${err instanceof Error ? err.message : err}`,
        );
      });
    } catch {
      console.warn(
        '\x1b[33m[mesh]\x1b[0m enabled in settings but not installed yet — skipping.',
      );
    }
  }

  return manager;
}
