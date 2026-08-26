import * as net from 'net';
import { Agent } from '../../core/orchestrator/registry';
import { emit } from '../../core/events/bus';
import { OS_ACTION_NAMES } from '../../core/brain/capabilities';

const PIPE_PATH = '\\\\.\\pipe\\dex_privileged_daemon';
const TIMEOUT_MS = 30_000;

interface DaemonResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export class SystemAgent implements Agent {
  name = 'SystemAgent';
  capabilities = ['can_control_os'];

  private driftChecked = false;

  /**
   * Ask the daemon what it can do, and compare with what the Brain is told it
   * can do.
   *
   * These were two hand-maintained lists in two languages and they drifted:
   * the planner offered actions the daemon had never implemented, so the Brain
   * planned them and the owner watched a task die on "Unknown action" halfway
   * through. Checking once per session turns that into one clear message before
   * anything is attempted.
   *
   * Deliberately non-fatal. A daemon that is merely *older* than the core still
   * does most of its job, and refusing to start would be a worse failure than
   * the one being reported.
   */
  async checkForDrift(): Promise<{ ok: boolean; missing: string[] }> {
    if (this.driftChecked) return { ok: true, missing: [] };
    this.driftChecked = true;

    const result = await this.execute('describe', {}, 'startup', 'drift_check');
    if (!result.success) {
      // Daemon down is a separate, already-reported problem.
      return { ok: true, missing: [] };
    }

    const available = new Set(
      ((result.data as { actions?: string[] })?.actions ?? []),
    );
    const missing = OS_ACTION_NAMES.filter((action) => !available.has(action));

    if (missing.length > 0) {
      emit(
        'failed',
        `Daemon is missing ${missing.length} action(s) the planner advertises: ` +
          `${missing.join(', ')}. Update the daemon, or remove them from ` +
          `core/brain/capabilities.ts — planning them will fail at run time.`,
        'startup',
      );
      return { ok: false, missing };
    }

    return { ok: true, missing: [] };
  }

  execute(
    action: string,
    params: Record<string, unknown>,
    requestId: string,
    stepId: string,
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    return new Promise((resolve) => {
      const msgId = `${requestId.slice(0, 8)}_${stepId}`;
      const payload = JSON.stringify({ id: msgId, action, params }) + '\n';

      const client = net.createConnection(PIPE_PATH);
      let buffer = '';
      let settled = false;

      const done = (result: { success: boolean; data?: unknown; error?: string }) => {
        if (settled) return;
        settled = true;
        client.destroy();
        resolve(result);
      };

      const timer = setTimeout(() => {
        emit('failed', `Daemon timeout after ${TIMEOUT_MS / 1000}s`, requestId, stepId);
        done({ success: false, error: `Daemon timeout after ${TIMEOUT_MS / 1000}s` });
      }, TIMEOUT_MS);

      client.on('connect', () => {
        client.write(payload);
      });

      client.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const resp: DaemonResponse = JSON.parse(line);
            if (resp.id === msgId) {
              clearTimeout(timer);
              done({ success: resp.success, data: resp.data, error: resp.error });
            }
          } catch {
            // partial line, keep buffering
          }
        }
      });

      client.on('error', (err) => {
        clearTimeout(timer);
        const msg =
          err.message.includes('ENOENT') || err.message.includes('connect')
            ? 'Daemon not running — start it with: python daemon/DexDaemon.py'
            : err.message;
        emit('failed', `System Agent: ${msg}`, requestId, stepId);
        done({ success: false, error: msg });
      });

      client.on('close', () => {
        clearTimeout(timer);
        if (!settled) {
          done({ success: false, error: 'Daemon closed connection unexpectedly' });
        }
      });
    });
  }
}
