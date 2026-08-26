import { createHash } from 'crypto';
import { ExecutionPlan } from '../events/types';
import { db } from './db';

/**
 * Skipping the Brain when a request is one Dex has already planned.
 *
 * Saved workflows (core/workflows/) cover requests the owner *chose* to keep.
 * This covers the rest: the same thing asked twice in different words, where
 * nobody thought to save anything. "check my unread email" and "any new mail?"
 * are one request, and planning the second from scratch is a call spent
 * re-deriving an answer already on disk.
 *
 * Embeddings come from Ollama rather than a sentence-transformers subprocess.
 * The plan called for the latter, but Ollama is already running for the vision
 * tier and exposes /api/embed — so this needs no second Python process, no
 * extra model download beyond one small embedding model, and no new failure
 * mode to supervise.
 *
 * The whole thing is an optimisation and degrades to nothing: no Ollama, no
 * embedding model, or an unfamiliar request all mean "ask the Brain", which is
 * what would have happened anyway.
 */

export interface CacheHit {
  plan: ExecutionPlan;
  similarity: number;
  originalText: string;
}

/**
 * Cosine similarity above which two requests are treated as the same task.
 *
 * Measured on nomic-embed-text against "check my unread email":
 *
 *   100.0%  same        check my unread email
 *    90.8%  DIFFERENT   archive my unread email     <- destructive
 *    89.1%  same        do I have unread emails
 *    77.8%  same        show me unread messages
 *    58.5%  DIFFERENT   delete all my emails
 *    51.5%  same        any new mail?
 *
 * The two groups do not separate. "archive my unread email" scores higher than
 * four genuine paraphrases, because embeddings measure *topic* and these
 * requests differ in *intent* — same subject, opposite effect. No threshold
 * admits the paraphrases without also admitting the archive.
 *
 * So this stays strict enough to catch only near-restatements, and the real
 * safety comes from CACHEABLE_TIER below rather than from this number.
 */
const HIT_THRESHOLD = 0.94;

/**
 * Only plans where every step is Tier 4 are cached.
 *
 * This is what makes the feature safe rather than merely tuned. A wrongly
 * served read-only plan wastes an action; a wrongly served destructive one
 * deletes something. Since similarity cannot reliably tell "check" from
 * "archive", the answer is to make the blast radius of a wrong hit nil —
 * anything that deletes, sends, installs or writes goes to the Brain every
 * time, however familiar it looks.
 */
const CACHEABLE_TIER = 4;

const EMBED_MODEL = process.env.DEX_EMBED_MODEL ?? 'nomic-embed-text';
const OLLAMA = process.env.OLLAMA_ENDPOINT ?? 'http://127.0.0.1:11434';

export class SemanticCache {
  private available: boolean | null = null;

  /** Checked once. A missing embedding model must not cost a probe per request. */
  private async ready(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      const resp = await fetch(`${OLLAMA}/api/tags`, {
        signal: AbortSignal.timeout(2_000),
      });
      const data = (await resp.json()) as { models?: Array<{ name: string }> };
      this.available = (data.models ?? []).some((m) =>
        m.name.toLowerCase().startsWith(EMBED_MODEL.split(':')[0].toLowerCase()),
      );
      if (!this.available) {
        console.warn(
          `\x1b[90m[cache]\x1b[0m semantic cache off — pull the model to enable it: ` +
            `ollama pull ${EMBED_MODEL}\x1b[0m`,
        );
      }
    } catch {
      this.available = false;
    }
    return this.available;
  }

  private async embed(text: string): Promise<Float64Array | null> {
    try {
      const resp = await fetch(`${OLLAMA}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: EMBED_MODEL, input: text }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) return null;
      const data = (await resp.json()) as { embeddings?: number[][] };
      const vector = data.embeddings?.[0];
      return vector ? Float64Array.from(vector) : null;
    } catch {
      return null;
    }
  }

  /**
   * A plan for this request, if one close enough is already known.
   *
   * The returned plan is re-stamped with the new requestId — reusing the old
   * one would make two different tasks share an event stream and an evidence
   * trail.
   */
  async lookup(text: string, requestId: string): Promise<CacheHit | null> {
    if (!(await this.ready())) return null;

    const vector = await this.embed(text);
    if (!vector) return null;

    let best: { row: Record<string, unknown>; similarity: number } | null = null;

    for (const row of db().prepare('SELECT * FROM plan_cache').all() as Array<
      Record<string, unknown>
    >) {
      const stored = decode(row.vector as Buffer);
      if (stored.length !== vector.length) continue;
      const similarity = cosine(vector, stored);
      if (!best || similarity > best.similarity) best = { row, similarity };
    }

    if (!best || best.similarity < HIT_THRESHOLD) return null;

    db()
      .prepare('UPDATE plan_cache SET hits = hits + 1, last_hit_at = ? WHERE id = ?')
      .run(Date.now(), best.row.id);

    const plan = JSON.parse(String(best.row.plan)) as ExecutionPlan;

    // Checked on the way out too. A plan stored by an older build, or before
    // this rule existed, must not be served now.
    if (!cacheable(plan)) {
      db().prepare('DELETE FROM plan_cache WHERE id = ?').run(best.row.id);
      return null;
    }

    return {
      plan: { ...plan, requestId },
      similarity: best.similarity,
      originalText: String(best.row.text),
    };
  }

  /**
   * Remember a plan that worked.
   *
   * Only ever called for tasks that completed. Caching a plan that failed would
   * mean serving a known-broken answer faster.
   */
  async remember(text: string, plan: ExecutionPlan): Promise<void> {
    if (!cacheable(plan)) return;
    if (!(await this.ready())) return;
    const vector = await this.embed(text);
    if (!vector) return;

    db()
      .prepare(
        `INSERT OR REPLACE INTO plan_cache (id, text, vector, plan, created_at, hits, last_hit_at)
         VALUES (?, ?, ?, ?, ?, COALESCE((SELECT hits FROM plan_cache WHERE id = ?), 0), NULL)`,
      )
      .run(
        keyFor(text),
        text,
        encode(vector),
        JSON.stringify(plan),
        Date.now(),
        keyFor(text),
      );
  }

  /** A plan that turned out to be wrong must not keep being served. */
  forget(text: string): void {
    db().prepare('DELETE FROM plan_cache WHERE id = ?').run(keyFor(text));
  }

  stats(): { entries: number; hits: number } {
    const row = db()
      .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(hits), 0) AS h FROM plan_cache')
      .get() as { n?: number; h?: number } | undefined;
    return { entries: Number(row?.n ?? 0), hits: Number(row?.h ?? 0) };
  }
}

/**
 * Every step silent, or it does not go in the cache.
 *
 * An empty plan is not cacheable either — serving "do nothing" for a request
 * that merely looks familiar is a silent failure, and the owner would see a
 * completed task that did none of what they asked.
 */
function cacheable(plan: ExecutionPlan): boolean {
  return (
    plan.steps.length > 0 &&
    plan.steps.every((step) => step.confirmationTier >= CACHEABLE_TIER)
  );
}

function keyFor(text: string): string {
  return createHash('sha256').update(text.trim().toLowerCase()).digest('hex').slice(0, 16);
}

function cosine(a: Float64Array, b: Float64Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function encode(vector: Float64Array): Buffer {
  return Buffer.from(new Float32Array(vector).buffer);
}

function decode(blob: Buffer): Float64Array {
  const floats = new Float32Array(
    blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength),
  );
  return Float64Array.from(floats);
}
