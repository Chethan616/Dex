import * as http from 'http';
import { Agent } from '../../core/orchestrator/registry';
import { AgentContext, AgentResult } from '../../core/events/types';
import { emit } from '../../core/events/bus';

const PORT = parseInt(process.env.APP_AGENT_PORT ?? '8767', 10);

interface ActResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  retryable?: boolean;
  escalate?: string;
  needs_owner?: boolean;
  candidates?: string[];
}

/**
 * Tier 2 — the hands that do not need eyes.
 *
 * Drives Windows applications through UI Automation: clicks a button by its
 * name, sets a field through ValuePattern, reads the result straight back out
 * of the accessibility tree. No screenshot, no model, no coordinates, and
 * nothing that can land 30 pixels off target.
 *
 * Most of what Dex is asked to do on the desktop lives here. The vision tier
 * exists for what genuinely cannot be reached this way — and this agent says so
 * explicitly rather than failing, by returning an `escalate` capability the
 * Orchestrator re-dispatches on.
 */
export class AppAgent implements Agent {
  name = 'AppAgent';
  capabilities = ['can_control_app'];

  async execute(
    action: string,
    params: Record<string, unknown>,
    requestId: string,
    stepId: string,
    ctx?: AgentContext,
  ): Promise<AgentResult> {
    const op = OPS[action];
    if (!op) {
      return {
        success: false,
        error: `AppAgent: unknown action "${action}"`,
        retryable: false,
      };
    }

    const window = String(params.window ?? '');
    emit('executing', `${action}${window ? ` in "${window}"` : ''}`, requestId, stepId);
    ctx?.report?.('I am checking the target window through its accessibility tree.');

    let response: ActResponse;
    try {
      response = await this.post<ActResponse>('/act', {
        op,
        window,
        name: params.name ?? params.element ?? null,
        control_type: params.control_type ?? null,
        text: params.text ?? null,
        path: params.path ?? null,
        on: params.on ?? null,
        timeout: params.timeout ?? 10,
        request_id: requestId,
        step_id: stepId,
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const msg = raw.includes('ECONNREFUSED')
        ? 'App Agent server not running. Start it: python agents/app/server.py'
        : raw;
      emit('failed', `App Agent: ${msg}`, requestId, stepId);
      return { success: false, error: msg, retryable: true };
    }

    if (response.success) {
      return { success: true, data: response.data };
    }

    // A password box is a hand-off, exactly as in the browser tier.
    if (response.needs_owner && ctx) {
      emit('awaiting', response.error ?? 'Needs the owner', requestId, stepId);
      const cleared = await ctx.handoff({
        reason: response.error ?? 'This field needs the owner',
        instruction:
          `Fill this field yourself in "${window}", then choose "Done, continue".`,
      });
      if (cleared) return { success: true, data: { handedOff: true } };
      return { success: false, error: response.error, retryable: false };
    }

    if (response.escalate) {
      // Not a failure — a routing decision, and the owner should see why Dex is
      // about to start using screenshots for this step.
      emit(
        'routing',
        `No accessible controls here — escalating to the vision tier (${response.error})`,
        requestId,
        stepId,
      );
      return {
        success: false,
        error: response.error ?? 'Not reachable through UI Automation',
        retryable: false,
        escalate: response.escalate,
      };
    }

    // Candidate names turn "it didn't work" into something actionable.
    const detail = response.candidates?.length
      ? `${response.error} — this window offers: ${response.candidates.slice(0, 10).join(', ')}`
      : response.error ?? 'App action failed';

    emit('failed', `App Agent: ${detail}`, requestId, stepId);
    return { success: false, error: detail, retryable: response.retryable ?? false };
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
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data) as T);
            } catch {
              reject(new Error(`Invalid JSON from App Agent: ${data.slice(0, 200)}`));
            }
          });
        },
      );
      req.on('error', reject);
      // UIA is fast; a long hang means a modal dialog is blocking the tree.
      req.setTimeout(90_000, () => req.destroy(new Error('App Agent timed out')));
      req.write(payload);
      req.end();
    });
  }
}

/** Dex's action vocabulary -> the server's op names. */
const OPS: Record<string, string> = {
  list_elements: 'list',
  window_state: 'state',
  click_element: 'click',
  set_text: 'set_text',
  read_element: 'read',
  toggle: 'toggle',
  select_menu: 'menu',
  wait_for: 'wait',
};
