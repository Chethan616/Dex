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
  /** An HTTP proxy: the work happens in a Python process on this port. */
  endpoint = PORT;
  name = 'AppAgent';
  capabilities = ['can_control_app'];

  async execute(
    action: string,
    params: Record<string, unknown>,
    requestId: string,
    stepId: string,
    ctx?: AgentContext,
  ): Promise<AgentResult> {
    // Drawing is not one call. See drawStrokes.
    if (action === 'draw_strokes') {
      return drawStrokesImpl(
        (path, body) => this.post(path, body),
        params, requestId, stepId, ctx,
      );
    }

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
        value: params.value ?? null,
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

/**
 * Draw a traced image onto a canvas, in batches.
 *
 * Batching is the whole design. A four-hundred-stroke drawing takes minutes of
 * real mouse movement, and this is exactly the operation someone watches and
 * then wants to stop — so the strokes go over in slices, and between slices
 * two things happen that cannot happen inside one long call: the owner's Stop
 * is noticed, and progress is reported.
 *
 * The canvas is measured once and passed back in with every batch. Measuring
 * per batch would let a nudged window shift the drawing halfway through.
 */
async function drawStrokesImpl(
  post: <T>(path: string, body: unknown) => Promise<T>,
  params: Record<string, unknown>,
  requestId: string,
  stepId: string,
  ctx?: AgentContext,
): Promise<AgentResult> {
  const window = String(params.window ?? '');
  const strokes = normaliseStrokes(params.strokes);

  if (strokes.length === 0) {
    return {
      success: false,
      error: 'draw_strokes needs strokes — run trace_image first',
      retryable: false,
    };
  }

  let canvas: Record<string, unknown>;
  try {
    canvas = await post<Record<string, unknown>>('/act', {
      op: 'find_canvas', window, request_id: requestId, step_id: stepId,
    });
  } catch (err) {
    return {
      success: false,
      error: `Could not find the drawing area in "${window}": ${
        err instanceof Error ? err.message : String(err)}`,
      retryable: false,
    };
  }

  emit(
    'executing',
    `Drawing ${strokes.length} strokes into "${window}" ` +
      `(canvas found by ${canvas.method})`,
    requestId,
    stepId,
  );

  let drawn = 0;
  let points = 0;

  for (let i = 0; i < strokes.length; i += DRAW_BATCH) {
    // Between batches, not inside one. This is the only place a drawing can
    // be interrupted, and without it Stop would mean "stop in four minutes".
    if (ctx?.isCancelled?.()) {
      return {
        success: false,
        error: `Stopped after ${drawn} of ${strokes.length} strokes.`,
        retryable: false,
        data: { drawn, points, cancelled: true },
      };
    }

    const batch = strokes.slice(i, i + DRAW_BATCH);
    let result: { drawn?: number; points?: number };
    try {
      result = await post<{ drawn?: number; points?: number }>('/act', {
        op: 'draw',
        window,
        strokes: batch,
        canvas,
        request_id: requestId,
        step_id: stepId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        // The foreground check fires here, and it is worth surfacing as itself
        // rather than as a generic agent failure.
        error: `${message} (stopped after ${drawn} strokes)`,
        retryable: false,
        data: { drawn, points },
      };
    }

    drawn += result.drawn ?? 0;
    points += result.points ?? 0;

    const done = Math.min(i + DRAW_BATCH, strokes.length);
    emit(
      'executing',
      `Drawn ${done} of ${strokes.length} strokes`,
      requestId,
      stepId,
    );
    ctx?.report?.(`Drawing: ${done} of ${strokes.length} strokes.`);
  }

  return { success: true, data: { drawn, points, canvas, window } };
}

/**
 * How many strokes go over in one call.
 *
 * Small enough that Stop feels immediate — a batch is a second or two of mouse
 * movement — and large enough that the HTTP round trip is not the bottleneck.
 */
const DRAW_BATCH = 12;

/** Accepts the tracer's output, or a bare list of point lists. */
function normaliseStrokes(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const strokes = (value as { strokes?: unknown }).strokes;
    if (Array.isArray(strokes)) return strokes;
  }
  return [];
}

/** Dex's action vocabulary -> the server's op names. */
const OPS: Record<string, string> = {
  list_elements: 'list',
  window_state: 'state',
  click_element: 'click',
  set_text: 'set_text',
  read_element: 'read',
  toggle: 'toggle',
  set_value: 'set_value',
  select_menu: 'menu',
  wait_for: 'wait',
};
