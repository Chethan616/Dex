import * as http from 'http';
import { Agent } from '../../core/orchestrator/registry';
import { AgentContext, AgentResult } from '../../core/events/types';
import { emit } from '../../core/events/bus';
import { readConfig } from '../../core/settings/config_store';
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

/** A file the run produced, ready for a later step to point at. */
interface BrowserDownload {
  path: string;
  name: string;
  bytes?: number | null;
}

interface TaskResponse {
  success: boolean;
  session_id?: string;
  /** What the task answered in prose, when it ran in the owner's browser. */
  answer?: string;
  downloads?: BrowserDownload[];
  /** What the run says it altered. What a verification should check. */
  changed?: string[];
  /** The pages it touched, in order. */
  visited?: string[];
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
  /** An HTTP proxy: the work happens in a Python process on this port. */
  endpoint = PORT;
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
      case 'page_model':
        return this.primitive('page_model', { browser: browserOf(params) }, requestId, stepId);

      case 'fill_form':
        return this.primitive(
          'fill_form',
          {
            fields: params.fields ?? params.values ?? {},
            submit: params.submit === true,
            browser: browserOf(params),
          },
          requestId,
          stepId,
        );

      case 'click':
        // By visible text first, because that is what a plan can know from
        // reading a page. A selector still works when one is given.
        return this.primitive(
          'click_text',
          {
            text: params.text ? String(params.text) : null,
            selector: params.selector ? String(params.selector) : null,
            browser: browserOf(params),
          },
          requestId,
          stepId,
        );

      case 'wait_for':
        return this.primitive(
          'wait_for',
          {
            text: params.text ? String(params.text) : null,
            selector: params.selector ? String(params.selector) : null,
            url: params.url ? String(params.url) : null,
            idle: params.idle === true,
            timeout: params.timeout ? Number(params.timeout) : 20,
            browser: browserOf(params),
          },
          requestId,
          stepId,
        );

      case 'extract_table':
        return this.primitive(
          'extract_table',
          { which: params.which ?? params.table ?? 0, browser: browserOf(params) },
          requestId,
          stepId,
        );

      case 'scroll':
        return this.primitive(
          'scroll',
          { text: String(params.direction ?? params.to ?? 'down'), browser: browserOf(params) },
          requestId,
          stepId,
        );

      case 'press_key':
        return this.primitive(
          'press_key',
          { text: String(params.key ?? 'Enter'), browser: browserOf(params) },
          requestId,
          stepId,
        );

      case 'go_back':
        return this.primitive('go_back', { browser: browserOf(params) }, requestId, stepId);

      case 'reload':
        return this.primitive('reload', { browser: browserOf(params) }, requestId, stepId);

