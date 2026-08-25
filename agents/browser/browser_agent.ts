import * as http from 'http';
import { Agent } from '../../core/orchestrator/registry';
import { AgentContext, AgentResult } from '../../core/events/types';
import { emit } from '../../core/events/bus';

const PORT = parseInt(process.env.BROWSER_AGENT_PORT ?? '8766', 10);

/**
 * Defence in depth. The Python side already stops after MAX_HANDOFFS; this
 * bounds the loop from the Node side too, so a server that misreports its own
 * state cannot keep asking the owner to solve CAPTCHAs forever.
 */
const MAX_HANDOFFS = 2;

interface VerifySpec {
  url_contains?: string;
  text_on_page?: string;
  selector?: string;
}

interface HandoffSignal {
  kind: string;
  reason: string;
  instruction: string;
}

interface BrowserStep {
  step: number;
  url: string;
  action: string;
}

interface TaskResponse {
  success: boolean;
  session_id?: string;
  steps?: BrowserStep[];
  url?: string;
  result?: string | null;
  error?: string;
  retryable?: boolean;
  needs_handoff?: HandoffSignal;
  verification?: { passed: boolean; checks: Array<{ check: string; passed: boolean }> } | null;
}

interface PrimitiveResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  retryable?: boolean;
  needs_owner?: boolean;
}

/**
 * The web hands.
 *
 * Every action here goes through one process that owns a real browser window.
 * The interesting part is `run_task`: when the page throws up something only a
 * person can clear -- a CAPTCHA, a bot check, a password box -- the agent does
 * not retry and does not fail. It parks the live session, asks the owner
 * through the normal Tier 1 hand-off card, and resumes the same browser on the
 * same page once they say they are done.
 */
export class BrowserAgent implements Agent {
  name = 'BrowserAgent';
  capabilities = ['can_browse_web'];

  async execute(
    action: string,
    params: Record<string, unknown>,
    requestId: string,
    stepId: string,
    ctx?: AgentContext,
  ): Promise<AgentResult> {
    switch (action) {
      case 'run_task':
        return this.runTask(params, requestId, stepId, ctx);
      case 'navigate':
        return this.primitive('navigate', { url: String(params.url ?? '') }, requestId, stepId);
      case 'read_page':
        return this.primitive('read', {}, requestId, stepId);
      case 'click':
        return this.primitive(
          'click',
          { selector: String(params.selector ?? '') },
          requestId,
          stepId,
        );
      case 'type_text':
        return this.primitive(
          'type',
          { selector: String(params.selector ?? ''), text: String(params.text ?? '') },
          requestId,
          stepId,
          ctx,
        );
      case 'extract':
        return this.primitive(
          'extract',
          { selector: params.selector ? String(params.selector) : null },
          requestId,
          stepId,
        );
      default:
        return {
          success: false,
          error: `BrowserAgent: unknown action "${action}"`,
          retryable: false,
        };
    }
  }

  // -- autonomous ------------------------------------------------------------

