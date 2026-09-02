/**
 * Stop stops.
 *
 *     npm run test:stop
 *
 * The Stop button used to mean "stop showing me this". The task's step
 * boundaries honoured it, but the planning call — the longest and the only part
 * that costs money — ran to completion regardless, and with Claude Code as the
 * provider that is a CLI process generating a plan on the owner's own
 * subscription for a task that no longer exists.
 *
 * So these are the three properties that make Stop real, each asserted against
 * a provider that reports whether it was actually interrupted:
 *
 *   1. Cancelling fires the signal the provider is holding.
 *   2. Nothing retries afterwards. Retrying is how one Stop becomes four more
 *      requests.
 *   3. A rate-limit wait is interruptible. That is where a cancelled task used
 *      to sit longest: up to 90 seconds asleep before even trying again.
 */
import assert from 'assert';
import { CancellationRegistry } from '../core/orchestrator/cancellation';
import {
  Cancelled,
  LlmProvider,
  RateLimited,
  ToolCallRequest,
  isAbort,
  withRetry,
} from '../core/llm/provider';

let failures = 0;
function check(label: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok   ${label}`))
    .catch((err) => {
      failures += 1;
      console.log(`FAIL ${label}\n     ${err instanceof Error ? err.message : err}`);
    });
}

/** A provider that never finishes on its own — only an abort can end it. */
class NeverFinishes implements LlmProvider {
  readonly label = 'test/never-finishes';
  calls = 0;
  aborted = false;

  callTool(request: ToolCallRequest): Promise<Record<string, unknown>> {
    this.calls += 1;
    return new Promise((_resolve, reject) => {
      request.signal?.addEventListener('abort', () => {
        this.aborted = true;
        reject(new Cancelled());
      }, { once: true });
    });
  }
}

async function main(): Promise<void> {
  console.log('— the signal reaches the provider —');

  await check('cancel() aborts the in-flight call', async () => {
    const registry = new CancellationRegistry();
    const provider = new NeverFinishes();
    const signal = registry.signal('r1');

    const call = provider.callTool({
      system: '', user: '', maxTokens: 10, signal,
      tool: { name: 't', description: '', schema: {} },
    });

    registry.cancel('r1');
    await assert.rejects(call, (err: unknown) => isAbort(err));
    assert.ok(provider.aborted, 'the provider never saw the abort');
  });

  await check('a Stop that lands before the call still counts', async () => {
    // The window between accepting a request and starting the model call is
    // small, and a Stop that lands inside it used to be dropped entirely.
    const registry = new CancellationRegistry();
    registry.cancel('r2');
    assert.ok(registry.signal('r2').aborted, 'the signal was handed out unfired');
  });

  await check('clear() forgets the request', () => {
    const registry = new CancellationRegistry();
    registry.cancel('r3');
    registry.clear('r3');
    assert.ok(!registry.isCancelled('r3'));
    assert.ok(!registry.signal('r3').aborted, 'a reused id inherited the old stop');
  });

  console.log('\n— nothing retries a stop —');

  await check('withRetry does not retry after an abort', async () => {
    let attempts = 0;
    const controller = new AbortController();
    await assert.rejects(
      withRetry(async () => {
        attempts += 1;
        controller.abort();
        throw new Cancelled();
      }, { attempts: 4, signal: controller.signal, label: 'test' }),
      (err: unknown) => isAbort(err),
    );
    assert.strictEqual(attempts, 1, `retried a stop ${attempts} times`);
  });

  await check('withRetry still retries a real rate limit', async () => {
    let attempts = 0;
    const value = await withRetry(async () => {
      attempts += 1;
      if (attempts < 3) throw new RateLimited('429', 1);
      return 'done';
    }, { attempts: 4, baseMs: 1, label: 'test' });
    assert.strictEqual(value, 'done');
    assert.strictEqual(attempts, 3);
  });

  await check('a rate-limit wait is interruptible', async () => {
    // 30s of sleep, cut short. Without an interruptible wait this test would
    // take half a minute — which is exactly how long Stop used to take.
    const controller = new AbortController();
    const started = Date.now();
    const pending = withRetry(async () => {
      throw new RateLimited('429', 30_000);
    }, { attempts: 3, signal: controller.signal, label: 'test' });

    setTimeout(() => controller.abort(), 20);
    await assert.rejects(pending, (err: unknown) => isAbort(err));

    const elapsed = Date.now() - started;
    assert.ok(elapsed < 5_000, `Stop took ${elapsed}ms — it waited out the rate limit`);
  });

  console.log();
  if (failures > 0) {
    console.log(`${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('PASSED  Stop stops the model, not just the screen.');
}

void main();
