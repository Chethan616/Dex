import * as http from 'http';
import { Agent } from '../../core/orchestrator/registry';
import { AgentContext, AgentResult } from '../../core/events/types';
import { emit } from '../../core/events/bus';
import { SiteRouteStore, describeRoute } from '../../core/memory/site_routes';

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

  /** What Dex has been shown about sites whose pages do not say what they are. */
  private routes = new SiteRouteStore();

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
      case 'sign_in':
        return this.signIn(params, requestId, stepId, ctx);
      case 'session_status':
        return this.primitive(
          'session_status',
          { url: String(params.url ?? ''), browser: browserOf(params) },
          requestId,
          stepId,
        );
      case 'download_current':
        return this.primitive(
          'download_current',
          { text: params.name ? String(params.name) : null, browser: browserOf(params) },
          requestId,
          stepId,
          ctx,
        );
      case 'learn_route':
        return this.learnRoute(params, requestId, stepId, ctx);
      case 'navigate':
        return this.primitive(
          'navigate',
          { url: String(params.url ?? ''), browser: browserOf(params) },
          requestId,
          stepId,
        );
      case 'read_page':
        return this.primitive('read', { browser: browserOf(params) }, requestId, stepId);
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
      case 'screenshot':
        return this.primitive(
          'screenshot',
          {
            path: params.path ? String(params.path) : null,
            // Full page unless told otherwise: a viewport crop of a long page
            // is rarely what "screenshot this site" means.
            full_page: params.full_page !== false,
          },
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

    // Has Dex been shown the way before?
    //
    // A route is a hint, never a cage: the agent is told what worked last time
    // and told to check each step still exists. A portal that has been
    // redesigned falls back to reading pages and reasoning, which is exactly
    // the behaviour there was before routes existed.
    const startUrl = params.start_url ? String(params.start_url) : '';
    const route = startUrl ? this.routes.find(startUrl, task) : undefined;
    const instruction = route ? `${describeRoute(route)}

${task}` : task;
    if (route) {
      emit(
        'routing',
        `Following the route to "${route.goal}" on ${route.origin} ` +
          `(${route.steps.length} steps, worked ${route.runCount}×)`,
        requestId,
        stepId,
      );
    }

    const verify: VerifySpec = {};
    if (params.verify_url_contains) verify.url_contains = String(params.verify_url_contains);
    if (params.verify_text_on_page) verify.text_on_page = String(params.verify_text_on_page);
    if (params.verify_selector) verify.selector = String(params.verify_selector);

    emit('executing', `Browsing: "${task}"`, requestId, stepId);

    let response: TaskResponse;
    try {
      response = await this.post<TaskResponse>('/run-task', {
        task: instruction,
        start_url: params.start_url ? String(params.start_url) : null,
        max_steps: params.max_steps ? Number(params.max_steps) : undefined,
        browser: browserOf(params),
        verify: Object.keys(verify).length ? verify : null,
        request_id: requestId,
        step_id: stepId,
      });
    } catch (err) {
      return this.transportFailure(err, requestId, stepId);
    }

    // A route that led somewhere is worth keeping; one that did not is on its
    // way to being forgotten. Two failures in a row and it goes — see
    // SiteRouteStore.markFailed.
    const scoreRoute = (ok: boolean): void => {
      if (!route) return;
      if (ok) this.routes.markWorked(route.origin, route.goal);
      else if (this.routes.markFailed(route.origin, route.goal)) {
        emit(
          'routing',
          `Forgot the route to "${route.goal}" — it has stopped working.`,
          requestId,
          stepId,
        );
      }
    };

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

    // Whether a remembered route actually got there. Only counted on the real
    // outcome, not on a hand-off along the way: the owner solving a CAPTCHA
    // says nothing about whether the route was right.
    scoreRoute(response.success === true);

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

  /**
   * Fill a stored credential, then hand the CAPTCHA to the owner.
   *
   * The step always ends in a hand-off, even when both fields were filled,
   * because what comes next is a CAPTCHA and that is deliberately not Dex's to
   * solve — it is the control the site put there to keep automation out. What
   * Dex removes is the typing, not the checkpoint.
   *
   * Nothing here ever sees the password. The agent process reads it from DPAPI
   * at the moment of typing and reports which fields it filled, never what went
   * into them — so the event stream, the transcript and the telemetry database
   * stay clean. See agents/browser/site_credentials.py.
   */
  private async signIn(
    params: Record<string, unknown>,
    requestId: string,
    stepId: string,
    ctx?: AgentContext,
  ): Promise<AgentResult> {
    const url = String(params.url ?? '');
    if (!url) {
      return { success: false, error: 'sign_in needs a url', retryable: false };
    }

    let response: PrimitiveResponse;
    try {
      response = await this.post<PrimitiveResponse>('/primitive', {
        op: 'sign_in',
        url,
        browser: browserOf(params),
      });
    } catch (err) {
      return this.transportFailure(err, requestId, stepId);
    }

    if (!response.success) {
      return { success: false, error: response.error ?? 'sign_in failed', retryable: false };
    }

    const data = (response.data ?? {}) as {
      filled?: string[];
      reason?: string;
      host?: string;
      url?: string;
    };
    const filled = data.filled ?? [];

    if (!ctx) {
      // No owner attached — a schedule, or a headless run. Say what is true:
      // the fields are filled and the login is not finished.
      return {
        success: false,
        error: `${data.reason ?? 'Sign-in needs the owner'} — nobody is watching this run.`,
        retryable: false,
        data,
      };
    }

    emit(
      'awaiting',
      filled.length > 0
        ? `Filled ${filled.join(' and ')} on ${data.host ?? url}. Over to you for the CAPTCHA.`
        : `Could not fill anything on ${data.host ?? url}.`,
      requestId,
      stepId,
    );

    const done = await ctx.handoff({
      reason: `Sign in to ${data.host ?? url}`,
      instruction: data.reason ?? 'Finish signing in in the open window.',
      timeoutMs: 300_000,
    });

    if (!done) {
      return {
        success: false,
        error: 'Sign-in was not completed.',
        retryable: false,
        data,
      };
    }

    // Ask the site, rather than trusting the owner's click. "I signed in" and
    // "the session works" are different claims, and only one of them is
    // checkable.
    let check: PrimitiveResponse;
    try {
      check = await this.post<PrimitiveResponse>('/primitive', {
        op: 'session_status',
        url,
        browser: browserOf(params),
      });
    } catch (err) {
      return this.transportFailure(err, requestId, stepId);
    }

    const status = (check.data ?? {}) as { signed_in?: boolean; url?: string };
    if (!status.signed_in) {
      return {
        success: false,
        error: `Still not signed in to ${data.host ?? url}.`,
        retryable: true,
        data: status,
      };
    }

    return {
      success: true,
      data: { ...status, host: data.host, filled },
    };
  }

  /**
   * Watch the owner find something once, and remember the way.
   *
   * The alternative is reasoning about an unlabelled portal on every run, which
   * costs a model call per page and takes a different turn each time. Being
   * shown once costs a minute and is then free and identical forever.
   */
  private async learnRoute(
    params: Record<string, unknown>,
    requestId: string,
    stepId: string,
    ctx?: AgentContext,
  ): Promise<AgentResult> {
    const url = String(params.url ?? '');
    const goal = String(params.goal ?? '');
    if (!url || !goal) {
      return {
        success: false,
        error: 'learn_route needs a url and a goal — what should it get you?',
        retryable: false,
      };
    }
    if (!ctx) {
      return {
        success: false,
        error: 'learn_route needs the owner to drive; nobody is watching this run.',
        retryable: false,
      };
    }

    try {
      await this.post<PrimitiveResponse>('/primitive', {
        op: 'record_route', url, goal, browser: browserOf(params),
      });
    } catch (err) {
      return this.transportFailure(err, requestId, stepId);
    }

    emit('awaiting', `Recording the way to "${goal}" — click through it.`, requestId, stepId);

    const done = await ctx.handoff({
      reason: `Show Dex where "${goal}" is`,
      instruction:
        'Click your way to it in the open browser window. Dex is noting what ' +
        'each thing is called. Choose "Done, continue" when you are on the page.',
      timeoutMs: 600_000,
    });

    let stopped: PrimitiveResponse;
    try {
      stopped = await this.post<PrimitiveResponse>('/primitive', {
        op: 'stop_recording', browser: browserOf(params),
      });
    } catch (err) {
      return this.transportFailure(err, requestId, stepId);
    }

    if (!done) {
      return { success: false, error: 'Recording was cancelled.', retryable: false };
    }

    const data = (stopped.data ?? {}) as {
      steps?: Array<Record<string, unknown>>;
      landed_on?: string;
      origin?: string;
    };
    const steps = data.steps ?? [];

    if (steps.length === 0) {
      return {
        success: false,
        // Distinguished from a failure, because it usually means the owner was
        // already on the page and clicked nothing.
        error:
          'Nothing was recorded — no clicks happened. If you were already on ' +
          'the page, start from the portal home and click through from there.',
        retryable: false,
      };
    }

    // Save it here rather than leaving it to the plan. A recording the owner
    // spent a minute on that then needs a second step to keep is a recording
    // that gets lost the first time a plan is one step shorter than expected.
    const saved = this.routes.save({
      origin: data.origin ?? url,
      goal,
      steps: steps.map((step) => ({
        text: String(step.text ?? ''),
        selector: step.selector ? String(step.selector) : undefined,
        url: step.url ? String(step.url) : undefined,
      })),
    });

    emit(
      'routing',
      `Remembered the way to "${saved.goal}" on ${saved.origin}: ` +
        saved.steps.map((step) => `"${step.text}"`).join(' → '),
      requestId,
      stepId,
    );

    return {
      success: true,
      data: {
        goal: saved.goal,
        origin: saved.origin,
        steps: saved.steps,
        landedOn: data.landed_on,
      },
    };
  }

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

/**
 * Which browser the step asked for, if any.
 *
 * Null means Playwright's own Chromium, which is the right default: it is
 * always present and always the version Dex was tested against. A name is
 * honoured only when the owner said one — "open Vivaldi and go to instagram"
 * means Vivaldi, and quietly using something else would be answering a
 * different question.
 */
function browserOf(params: Record<string, unknown>): string | null {
  const named = params.browser ?? params.in_browser ?? params.app;
  const text = typeof named === 'string' ? named.trim() : '';
  return text || null;
}
