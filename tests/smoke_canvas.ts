import './support/isolate';
/**
 * Drawing on a canvas — the guards, not the drawing.
 *
 *     npm run test:canvas
 *
 * The drawing itself needs a real screen, a real window and a real mouse, and
 * is verified by watching it happen. What can and must be pinned here is
 * everything that decides whether it is *safe* to move that mouse, because
 * this is the only thing in Dex that takes over the pointer for minutes and
 * the failure modes are not cosmetic:
 *
 *   - a stroke drawn into the wrong window is a drag across whatever the owner
 *     alt-tabbed to;
 *   - a drawing that cannot be interrupted is minutes of the machine being
 *     unusable after Stop was pressed;
 *   - a "success" that drew nothing is the class of lie this project exists to
 *     eliminate.
 *
 * So the batching is the subject. It is what makes Stop reach a drawing at
 * all, and it is pure logic, so it can be tested without a screen.
 */
import assert from 'assert';
import { AppAgent } from '../agents/app/app_agent';
import { AgentContext } from '../core/events/types';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${label}`);
  else {
    failures += 1;
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

/** Stands in for the app-agent server, recording every batch it is sent. */
function fakeServer(options: {
  failAt?: number;
  canvasError?: string;
} = {}) {
  const batches: unknown[][] = [];
  let calls = 0;

  const post = async <T,>(_path: string, body: unknown): Promise<T> => {
    const request = body as { op: string; strokes?: unknown[] };

    if (request.op === 'find_canvas') {
      if (options.canvasError) throw new Error(options.canvasError);
      return {
        left: 100, top: 200, right: 900, bottom: 800, method: 'named',
      } as T;
    }

    calls += 1;
    if (options.failAt && calls === options.failAt) {
      throw new Error('"Paint" is not the window in front.');
    }
    batches.push(request.strokes ?? []);
    return {
      drawn: (request.strokes ?? []).length,
      points: (request.strokes ?? []).reduce<number>(
        (n, s) => n + ((s as { points?: unknown[] }).points?.length ?? 0), 0,
      ),
    } as T;
  };

  return { post, batches };
}

/** N strokes of two points each. */
function strokes(count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    color: '#000000',
    points: [[i / count, 0.1], [i / count, 0.9]],
  }));
}

function context(cancelAfter = Infinity): AgentContext {
  let asked = 0;
  return {
    isCancelled: () => ++asked > cancelAfter,
    report: () => undefined,
  } as unknown as AgentContext;
}

/** Reach the agent's dispatch with a fake transport in place of the server. */
function agentWith(post: unknown): AppAgent {
  const agent = new AppAgent();
  (agent as unknown as { post: unknown }).post = post;
  return agent;
}

async function main(): Promise<void> {
  console.log('— a drawing goes over in batches —');

  {
    const server = fakeServer();
    const agent = agentWith(server.post);
    const result = await agent.execute(
      'draw_strokes',
      { window: 'Paint', strokes: strokes(50) },
      'req', 'step_1', context(),
    );

    check('it succeeds', result.success, result.error ?? '');
    check('all fifty strokes were drawn',
      (result.data as { drawn?: number })?.drawn === 50,
      String((result.data as { drawn?: number })?.drawn));
    check('and it took more than one call, so Stop has somewhere to land',
      server.batches.length > 1, `${server.batches.length} batch(es)`);
    check('no batch is unreasonably large',
      server.batches.every((b) => b.length <= 25),
      `largest ${Math.max(...server.batches.map((b) => b.length))}`);
  }

  console.log('\n— the tracer output is accepted as it comes —');

  {
    // trace_image returns { strokes: [...] }, and a plan that passes the whole
    // object through a step reference is the obvious thing to write.
    const server = fakeServer();
    const agent = agentWith(server.post);
    const result = await agent.execute(
      'draw_strokes',
      { window: 'Paint', strokes: { strokes: strokes(8), stroke_count: 8 } },
      'req', 'step_1', context(),
    );
    check('a whole trace object works, not just a bare array',
      result.success && (result.data as { drawn?: number })?.drawn === 8,
      result.error ?? String((result.data as { drawn?: number })?.drawn));
  }

  console.log('\n— Stop reaches it —');

  {
    const server = fakeServer();
    const agent = agentWith(server.post);
    const result = await agent.execute(
      'draw_strokes',
      { window: 'Paint', strokes: strokes(200) },
      'req', 'step_1', context(2),
    );

    check('it stops rather than finishing', !result.success);
    check('and says how far it got',
      /Stopped after \d+ of 200/.test(result.error ?? ''), result.error ?? '');
    check('and it really stopped early',
      (result.data as { drawn?: number })?.drawn !== undefined &&
        (result.data as { drawn: number }).drawn < 200,
      String((result.data as { drawn?: number })?.drawn));
    check('marked cancelled, not failed',
      (result.data as { cancelled?: boolean })?.cancelled === true);
  }

  console.log('\n— the window moving out of focus halts it —');

  {
    const server = fakeServer({ failAt: 3 });
    const agent = agentWith(server.post);
    const result = await agent.execute(
      'draw_strokes',
      { window: 'Paint', strokes: strokes(200) },
      'req', 'step_1', context(),
    );

    check('it fails', !result.success);
    check('the reason names the real cause rather than a generic error',
      (result.error ?? '').includes('not the window in front'), result.error ?? '');
    check('and reports the strokes that did land',
      (result.data as { drawn?: number })?.drawn !== undefined,
      String((result.data as { drawn?: number })?.drawn));
    check('it is not retried automatically',
      result.retryable === false);
  }

  console.log('\n— refusals —');

  {
    const agent = agentWith(fakeServer().post);
    const result = await agent.execute(
      'draw_strokes', { window: 'Paint', strokes: [] }, 'req', 'step_1', context(),
    );
    check('no strokes is refused, pointing at trace_image',
      !result.success && (result.error ?? '').includes('trace_image'),
      result.error ?? '');
  }

  {
    const agent = agentWith(fakeServer({ canvasError: 'no window' }).post);
    const result = await agent.execute(
      'draw_strokes', { window: 'Nope', strokes: strokes(4) }, 'req', 'step_1', context(),
    );
    check('a window with no canvas is refused before any mouse moves',
      !result.success && (result.error ?? '').includes('drawing area'),
      result.error ?? '');
  }

  console.log();
  if (failures > 0) {
    console.log(`${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('PASSED  a drawing is interruptible, bounded, and honest about what it drew.');
}

void main();