  private async runTask(
    params: Record<string, unknown>,
    requestId: string,
    stepId: string,
    ctx?: AgentContext,
  ): Promise<AgentResult> {
    const task = String(params.task ?? '');
    if (!task) return { success: false, error: 'run_task needs a task', retryable: false };

    const verify: VerifySpec = {};
    if (params.verify_url_contains) verify.url_contains = String(params.verify_url_contains);
    if (params.verify_text_on_page) verify.text_on_page = String(params.verify_text_on_page);
    if (params.verify_selector) verify.selector = String(params.verify_selector);

    emit('executing', `Browsing: "${task}"`, requestId, stepId);

    let response: TaskResponse;
    try {
      response = await this.post<TaskResponse>('/run-task', {
        task,
        start_url: params.start_url ? String(params.start_url) : null,
        max_steps: params.max_steps ? Number(params.max_steps) : undefined,
        verify: Object.keys(verify).length ? verify : null,
        request_id: requestId,
        step_id: stepId,
      });
    } catch (err) {
      return this.transportFailure(err, requestId, stepId);
    }

    for (let handoffs = 0; response.needs_handoff; handoffs += 1) {
      const wall = response.needs_handoff;
      const sessionId = response.session_id;

      this.streamSteps(response.steps, requestId, stepId);

      if (!ctx) {
        // Headless caller (a test, a scheduled run). Failing loudly beats
        // silently abandoning a browser mid-task.
        return {
          success: false,
          error: `${wall.reason} — needs the owner, and nothing is attached to ask`,
          retryable: false,
        };
      }

      if (handoffs >= MAX_HANDOFFS) {
        await this.abandon(sessionId);
        return {
          success: false,
          error: `${wall.reason} — asked the owner ${handoffs} times already, stopping`,
          retryable: false,
        };
      }

      emit('awaiting', `${wall.reason} — over to you`, requestId, stepId);

      const cleared = await ctx.handoff({
        reason: wall.reason,
        instruction: wall.instruction,
      });

      if (!cleared) {
        await this.abandon(sessionId);
        return {
          success: false,
          error: `Not cleared: ${wall.reason}`,
          retryable: false,
        };
      }

      if (ctx.isCancelled()) {
        await this.abandon(sessionId);
        return { success: false, error: 'Cancelled by owner', retryable: false };
      }

      if (!sessionId) {
        return {
          success: false,
          error: 'Browser session was lost during the hand-off',
          retryable: true,
        };
      }

      emit('executing', 'Owner cleared it — picking up where DEX left off', requestId, stepId);

      try {
        response = await this.post<TaskResponse>('/resume', { session_id: sessionId });
      } catch (err) {
        return this.transportFailure(err, requestId, stepId);
      }
    }

    this.streamSteps(response.steps, requestId, stepId);

    if (!response.success) {
      emit('failed', `Browser: ${response.error ?? 'unknown error'}`, requestId, stepId);
      return {
        success: false,
        error: response.error ?? 'Browser task failed',
        retryable: response.retryable ?? true,
        data: { url: response.url, steps: response.steps },
      };
    }

    return {
      success: true,
      data: {
        result: response.result ?? null,
        url: response.url,
        steps: response.steps,
        verification: response.verification ?? null,
      },
    };
  }

  // -- deterministic ---------------------------------------------------------

  private async primitive(
    op: string,
    payload: Record<string, unknown>,
    requestId: string,
    stepId: string,
    ctx?: AgentContext,
  ): Promise<AgentResult> {
    emit('executing', `Browser ${op}${payload.url ? ` ${payload.url}` : ''}`, requestId, stepId);

    let response: PrimitiveResponse;
    try {
      response = await this.post<PrimitiveResponse>('/primitive', { op, ...payload });
    } catch (err) {
      return this.transportFailure(err, requestId, stepId);
    }

    if (response.success) return { success: true, data: response.data };

    // A refused password field is the one primitive failure that has a human
    // answer. Offer the hand-off rather than reporting a dead end.
    if (response.needs_owner && ctx) {
      emit('awaiting', response.error ?? 'Needs the owner', requestId, stepId);
      const cleared = await ctx.handoff({
        reason: response.error ?? 'This field needs the owner',
        instruction:
          'Fill this field yourself in the open browser window, then choose "Done, continue".',
      });
      if (cleared) return { success: true, data: { handedOff: true } };
    }

    emit('failed', `Browser ${op}: ${response.error}`, requestId, stepId);
    return {
      success: false,
      error: response.error ?? `Browser ${op} failed`,
      retryable: response.retryable ?? true,
    };
  }

  // -- plumbing --------------------------------------------------------------

  private streamSteps(steps: BrowserStep[] | undefined, requestId: string, stepId: string): void {
    for (const step of steps ?? []) {
      const where = step.url ? ` @ ${hostOf(step.url)}` : '';
      emit('executing', `  [${step.step}] ${step.action || 'step'}${where}`, requestId, stepId);
    }
  }

  private async abandon(sessionId: string | undefined): Promise<void> {
    if (!sessionId) return;
    try {
      await this.post('/abandon', { session_id: sessionId });
    } catch {
      // The server is already gone; the browser dies with it.
    }
  }

  private transportFailure(err: unknown, requestId: string, stepId: string): AgentResult {
    const raw = err instanceof Error ? err.message : String(err);
    const msg = raw.includes('ECONNREFUSED')
      ? 'Browser Agent server not running. Start it: python agents/browser/server.py'
      : raw;
    emit('failed', `Browser Agent: ${msg}`, requestId, stepId);
    return { success: false, error: msg, retryable: true };
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
              reject(new Error(`Invalid JSON from Browser Agent: ${data.slice(0, 200)}`));
            }
          });
        },
      );
      req.on('error', reject);
      // Generous: a hand-off means a human is reading a CAPTCHA on the other
      // side of this socket, and the Python side is holding the session open.
      req.setTimeout(600_000, () => req.destroy(new Error('Browser Agent timed out')));
      req.write(payload);
      req.end();
    });
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}
