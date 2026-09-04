import { randomBytes, timingSafeEqual } from 'crypto';
import { spawn } from 'child_process';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { Gateway } from '../gateway';
import { bus } from '../events/bus';
import { ConfirmationRequest, DexEvent } from '../events/types';
import { ConfirmationManager } from '../confirmation/confirmation_manager';
import { CancellationRegistry } from '../orchestrator/cancellation';
import { writeHandshake, removeHandshake } from './handshake';
import { SettingsService } from '../settings/settings_service';
import { ScheduleStore } from '../scheduler/store';
import { parseSchedule } from '../scheduler/cron';
import { ChannelId, ChannelState } from '../../channels/manager';
import { Conversations } from '../memory/conversations';
import { db } from '../memory/db';
import { readConfig } from '../settings/config_store';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const AUTH_GRACE_MS = 3000;

interface Client {
  socket: WebSocket;
  authed: boolean;
}

type Inbound =
  | { type: 'auth'; token: string }
  | { type: 'submit'; text: string; conversationId?: string }
  | { type: 'get_conversations'; query?: string }
  | { type: 'open_conversation'; conversationId: string }
  | { type: 'rename_conversation'; conversationId: string; name: string }
  | { type: 'delete_conversation'; conversationId: string }
  | {
      type: 'respond';
      requestId: string;
      stepId: string;
      stepVersion: string;
      verdict: 'approved' | 'approved_session' | 'handed_off' | 'rejected';
    }
  | { type: 'cancel'; requestId: string }
  | { type: 'clear_preapprovals' }
  | { type: 'full_access'; enabled: boolean }
  | { type: 'get_status' }
  | { type: 'get_evidence'; requestId: string }
  | { type: 'get_workflows' }
  | { type: 'save_workflow'; name: string; description?: string }
  | { type: 'delete_workflow'; name: string }
  | { type: 'rename_workflow'; from: string; to: string }
  | { type: 'get_schedules' }
  | { type: 'get_reminders' }
  | { type: 'get_channels' }
  | { type: 'set_channel'; channel: ChannelId; token?: string; owner?: string; enabled?: boolean }
  | { type: 'test_channel'; channel: ChannelId }
  | { type: 'test_account'; account: string }
  | {
      type: 'set_account';
      account: string;
      clientId?: string;
      clientSecret?: string;
      email?: string;
    }
  | { type: 'get_accounts' }
  | { type: 'open_browser_profile'; browser?: string }
  | { type: 'get_browser_profiles' }
  | { type: 'set_reminder'; text: string; at: number }
  | { type: 'snooze_reminder'; name: string; minutes?: number; at?: number }
  | { type: 'complete_reminder'; name: string }
  | { type: 'delete_reminder'; name: string }
  | { type: 'save_schedule'; name: string; when: string; request: string }
  | { type: 'set_schedule_enabled'; name: string; enabled: boolean }
  | { type: 'delete_schedule'; name: string }
  | { type: 'get_history'; query?: string; limit?: number }
  | { type: 'get_stats'; days?: number }
  | { type: 'get_settings' }
  | { type: 'set_credential'; name: string; value: string }
  | { type: 'delete_credential'; name: string }
  | { type: 'set_env'; changes: Record<string, string | null> }
  | { type: 'test_provider'; provider: string }
  | { type: 'set_brain'; provider: string; model?: string }
  | { type: 'set_config'; changes: Record<string, unknown> }
  | { type: 'claude_signin' }
  | { type: 'get_health' }
  | { type: 'get_log'; name: string; lines?: number }
  | { type: 'capture_screen' }
  | { type: 'feedback'; requestId: string; verdict: 'up' | 'down' | 'none' }
  | { type: 'ping' };

export interface DexServerOptions {
  port?: number;
  fullAccess: boolean;
  evidenceDir?: string;
  /**
   * The chat channels, so pairing takes effect where the owner made it.
   *
   * Optional: the CLI and the tests build a server without channels, and a
   * settings screen that cannot reach them should say so rather than fail to
   * construct.
   */
  channels?: {
    sync(options?: { restart?: boolean }): Promise<ChannelState[]>;
    states(): ChannelState[];
    sendTest(id: ChannelId, text: string): Promise<{ ok: boolean; detail: string }>;
  };
  /**
   * The connected-accounts agent, so Settings can prove a connection instead
   * of reporting that a credential exists.
   */
  workspace?: {
    probe(key: string): Promise<{
      key: string;
      ok: boolean;
      account?: string;
      tools: string[];
      detail: string;
    }>;
  };
  /**
   * The agent registry, so the one direct action below can be dispatched.
   * Optional: a server built without it simply reports that no system agent
   * is registered, rather than failing to construct.
   */
  agents?: { resolve(capability: string): {
    execute(
      action: string,
      params: Record<string, unknown>,
      requestId: string,
      stepId: string,
    ): Promise<{ success: boolean; data?: unknown; error?: string }>;
  } | undefined };
  /**
   * Re-ask the daemon whether Full Access is now real, and return the answer.
   *
   * Supplied by src/main.ts, which owns that state. Without it the toggle could
   * only ever say "restart DEX core to apply", and the owner would grant Full
   * Access, see it reported as off, and reasonably conclude it had not worked.
   * The daemon has just been started elevated by the script; asking it is a
   * pipe call away.
   */
  recheckFullAccess?: () => Promise<boolean>;
}