      case 'map_page':
        return this.primitive(
          'map_page',
          {
            text: params.query ? String(params.query) : null,
            full_page: params.include_hidden !== false,
            browser: browserOf(params),
          },
          requestId,
          stepId,
        );
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
      case 'open_browser':
        return this.openOwnerBrowser(params, requestId, stepId);
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
        mode: composerMode(),
        // The remembered route travels with the task.
        //
        // It already reached the autonomous browser as prose prepended to the
        // instruction. The extension loop never got it at all, so "the status
        // control is on the profile page, not in settings" was relearned from
        // scratch on every run. Sent as data so that loop can put it in its
        // world state rather than parse it back out of a sentence.
        route: route
          ? { origin: route.origin, goal: route.goal, steps: route.steps }
          : null,
        verify: Object.keys(verify).length ? verify : null,
        request_id: requestId,
        step_id: stepId,
      });
    } catch (err) {
      return this.transportFailure(err, requestId, stepId);
    }

    // A run that worked is a route nobody had to be asked for.
    //
    // Routes only ever came from `learn_route` — the owner driving once while
    // Dex watched. Everything else started from nothing every time, which is
    // how "change my GitHub status" became twenty-five steps of looking for a
    // settings page that does not have it. The status control is on the
    // profile page, and no amount of reasoning finds that faster than
    // remembering it.
    //
    // So a successful browse writes down the path it took. Not a hardcoded map
    // of GitHub — a record of what worked here, on this site, for this goal,
    // which is the same thing `learn_route` produces and is scored and
    // forgotten by the same rules when it stops working.
    const rememberPath = (data: Record<string, unknown>): void => {
      if (route) return;  // There was already one; markWorked has it.

      const steps = Array.isArray(data.steps) ? data.steps : [];
      const path: Array<{ text: string; url?: string }> = [];

      for (const entry of steps) {
        const step = entry as Record<string, unknown>;
        const action = typeof step.action === 'string' ? step.action : '';
        const url = typeof step.url === 'string' ? step.url : undefined;
        // Only the steps that moved: a wait or a scroll is not part of the
        // path, and recording them would teach Dex to repeat the hesitation.
        if (!action || /^(wait|scroll|screenshot|extract|read)/i.test(action)) continue;
        path.push({ text: action.slice(0, 200), url });
      }

      // One step is not a route — it is a URL, and the planner can already
      // navigate. Anything longer is knowledge worth keeping.
      if (path.length < 2) return;

      // The store normalises this itself, so the raw URL is fine — and using
      // its own rule means a route saved here and one saved by learn_route
      // land under the same key rather than two that never match.
      const origin = typeof data.url === 'string' && data.url
        ? data.url
        : String(params.start_url ?? '');
      if (!origin) return;

      const goal = String(params.task ?? '').slice(0, 120).trim();
      if (!goal) return;

      try {
        this.routes.save({ origin, goal, steps: path });
        emit(
          'routing',
          `Remembered how to do that on ${origin} — ${path.length} steps, so ` +
            'next time is direct.',
          requestId,
          stepId,
        );
      } catch {
        // A route that cannot be written is a slower task next time, not a
        // failed one.
      }
    };

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

    // And write down the path if there was not one already. A run that worked
    // is the cheapest possible lesson: nobody had to be asked, and nothing was
    // hardcoded about this site.
    if (response.success === true) {
      rememberPath(response as unknown as Record<string, unknown>);
    }

    if (!response.success) {
      emit('failed', `Browser: ${response.error ?? 'unknown error'}`, requestId, stepId);
      return {
        success: false,
        error: response.error ?? 'Browser task failed',
        retryable: response.retryable ?? true,
        // A run can fail after it downloaded something. Reporting the file
        // anyway is how the owner keeps what did work.
        data: {
          url: response.url,
          steps: response.steps,
          downloads: response.downloads ?? [],
        },
      };
    }

    return {
      success: true,
      data: {
        // `answer` when the run was in the owner's browser, `result` when it
        // was Dex's. One field either way, so the closing answer and any
        // `{{step_N.output.result}}` reference do not have to know which
        // browser did the work.
        result: response.result ?? response.answer ?? null,
        url: response.url,
        // Files the run produced. This is what lets a browser step hand work
        // to a file step: `{{step_N.output.downloads[0].path}}` into move_file
        // or run_program. Always an array, so the reference shape is the same
        // whether or not anything downloaded.
        downloads: response.downloads ?? [],
        // What it says it changed, and where it went. A run that reports
        // neither is a run whose verification has nothing to test, which is
        // why an un-hinted run_task graded UNVERIFIABLE every time.
        changed: response.changed ?? [],
        visited: response.visited ?? [],
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
  /**
   * Open the browser the owner is signed into.
   *
   * The dead end this removes: Dex refused a GitHub task because no browser
   * was attached and told the owner to open Chrome — something Dex can do. The
   * planner then improvised, opened Chrome through the app tier, found two
   * windows both called "New Tab - Google Chrome", and stopped.
   *
   * Their profile, not Dex's, because the extension lives there and the
   * session is theirs. Nothing is driven: a window opens and the extension in
   * it attaches on its own.
   */
  private async openOwnerBrowser(
    params: Record<string, unknown>,
    requestId: string,
    stepId: string,
  ): Promise<AgentResult> {
    try {
      const response = await this.post<{ success?: boolean; error?: string; data?: unknown }>(
        '/open-owner-browser', {
          profile: String(params.profile ?? ''),
          url: String(params.url ?? ''),
        },
      );

      if (response.success !== true) {
        return {
          success: false,
          error: String((response as Record<string, unknown>).error ?? 'could not open the browser'),
          retryable: false,
        };
      }

      const data = (response.data ?? {}) as Record<string, unknown>;
      emit(
        'routing',
        data.attached === true
          ? `Opened ${String(data.profile ?? 'Chrome')} — the extension is attached.`
          : `Opened ${String(data.profile ?? 'Chrome')}. The extension has not ` +
            'attached; load it once from chrome://extensions.',
        requestId,
        stepId,
      );
      return { success: true, data };
    } catch (err) {
      return this.transportFailure(err, requestId, stepId);
    }
  }

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

/**
 * Which of the composer's three modes is selected, as the browser agent says it.
 *
 * Reused rather than re-plumbed: the composer already applies Fast/Smart/Think
 * deeper by setting the brain's model, so the model *is* the mode and there is
 * no second thing to keep in step. Reading it here means the browsing loop runs
 * at whatever the owner picked for the task, which is what they asked for —
 * one control, meaning the same thing everywhere.
 */
function composerMode(): string {
  const model = (readConfig().brainModel ?? '').toLowerCase();
  if (model.includes('opus')) return 'deeper';
  if (model.includes('haiku')) return 'fast';
  if (model.includes('sonnet')) return 'smart';
  // An API-key provider has one model and no modes; the browser agent picks
  // its own default rather than inventing a mode from a model name it does
  // not recognise.
  return 'smart';
}
