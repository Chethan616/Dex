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

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const AUTH_GRACE_MS = 3000;

interface Client {
  socket: WebSocket;
  authed: boolean;
}

type Inbound =
  | { type: 'auth'; token: string }
  | { type: 'submit'; text: string }
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
  | { type: 'get_schedules' }
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
  | { type: 'ping' };

export interface DexServerOptions {
  port?: number;
  fullAccess: boolean;
  evidenceDir?: string;
}

export class DexServer {
  private wss?: WebSocketServer;
  private clients = new Map<WebSocket, Client>();
  private token = randomBytes(24).toString('hex');
  private readonly settings = new SettingsService();
  private readonly schedules = new ScheduleStore();
  private readonly port: number;
  private readonly evidenceDir: string;

  constructor(
    private gateway: Gateway,
    private confirmations: ConfirmationManager,
    private cancellation: CancellationRegistry,
    private opts: DexServerOptions,
  ) {
    this.port = opts.port ?? 8770;
    this.evidenceDir = path.resolve(opts.evidenceDir ?? 'data/evidence');
  }

  start(): void {
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
      console.error(`\x1b[31m[ws]\x1b[0m Server error: ${err.message}`);
    });

    bus.subscribeAll((event) => this.broadcast({ type: 'event', event }));

    this.confirmations.registerProvider({
      name: 'flutter',
      present: (request) => this.broadcast({ type: 'confirmation', request }),
      withdraw: (requestId, stepId) =>
        this.broadcast({ type: 'confirmation_closed', requestId, stepId }),
    });

    const file = writeHandshake({
      port: this.port,
      token: this.token,
      pid: process.pid,
      version: '0.1.0',
      startedAt: Date.now(),
    });

    console.log(`\x1b[36m[ws]\x1b[0m Listening on 127.0.0.1:${this.port}`);
    console.log(`\x1b[90m[ws]\x1b[0m Handshake: ${file}`);

    const cleanup = (): void => removeHandshake();
    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit(0); });
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
        const result = await this.gateway.handle('flutter', 'local_owner', text);
        return this.send(socket, { type: 'result', ...result });
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

    const child = spawn(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-Command',
        `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${script}'`,
      ],
      { windowsHide: true },
    );

    child.on('error', (err) => {
      this.send(socket, { type: 'full_access_result', enabled, ok: false, message: err.message });
    });

    child.on('exit', (code) => {
      const ok = code === 0;
      this.send(socket, {
        type: 'full_access_result',
        enabled,
        ok,
        message: ok
          ? `Full Access ${enabled ? 'enabled' : 'disabled'} — restart DEX core to apply.`
          : `Elevation cancelled or script failed (exit ${code}).`,
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