export class DexServer {
  private wss?: WebSocketServer;
  private clients = new Map<WebSocket, Client>();
  private token = randomBytes(24).toString('hex');
  private readonly settings = new SettingsService();
  private readonly schedules = new ScheduleStore();
  /** What was said, so history is a record rather than a list of requests. */
  private readonly conversations = new Conversations(db());

  /**
   * Steps of tasks currently running, keyed by request.
   *
   * Held here rather than written straight through because a step event knows
   * its request but not its conversation — the conversation belongs to the
   * submit that started it, and that call has not returned yet. Flushed when
   * it does.
   *
   * Bounded: a task that somehow never finishes drops its oldest steps rather
   * than growing without limit.
   */
  private readonly stepsInFlight = new Map<string, Array<{
    text: string;
    detail: Record<string, unknown>;
    at: number;
  }>>();
  private readonly port: number;

  /** True once this process actually bound the port. See the cleanup below. */
  private ownsHandshake = false;
  private readonly evidenceDir: string;
  private readonly agents: DexServerOptions['agents'];

  constructor(
    private gateway: Gateway,
    private confirmations: ConfirmationManager,
    private cancellation: CancellationRegistry,
    private opts: DexServerOptions,
  ) {
    this.agents = opts.agents;
    this.port = opts.port ?? 8770;
    this.evidenceDir = path.resolve(opts.evidenceDir ?? 'data/evidence');
  }

  /**
   * Hand over the chat channels once they exist.
   *
   * A setter rather than a constructor argument because the channels connect
   * to Telegram and Discord over the network, and the socket must be up before
   * that finishes — otherwise the app waits on a chat platform to open.
   */
  useChannels(channels: DexServerOptions['channels']): void {
    this.opts.channels = channels;
    this.broadcastChannels();
  }

