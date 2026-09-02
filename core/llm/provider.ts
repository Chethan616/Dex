/**
 * One shape for "ask a model to fill in a tool call".
 *
 * DEX's Brain does exactly one thing with an LLM: hand it a system prompt, a
 * user request and a single tool schema, and get structured arguments back. It
 * never wants free text. Narrowing the interface to that one operation is what
 * makes swapping providers a config change instead of a rewrite — and it keeps
 * provider quirks (reasoning budgets, OpenAI-vs-Anthropic tool shapes) out of
 * the planner entirely.
 */

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  schema: Record<string, unknown>;
}

export interface ToolCallRequest {
  system: string;
  user: string;
  tool: ToolSpec;
  maxTokens: number;
  /**
   * Fires when the owner presses Stop. Every provider must honour it — that is
   * the difference between Stop meaning "stop" and Stop meaning "stop showing
   * me this", which is what it meant while the model kept generating.
   */
  signal?: AbortSignal;
}

/**
 * The owner stopped the task. Distinct from a failure so nothing retries it,
 * reports it as an error, or tells them something went wrong: nothing did.
 */
export class Cancelled extends Error {
  constructor(message = 'Cancelled by owner') {
    super(message);
    this.name = 'Cancelled';
  }
}

/** True for both our own Cancelled and the DOMException `fetch` throws. */
export function isAbort(err: unknown): boolean {
  return (
    err instanceof Cancelled ||
    (err instanceof Error && (err.name === 'AbortError' || err.name === 'Cancelled'))
  );
}

export interface LlmProvider {
  /** For logs and events — "groq/openai/gpt-oss-120b". */
  readonly label: string;
  /** Returns the tool's arguments. Throws if the model refused to call it. */
  callTool(request: ToolCallRequest): Promise<Record<string, unknown>>;
}

export class RateLimited extends Error {
  constructor(message: string, readonly retryAfterMs: number) {
    super(message);
    this.name = 'RateLimited';
  }
}

/**
 * How long a task may sit waiting on a rate limit before Dex gives up and says
 * so.
 *
 * Free tiers rate-limit per minute *and* per day, and the two look identical on
 * the wire: both are a 429 with a Retry-After. A per-minute limit says 20
 * seconds and waiting is right. A daily one says 2510 seconds, and waiting is
 * a forty-two minute silence in which Dex appears to have hung — which is
 * exactly what happened while testing this release.
 *
 * So a wait longer than this is not a wait, it is an outage, and it gets
 * reported as one.
 */
const MAX_RETRY_WAIT_MS = 90_000;

/**
 * Free tiers rate-limit aggressively and DEX runs on free tiers. Without this a
 * 429 becomes a failed task; with it, a burst just runs slower.
 *
 * Honours the server's own Retry-After when it sends one — guessing longer than
 * asked wastes the owner's time, guessing shorter gets you limited again — up
 * to the point where honouring it means hanging. See MAX_RETRY_WAIT_MS.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  { attempts = 4, baseMs = 1_000, label = 'request', signal }: {
    attempts?: number; baseMs?: number; label?: string; signal?: AbortSignal;
  } = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    // A rate-limit wait is where a cancelled task used to sit longest: up to 90
    // seconds asleep, then four more attempts, all for a plan nobody wants.
    if (signal?.aborted) throw new Cancelled();
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      // Never retry a stop. Retrying is how the owner pressing Stop once
      // becomes four more requests.
      if (isAbort(err)) throw err;
      const isLast = attempt === attempts - 1;
      if (isLast || !(err instanceof RateLimited)) break;

      const wait = err.retryAfterMs > 0 ? err.retryAfterMs : baseMs * 2 ** attempt;

      if (wait > MAX_RETRY_WAIT_MS) {
        // A quota, not a burst. Say what it is and roughly when it clears,
        // because "try again later" without a number is not actionable and a
        // silent forty-minute wait is worse.
        const minutes = Math.ceil(wait / 60_000);
        throw new RateLimited(
          `${label} has hit its rate limit and asked for ${minutes} minute` +
            `${minutes === 1 ? '' : 's'} before the next request. That is a ` +
            'quota rather than a burst — on a free tier it usually means the ' +
            'daily allowance is spent. Add a different provider in Settings, ' +
            'or wait it out.',
          wait,
        );
      }

      // Told, not silent: a 40-second pause with no explanation looks like a hang.
      console.warn(
        `\x1b[33m[llm]\x1b[0m ${label} rate-limited — waiting ${Math.round(wait / 1000)}s ` +
          `(attempt ${attempt + 1}/${attempts})`,
      );
      // Interruptible: Stop during a 40-second rate-limit wait has to be
      // instant, not "instant in 40 seconds".
      await sleep(wait, signal);
    }
  }

  throw lastError;
}

/** A wait that Stop can cut short. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Cancelled());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Seconds, or an HTTP-date, or nothing at all — all three appear in the wild. */
export function retryAfterMs(header: string | null): number {
  if (!header) return 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}
