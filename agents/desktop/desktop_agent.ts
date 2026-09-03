import * as http from 'http';
import { Agent } from '../../core/orchestrator/registry';
import { AgentContext } from '../../core/events/types';
import { emit } from '../../core/events/bus';

const PORT = parseInt(process.env.DESKTOP_AGENT_PORT ?? '8765', 10);

interface RunTaskResponse {
  success: boolean;
  steps: Array<{ step: number; action_type: string; reasoning: string }>;
  error?: string | null;
}

export class DesktopAgent implements Agent {
  /** An HTTP proxy: the work happens in a Python process on this port. */
  endpoint = PORT;
  name = 'DesktopAgent';
  capabilities = ['can_control_gui'];

  async execute(
    action: string,
    params: Record<string, unknown>,
    requestId: string,
    stepId: string,
    ctx?: AgentContext,
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    switch (action) {
      case 'run_task':
        return this.runTask(String(params.task ?? ''), requestId, stepId, ctx);
      default:
        return { success: false, error: `DesktopAgent: unknown action "${action}"` };
    }
  }

  private async runTask(
    task: string,
    requestId: string,
    stepId: string,
    ctx?: AgentContext,
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    emit('executing', `Desktop: "${task}"`, requestId, stepId);
    ctx?.report?.('I am using the visual fallback because the app has no accessible controls.');

    let result: RunTaskResponse;
    try {
      result = await this.post<RunTaskResponse>('/run-task', {
        task,
        request_id: requestId,
        step_id: stepId,
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const msg = raw.includes('ECONNREFUSED')
        ? `Desktop Agent server not running. Start it: python agents/desktop/server.py`
        : raw;
      emit('failed', `Desktop Agent: ${msg}`, requestId, stepId);
      return { success: false, error: msg };
    }

    for (const step of result.steps ?? []) {
      emit(
        'executing',
        `  [${step.step}] ${step.action_type} — ${step.reasoning}`,
        requestId,
        stepId,
      );
    }

    return { success: result.success, data: result.steps, error: result.error ?? undefined };
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: PORT,
          path,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: string) => { data += chunk; });
          res.on('end', () => {
            try { resolve(JSON.parse(data) as T); }
            catch { reject(new Error(`Invalid JSON from Desktop Agent: ${data.slice(0, 200)}`)); }
          });
        },
      );
      req.on('error', reject);
      req.setTimeout(180_000, () => req.destroy(new Error('Desktop Agent timed out')));
      req.write(payload);
      req.end();
    });
  }
}