  /**
   * Bind, and resolve once the socket is really listening.
   *
   * Returns a promise because the handshake file is written on the `listening`
   * event now, not at construction — so "start() returned" and "the core is
   * reachable" are no longer the same moment, and a caller that reads the
   * handshake immediately would find nothing there.
   */
  start(): Promise<void> {
    this.wss = new WebSocketServer({
      host: '127.0.0.1',
      port: this.port,
      // Belt and braces: the bind is already loopback-only.
      verifyClient: (info, done) => {
        const remote = info.req.socket.remoteAddress ?? '';
        if (!LOOPBACK.has(remote)) return done(false, 403, 'Loopback connections only');
        done(true);
      },
    });

    this.wss.on('connection', (socket) => this.onConnection(socket));
    this.wss.on('error', (err) => {
      // A core that cannot listen is a core nothing can reach.
      //
      // This used to log and carry on, which produced the worst available
      // state: a live process with no socket and no handshake file, while an
      // older core still held the port and served stale code. The app said
      // "core not running" and was right; the log said "Server error" and was
      // passed over, because every line after it looked like a normal start.
      //
      // EADDRINUSE means another core is already up, so the honest response is
      // to say so and stand down rather than sit there pretending.
      const busy = (err as NodeJS.ErrnoException).code === 'EADDRINUSE';
      console.error(
        `\x1b[31m[ws]\x1b[0m ${
          busy
            ? `Port ${this.port} is already in use — another Dex core is ` +
              'running. Stop it first:  .\\scripts\\stop-dex.ps1'
            : `Server error: ${err.message}`
        }`,
      );
      if (busy) {
        // Leave without running the cleanup: the file on disk belongs to the
        // core that won the port.
        this.ownsHandshake = false;
        process.exit(1);
      }
    });

    bus.subscribeAll((event) => {
      this.rememberStep(event);
      this.broadcast({ type: 'event', event });
    });

    this.confirmations.registerProvider({
      name: 'flutter',
      present: (request) => this.broadcast({ type: 'confirmation', request }),
      withdraw: (requestId, stepId) =>
        this.broadcast({ type: 'confirmation_closed', requestId, stepId }),
    });

    // Announced only once the socket is really listening.
    //
    // This used to run at construction, so a core that then failed to bind had
    // already overwritten the handshake of the core that owned the port — and
    // the app, reading that file, was pointed at a process about to exit.
    // "Listening" is a fact the server reports; writing the file before it is
    // a claim.
    const listening = new Promise<void>((resolve) => {
      this.wss?.once('listening', () => resolve());
    });

    this.wss.on('listening', () => {
      this.ownsHandshake = true;
      const file = writeHandshake({
        port: this.port,
        token: this.token,
        pid: process.pid,
        version: '0.1.0',
        startedAt: Date.now(),
      });
      console.log(`\x1b[36m[ws]\x1b[0m Listening on 127.0.0.1:${this.port}`);
      console.log(`\x1b[90m[ws]\x1b[0m Handshake: ${file}`);
    });

    const cleanup = (): void => {
      // Only the core that bound the port may remove the file. The loser
      // deleting it is exactly how a healthy core became invisible.
      if (this.ownsHandshake) removeHandshake();
    };
    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit(0); });

    return listening;
  }

  private onConnection(socket: WebSocket): void {
    const client: Client = { socket, authed: false };
    this.clients.set(socket, client);

    const graceTimer = setTimeout(() => {
      if (!client.authed) socket.close(4401, 'Auth timeout');
    }, AUTH_GRACE_MS);

    socket.on('message', (raw) => {
      let msg: Inbound;
      try {
        msg = JSON.parse(raw.toString()) as Inbound;
      } catch {
        return this.send(socket, { type: 'error', message: 'Malformed JSON' });
      }
      void this.handle(client, msg, graceTimer);
    });

    socket.on('close', () => {
      clearTimeout(graceTimer);
      this.clients.delete(socket);
    });

    socket.on('error', () => {
      this.clients.delete(socket);
    });
  }

  private async handle(client: Client, msg: Inbound, graceTimer: NodeJS.Timeout): Promise<void> {
    const { socket } = client;

    if (msg.type === 'auth') {
      if (!this.checkToken(msg.token)) {
        return socket.close(4403, 'Bad token');
      }
      client.authed = true;
      clearTimeout(graceTimer);
      return this.send(socket, {
        type: 'ready',
        fullAccess: this.opts.fullAccess,
        pending: this.confirmations.snapshot(),
      });
    }

    if (!client.authed) {
      return socket.close(4401, 'Not authenticated');
    }

    switch (msg.type) {
      case 'ping':
        return this.send(socket, { type: 'pong', at: Date.now() });

      case 'get_status':
        return this.send(socket, {
          type: 'status',
          fullAccess: this.opts.fullAccess,
          daemonService: await this.daemonServiceState(),
          pending: this.confirmations.snapshot(),
          preApprovals: this.confirmations.preApprovals(),
        });

      case 'submit': {
        const text = String(msg.text ?? '').trim();
        if (!text) return this.send(socket, { type: 'error', message: 'Empty command' });

        // The thread this belongs to. Supplied by the app, because only the
        // app knows whether the owner is continuing a conversation or has
        // started a new one — the core cannot tell those apart from the text.
        const conversationId = String(msg.conversationId ?? '').trim();

        if (conversationId) {
          this.conversations.append({ conversationId, speaker: 'human', text });
        }

        const result = await this.gateway.handle('flutter', 'local_owner', text);

        if (conversationId) {
          // Steps first, then the answer: that is the order they happened in,
          // and a thread that reads out of order is worse than none.
          this.flushSteps(conversationId, result.requestId);
          this.conversations.append({
            conversationId,
            requestId: result.requestId,
            speaker: 'agent',
            text: result.summary ?? '',
            detail: { status: result.status },
          });
          this.broadcastConversations();
        } else {
          this.stepsInFlight.delete(result.requestId);
        }
        return this.send(socket, { type: 'result', ...result });
      }

      case 'get_channels':
        return this.send(socket, this.channelsPayload());

      case 'set_channel': {
        const id = msg.channel;
        try {
          // The token goes to the OS credential store, never to settings.json
          // and never to a file in the repo. The owner id is not a secret —
          // it is a username — so it lives with the rest of the settings.
          if (typeof msg.token === 'string') {
            const key = id === 'telegram' ? 'telegram_bot_token' : 'discord_bot_token';
            if (msg.token.trim()) {
              await this.settings.setCredential(key, msg.token.trim());
            } else {
              await this.settings.clearCredential(key);
            }
          }

          const changes: Record<string, unknown> = {};
          if (typeof msg.owner === 'string') {
            changes[`${id}Owner`] = msg.owner.trim();
          }
          if (id === 'whatsapp' && typeof msg.enabled === 'boolean') {
            changes.whatsappEnabled = msg.enabled;
          }
          if (Object.keys(changes).length > 0) this.settings.setConfig(changes);
        } catch (err) {
          return this.send(socket, {
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }

        // Reconnect now, not at the next restart. A settings screen whose
        // change only takes effect after a restart it never mentions is a
        // settings screen that lies — the same reason set_config rebuilds the
        // Brain in place.
        await this.opts.channels?.sync({ restart: true });
        return this.broadcastChannels();
      }

      case 'test_channel': {
        const channels = this.opts.channels;
        if (!channels) {
          return this.send(socket, {
            type: 'channel_test',
            channel: msg.channel,
            ok: false,
            detail: 'This core was started without chat channels.',
          });
        }
        const result = await channels.sendTest(
          msg.channel,
          'Dex here. If you are reading this, the connection works.',
        );
        return this.send(socket, {
          type: 'channel_test',
          channel: msg.channel,
          ...result,
        });
      }

      // Open the browser Dex uses, so the owner can sign in to their own
      // accounts in it once instead of clearing a hand-off on every site.
      //
      // Dex keeps a separate profile so its browsing cannot touch the owner's
      // session — right, and it means Dex is signed in to nothing. Signing in
      // here is the owner's decision to make: this is the profile Dex browses
      // with, so an account signed in here is one Dex can act as. Nothing is
      // automated and no password is ever seen; it launches a window and stops.
      // The owner's own Chrome profiles, so Settings can offer them by name
      // rather than asking for a folder called "Profile 1".
      case 'get_browser_profiles': {
        try {
          const response = await fetch('http://127.0.0.1:8766/profiles');
          const payload = (await response.json()) as {
            success?: boolean; data?: { profiles?: unknown[] };
          };
          return this.send(socket, {
            type: 'browser_profiles',
            profiles: payload.data?.profiles ?? [],
            chosen: readConfig().browserProfile ?? '',
          });
        } catch {
          return this.send(socket, {
            type: 'browser_profiles', profiles: [], chosen: '',
          });
        }
      }

      case 'open_browser_profile': {
        try {
          const response = await fetch('http://127.0.0.1:8766/open-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ browser: msg.browser ?? null }),
          });
          const payload = (await response.json()) as {
            success?: boolean; data?: unknown; error?: string;
          };
          return this.send(socket, {
            type: 'browser_profile_opened',
            ok: payload.success === true,
            ...(payload.data as object ?? {}),
            error: payload.error,
          });
        } catch (err) {
          return this.send(socket, {
            type: 'browser_profile_opened',
            ok: false,
            error:
              'The browser agent is not running, so there is no profile to '
              + `open. (${err instanceof Error ? err.message : err})`,
          });
        }
      }

      case 'get_accounts':
        return this.send(socket, await this.accountsPayload());

      case 'set_account': {
        // Google's are two secrets and an email. The secrets go to the OS
        // credential store; the email is not one and goes there too only
        // because the MCP server wants it as an environment variable at spawn
        // time, which is where every other credential for that server comes
        // from. Nothing lands in settings.json and nothing lands in a file in
        // the repo.
        const account = String(msg.account || 'google');
        const fields: Array<[string, unknown]> = account === 'google'
          ? [
              ['google_oauth_client_id', msg.clientId],
              ['google_oauth_client_secret', msg.clientSecret],
              ['google_account_email', msg.email],
            ]
          : [
              ['ms365_client_id', msg.clientId],
              ['ms365_client_secret', msg.clientSecret],
              ['ms365_account_email', msg.email],
            ];

        try {
          for (const [name, value] of fields) {
            if (typeof value !== 'string') continue;
            if (value.trim()) {
              await this.settings.setCredential(name, value.trim());
            } else {
              this.settings.clearCredential(name);
            }
          }
        } catch (err) {
          return this.send(socket, {
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
        return this.send(socket, await this.accountsPayload());
      }

      // Connect for real and say what came back.
      //
      // Slow on purpose — it spawns the MCP server, which on a cold `uvx` can
      // take several seconds. That is the cost of an answer that means
      // something, against an instant one that only says a credential is
      // stored.
      case 'test_account': {
        const workspace = this.opts.workspace;
        if (!workspace) {
          return this.send(socket, {
            type: 'account_test',
            account: msg.account,
            ok: false,
            detail: 'This core was started without connected accounts.',
          });
        }
        const result = await workspace.probe(String(msg.account || 'google'));
        return this.send(socket, { type: 'account_test', ...result });
      }

      case 'get_reminders':
        return this.send(socket, this.remindersPayload());

      case 'set_reminder': {
        const text = String(msg.text ?? '').trim();
        const at = Number(msg.at);
        if (!text) return this.send(socket, { type: 'error', message: 'A reminder needs something to say' });
        if (!Number.isFinite(at)) {
          return this.send(socket, { type: 'error', message: 'A reminder needs a time' });
        }
        this.schedules.remind({ text, at });
        return this.broadcastReminders();
      }

      case 'snooze_reminder': {
        // Minutes from now, or an explicit moment. Minutes is what a snooze
        // button means; a moment is what a date picker gives.
        const until = Number.isFinite(Number(msg.at))
          ? Number(msg.at)
          : Date.now() + Math.max(1, Number(msg.minutes ?? 10)) * 60_000;
        this.schedules.snooze(String(msg.name ?? ''), until);
        return this.broadcastReminders();
      }

      case 'complete_reminder':
        this.schedules.complete(String(msg.name ?? ''));
        return this.broadcastReminders();

      case 'delete_reminder':
        this.schedules.delete(String(msg.name ?? ''));
        return this.broadcastReminders();

      case 'get_conversations': {
        const query = String(msg.query ?? '').trim();
        return this.send(socket, {
          type: 'conversations',
          query: query || undefined,
          conversations: query
            ? this.conversations.search(query)
            : this.conversations.list(),
        });
      }

      case 'open_conversation': {
        const id = String(msg.conversationId ?? '').trim();
        return this.send(socket, {
          type: 'conversation',
          conversationId: id,
          messages: id ? this.conversations.messages(id) : [],
        });
      }

      case 'rename_conversation': {
        this.conversations.rename(
          String(msg.conversationId ?? ''),
          String(msg.name ?? ''),
        );
        return this.broadcastConversations();
      }

      case 'delete_conversation': {
        const removed = this.conversations.remove(String(msg.conversationId ?? ''));
        this.broadcastConversations();
        return this.send(socket, {
          type: 'conversation_deleted',
          conversationId: String(msg.conversationId ?? ''),
          messages: removed,
        });
      }

      case 'respond': {
        if (process.env.DEX_DEBUG === 'true') {
          console.log(`\x1b[90m[ws]\x1b[0m respond ${msg.stepId} v${msg.stepVersion} -> ${msg.verdict}`);
        }
        const outcome = this.confirmations.respond(
          msg.requestId,
          msg.stepId,
          msg.stepVersion,
          msg.verdict,
        );
        return this.send(socket, {
          type: 'respond_ack',
          requestId: msg.requestId,
          stepId: msg.stepId,
          ...outcome,
        });
      }

      case 'cancel':
        this.cancellation.cancel(msg.requestId);
        this.confirmations.cancelAll(msg.requestId);
        return this.send(socket, { type: 'cancel_ack', requestId: msg.requestId });

      case 'clear_preapprovals': {
        const cleared = this.confirmations.clearPreApprovals();
        this.broadcast({ type: 'status', fullAccess: this.opts.fullAccess, preApprovals: [] });
        return this.send(socket, { type: 'preapprovals_cleared', cleared });
      }

      case 'full_access':
        return this.toggleFullAccess(socket, msg.enabled);

      case 'get_evidence':
        return this.send(socket, {
          type: 'evidence',
          requestId: msg.requestId,
          records: this.readEvidence(msg.requestId),
        });

      // ── history and saved workflows ─────────────────────────────────
      // Read-only queries answered straight from the local database. A
      // workflow is *run* through `submit` ("run backup D:\\") rather than a
      // separate path, so replays go through the same Owner Gate,
      // confirmation tiers and event stream as anything else.
      case 'get_workflows':
        return this.send(socket, {
          type: 'workflows',
          workflows: this.gateway.workflowStore.list().map((w) => ({
            name: w.name,
            description: w.description,
            params: w.params,
            steps: w.template.length,
            runCount: w.runCount,
            triggerText: w.triggerText,
            lastRunAt: w.lastRunAt ?? null,
            // Learned or named, and whether it has started failing. The
            // Memory tab shows both: a workflow that saved itself is worth
            // labelling as such, and one that is failing is worth noticing
            // before it is silently forgotten.
            origin: w.origin,
            failCount: w.failCount,
          })),
        });

      case 'save_workflow': {
        try {
          const saved = this.gateway.saveLast(msg.name, msg.description);
          this.broadcastWorkflows();
          return this.send(socket, {
            type: 'workflow_saved',
            name: saved.name,
            params: saved.params,
            steps: saved.template.length,
          });
        } catch (err) {
          return this.send(socket, {
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Give a learned workflow a name.
      //
      // Workflows are saved automatically now, under a slug derived from the
      // intent. Renaming one is the owner claiming it: it becomes `named`, it
      // outranks the learned ones, and the cap will never evict it. It is also
      // how a workflow gets a name short enough to type after `run`.
      case 'feedback': {
        const verdict = msg.verdict === 'up' ? 1 : msg.verdict === 'down' ? -1 : null;
        this.gateway.telemetryStore.recordFeedback(msg.requestId, verdict);
        return this.send(socket, { type: 'feedback_ack', requestId: msg.requestId });
      }

      case 'rename_workflow': {
        try {
          const renamed = this.gateway.workflowStore.rename(msg.from, msg.to);
          this.broadcast({ type: 'workflow_renamed', workflow: renamed });
          return this.send(socket, {
            type: 'workflows',
            workflows: this.gateway.workflowStore.list(),
          });
        } catch (err) {
          return this.send(socket, {
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      case 'delete_workflow': {
        const removed = this.gateway.workflowStore.delete(msg.name);
        if (removed) this.broadcastWorkflows();
        return this.send(socket, { type: 'workflow_deleted', name: msg.name, removed });
      }

      // ── schedules ------------------------------------------------------
      // These mirror the CLI's /every, /schedules, /pause, /resume and
      // /unschedule commands, but keep the app independent of terminal text.
      case 'get_schedules':
        return this.send(socket, this.schedulesPayload());

      case 'save_schedule': {
        try {
          const when = String(msg.when ?? '').trim();
          const request = String(msg.request ?? '').trim();
          if (!request) throw new Error('A scheduled task needs something to do.');
          const saved = this.schedules.save({
            name: msg.name,
            cron: parseSchedule(when),
            request,
          });
          this.broadcastSchedules();
          return this.send(socket, { type: 'schedule_saved', name: saved.name });
        } catch (err) {
          return this.send(socket, {
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      case 'set_schedule_enabled': {
        const enabled = Boolean(msg.enabled);
        const changed = this.schedules.setEnabled(msg.name, enabled);
        if (!changed) {
          return this.send(socket, {
            type: 'error',
            message: `No schedule named "${msg.name}"`,
          });
        }
        this.broadcastSchedules();
        return this.send(socket, { type: 'schedule_updated', name: msg.name, enabled });
      }

      case 'delete_schedule': {
        const removed = this.schedules.delete(msg.name);
        this.broadcastSchedules();
        return this.send(socket, { type: 'schedule_deleted', name: msg.name, removed });
      }

      case 'get_history':
        return this.send(socket, {
          type: 'history',
          tasks: msg.query
            ? this.gateway.telemetryStore.search(msg.query, msg.limit ?? 30)
            : this.gateway.telemetryStore.recent(msg.limit ?? 30),
        });

      case 'get_stats':
        return this.send(socket, {
          type: 'stats',
          stats: this.gateway.telemetryStore.summary(msg.days ?? 7),
        });

      // --- Settings -------------------------------------------------------
      // The whole of Settings goes through the core rather than the app
      // touching files directly. The credential store is DPAPI-encrypted
      // against this user, `.env` needs its comments preserved, and both want
      // one writer — a Flutter process editing them in parallel would be a
      // second implementation of rules that already exist here.

      case 'get_settings':
        return this.send(socket, {
          type: 'settings',
          settings: await this.settings.describe(),
        });

      case 'set_credential': {
        try {
          this.settings.setCredential(String(msg.name), String(msg.value));
        } catch (err) {
          return this.send(socket, {
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
        // Reply with the refreshed snapshot, never with what was stored.
        return this.send(socket, {
          type: 'settings',
          settings: await this.settings.describe(),
        });
      }

      case 'delete_credential': {
        try {
          this.settings.deleteCredential(String(msg.name));
        } catch (err) {
          return this.send(socket, {
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
        return this.send(socket, {
          type: 'settings',
          settings: await this.settings.describe(),
        });
      }

      case 'set_env': {
        try {
          this.settings.setEnv(msg.changes ?? {});
        } catch (err) {
          return this.send(socket, {
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
        return this.send(socket, {
          type: 'settings',
          settings: await this.settings.describe(),
        });
      }

      // Choosing the brain from the app rather than from a file.
      case 'set_brain': {
        const outcome = this.settings.setBrain(
          String(msg.provider),
          String(msg.model ?? ''),
        );
        if (!outcome.ok) {
          return this.send(socket, { type: 'error', message: outcome.reason });
        }
        // Rebuilt now, not at the next restart. A settings screen whose change
        // only takes effect after a restart it never mentions is a settings
        // screen that lies.
        this.gateway.rebuildBrain();
        return this.send(socket, {
          type: 'settings',
          settings: await this.settings.describe(),
        });
      }

      case 'set_config': {
        try {
          this.settings.setConfig(msg.changes ?? {});
        } catch (err) {
          return this.send(socket, {
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
        return this.send(socket, {
          type: 'settings',
          settings: await this.settings.describe(),
        });
      }

      // Kick off `claude setup-token` so signing in is a button rather than an
      // instruction to go and open a terminal.
      case 'get_health':
        return this.send(socket, {
          type: 'health',
          capabilities: await this.settings.health(),
        });

      // The composer's "Take screenshot". A direct call rather than a task:
      // the owner has already said what they want by choosing the menu item,
      // and routing it through the planner would spend a model call to
      // rediscover that, then hand back a sentence instead of a path.
      //
      // Narrow on purpose. No parameters cross the socket, the action is a
      // Tier 4 read that changes nothing, and it is the only action reachable
      // this way — this is not a general "run any action" door.
      case 'capture_screen': {
        const agent = this.agents?.resolve('can_control_os');
        if (!agent) {
          return this.send(socket, {
            type: 'capture_screen_result',
            ok: false,
            message: 'No system agent is registered.',
          });
        }
        const result = await agent.execute('capture_screen', {}, 'ui', 'capture');
        const data = result.data as { path?: string } | undefined;
        return this.send(socket, {
          type: 'capture_screen_result',
          ok: result.success && !!data?.path,
          path: data?.path,
          message: result.success
            ? undefined
            : result.error ?? 'The daemon could not capture the screen.',
        });
      }

      case 'claude_signin':
        return this.send(socket, {
          type: 'claude_signin_result',
          result: await this.settings.startClaudeSignIn(),
        });

      case 'test_provider':
        return this.send(socket, {
          type: 'provider_test',
          result: await this.settings.test(String(msg.provider)),
        });

      case 'get_log':
        try {
          return this.send(socket, {
            type: 'log',
            name: msg.name,
            text: this.settings.readLog(String(msg.name), msg.lines ?? 400),
          });
        } catch (err) {
          return this.send(socket, {
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }

      default:
        return this.send(socket, { type: 'error', message: 'Unknown message type' });
    }
  }

  private checkToken(candidate: string): boolean {
    const a = Buffer.from(String(candidate ?? ''));
    const b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * Launches the install/uninstall script elevated. This is the ONE UAC prompt —
   * after it, the daemon runs as LocalSystem and never asks again.
   */
  private toggleFullAccess(socket: WebSocket, enabled: boolean): void {
    const script = path.resolve(
      'scripts',
      enabled ? 'install-daemon-service.ps1' : 'uninstall-daemon-service.ps1',
    );

    if (!fs.existsSync(script)) {
      return this.send(socket, { type: 'error', message: `Script not found: ${script}` });
    }

    // -KeepUi is what makes this safe to call from inside the app.
    //
    // The script stops the daemon before replacing it, via stop-dex.ps1 — and
    // stop-dex.ps1's job is to stop *everything*, including the Dex app and the
    // headless core. So granting Full Access from Settings killed the app that
    // was asking for it, and what the owner saw next was "core not running".
    // The switch tells the script to leave the two processes that are waiting
    // on it alone.
    const child = spawn(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-Command',
        `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${script}','-KeepUi'`,
      ],
      { windowsHide: true },
    );

    child.on('error', (err) => {
      this.send(socket, { type: 'full_access_result', enabled, ok: false, message: err.message });
    });

    child.on('exit', (code) => {
      if (code !== 0) {
        this.send(socket, {
          type: 'full_access_result',
          enabled,
          ok: false,
          message: `Elevation cancelled or script failed (exit ${code}).`,
        });
        return;
      }

      // Ask the daemon rather than announcing it. The script has just started
      // an elevated daemon; whether Full Access is actually on is a question
      // only that daemon can answer, and the answer is available now.
      void (this.opts.recheckFullAccess?.() ?? Promise.resolve(enabled))
        .then((effective) => {
          this.send(socket, {
            type: 'full_access_result',
            enabled: effective,
            ok: true,
            message: effective === enabled
              ? `Full Access ${enabled ? 'enabled' : 'disabled'}.`
              : enabled
                ? 'The daemon was registered but is not reporting elevation yet. ' +
                  'It starts at logon — sign out and back in, or start it from ' +
                  'an Administrator terminal.'
                : 'Full Access revoked.',
          });
          this.broadcast({ type: 'status', fullAccess: effective, preApprovals: [] });
        })
        .catch(() => {
          this.send(socket, {
            type: 'full_access_result',
            enabled,
            ok: true,
            message: `Full Access ${enabled ? 'enabled' : 'disabled'} — restart DEX core to apply.`,
          });
        });
    });
  }

  private daemonServiceState(): Promise<string> {
    return new Promise((resolve) => {
      execFile('sc', ['query', 'DexDaemon'], { timeout: 5000 }, (err, stdout) => {
        if (err) return resolve('not_installed');
        if (/STATE\s+:\s+4\s+RUNNING/i.test(stdout)) return resolve('running');
        if (/STATE\s+:\s+1\s+STOPPED/i.test(stdout)) return resolve('stopped');
        resolve('unknown');
      });
    });
  }

  private readEvidence(requestId: string): unknown[] {
    const prefix = requestId.slice(0, 8);
    try {
      return fs
        .readdirSync(this.evidenceDir)
        .filter((f) => f.includes(prefix) && f.endsWith('.json'))
        .sort()
        .map((f) => {
          try {
            return JSON.parse(fs.readFileSync(path.join(this.evidenceDir, f), 'utf8'));
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  private send(socket: WebSocket, payload: unknown): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }

  /** Every client sees the list change, not just the one that changed it. */
  private broadcastWorkflows(): void {
    this.broadcast({
      type: 'workflows',
      workflows: this.gateway.workflowStore.list().map((w) => ({
        name: w.name,
        description: w.description,
        params: w.params,
        steps: w.template.length,
        runCount: w.runCount,
        triggerText: w.triggerText,
        lastRunAt: w.lastRunAt ?? null,
      })),
    });
  }

  private schedulesPayload(): { type: 'schedules'; schedules: unknown[] } {
    return {
      type: 'schedules',
      schedules: this.schedules.list().map((schedule) => ({
        name: schedule.name,
        cron: schedule.cron,
        description: ScheduleStore.describe(schedule),
        request: schedule.request,
        createdAt: schedule.createdAt,
        enabled: schedule.enabled,
        lastFiredAt: schedule.lastFiredAt,
        lastStatus: schedule.lastStatus,
        runCount: schedule.runCount,
        failCount: schedule.failCount,
        nextRun: schedule.enabled
          ? ScheduleStore.nextFire(schedule)?.toISOString() ?? null
          : null,
      })),
    };
  }

  /**
   * Push the conversation list to every client.
   *
   * Sent rather than polled, so the sidebar updates the moment a turn ends
   * instead of on the next time something happens to ask.
   */
  /**
   * Keep a finished step, so reopening the thread shows what was done.
   *
   * Only terminal events. `selecting` and `executing` are the live commentary
   * of a step in progress; a thread reopened tomorrow wants what happened, not
   * the narration of it happening.
   */
  private rememberStep(event: DexEvent): void {
    if (!event.stepId) return;
    if (event.type !== 'done' && event.type !== 'failed') return;

    const detail = (event.data ?? {}) as Record<string, unknown>;
    const steps = this.stepsInFlight.get(event.requestId) ?? [];
    steps.push({
      text: event.message,
      detail: {
        action: detail.action,
        capability: detail.capability,
        verification: event.type === 'failed' ? 'FAILED' : detail.verification,
        artifact: detail.artifact,
      },
      at: event.timestamp,
    });

    // A step list this long means something is wrong with the plan, not with
    // the record; keep the most recent rather than all of them.
    if (steps.length > 200) steps.splice(0, steps.length - 200);
    this.stepsInFlight.set(event.requestId, steps);
  }

  /** Write a finished task's steps into the thread it belonged to. */
  private flushSteps(conversationId: string, requestId: string): void {
    const steps = this.stepsInFlight.get(requestId);
    this.stepsInFlight.delete(requestId);
    if (!steps) return;

    for (const step of steps) {
      this.conversations.append({
        conversationId,
        requestId,
        speaker: 'step',
        text: step.text,
        detail: step.detail,
        at: step.at,
      });
    }
  }

  /**
   * Which halves of each account's setup are present.
   *
   * Never the values. A screen that could echo a client secret back is a
   * screen that has the secret in memory on the way there, and the owner has
   * no reason to read it — they need to know whether one is stored, which is a
   * different question with a safe answer.
   */
  private async accountsPayload(): Promise<{ type: string; accounts: unknown[] }> {
    const stored = new Set(await this.settings.storedCredentials());
    return {
      type: 'accounts',
      accounts: [
        {
          id: 'google',
          name: 'Google Workspace',
          detail: 'Gmail, Calendar and Drive',
          hasClientId: stored.has('google_oauth_client_id'),
          hasClientSecret: stored.has('google_oauth_client_secret'),
          email: undefined,
          hasEmail: stored.has('google_account_email'),
        },
        {
          id: 'ms365',
          name: 'Microsoft 365',
          detail: 'Outlook, Calendar and OneDrive',
          hasClientId: stored.has('ms365_client_id'),
          hasClientSecret: stored.has('ms365_client_secret'),
          hasEmail: stored.has('ms365_account_email'),
        },
      ],
    };
  }

  private channelsPayload(): { type: string; channels: ChannelState[] } {
    return { type: 'channels', channels: this.opts.channels?.states() ?? [] };
  }

  private broadcastChannels(): void {
    this.broadcast(this.channelsPayload());
  }

  private remindersPayload(): { type: string; reminders: unknown[] } {
    return {
      type: 'reminders',
      reminders: this.schedules.reminders().map((reminder) => ({
        name: reminder.name,
        text: reminder.request,
        at: reminder.onceAt,
        createdAt: reminder.createdAt,
        // Fired but not yet dealt with. The row still shows, because a
        // reminder that has gone off and been ignored is exactly the one the
        // owner most needs to see.
        rang: reminder.lastFiredAt !== null,
        done: reminder.doneAt !== null,
      })),
    };
  }

  private broadcastReminders(): void {
    this.broadcast(this.remindersPayload());
  }

  private broadcastConversations(): void {
    this.broadcast({
      type: 'conversations',
      conversations: this.conversations.list(),
    });
  }

  private broadcastSchedules(): void {
    this.broadcast(this.schedulesPayload());
  }

  private broadcast(payload: { type: string; event?: DexEvent; request?: ConfirmationRequest; [k: string]: unknown }): void {
    const data = JSON.stringify(payload);
    for (const client of this.clients.values()) {
      if (client.authed && client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(data);
      }
    }
  }
}
