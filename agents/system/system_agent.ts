import * as net from 'net';
import { Agent } from '../../core/orchestrator/registry';
import { emit } from '../../core/events/bus';

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
