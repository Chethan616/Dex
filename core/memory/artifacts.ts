import { randomUUID } from 'crypto';
import * as path from 'path';
import { AgentResult, ExecutionStep } from '../events/types';
import { db } from './db';

/**
 * The things Dex's tasks leave behind.
 *
 * "Send me the report" only means something if Dex knows a report exists. So
 * every step that produces something durable — a file, an email, a calendar
 * entry, a page it ended up on — records it, and later requests can refer back
 * to it by name rather than by repeating the whole path.
 *
 * Artifacts are derived from what steps actually did, not from what the Brain
 * intended. A plan that meant to write a file but failed leaves no artifact,
 * which is the point: a reference should only ever resolve to something real.
 */

export type ArtifactKind = 'file' | 'email' | 'event' | 'page' | 'app' | 'setting';

export interface Artifact {
  id: string;
  requestId: string;
  sessionId: string;
  kind: ArtifactKind;
  /** What the owner would call it: "invoice.pdf", "Q3 report", "Notepad". */
  name: string;
  /** How to find it again: a path, a URL, a message id. */
  locator: string;
  createdAt: number;
}

export class ArtifactStore {
  /**
   * Read whatever a completed step produced.
   *
   * Deliberately conservative. Recording a guess would be worse than recording
   * nothing: a wrong artifact makes "the report" resolve to something that was
   * never a report, and the owner would have no reason to doubt it.
   */
  recordFromStep(
    step: ExecutionStep,
    result: AgentResult,
    requestId: string,
    sessionId: string,
  ): Artifact[] {
    if (!result.success) return [];

    const found: Array<Omit<Artifact, 'id' | 'requestId' | 'sessionId' | 'createdAt'>> = [];
    const params = step.params as Record<string, unknown>;
    const data = (result.data ?? {}) as Record<string, unknown>;

    // A file the plan said it would produce, and verification confirmed.
    const file = params.verify_file ?? params.path ?? params.file;
    if (typeof file === 'string' && looksLikePath(file)) {
      found.push({ kind: 'file', name: path.basename(file), locator: file });
    }

    // Where a browser task finished. The last page is what "that page" means.
    const url = data.url;
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      found.push({ kind: 'page', name: titleOf(data.title, url), locator: url });
    }

    // A workspace write that was read back — the id is proof it exists.
    const readBack = data.readBack as { verified?: boolean; id?: string } | undefined;
    if (readBack?.verified && readBack.id) {
      const kind: ArtifactKind = step.action.includes('event') ? 'event' : 'email';
      const name =
        String(params.subject ?? params.title ?? params.query ?? step.action);
      found.push({ kind, name, locator: readBack.id });
    }

    if (step.action === 'launch_app' && typeof params.name === 'string') {
      // The locator is the name the owner used, NOT what was executed. Windows
      // launches Calculator through a `calc.exe` stub that exits immediately,
      // so "close the app" resolving to "calc.exe" gives close_app a process
      // that does not exist and a window title that never appears.
      found.push({ kind: 'app', name: params.name, locator: params.name });
    }

    if (step.action === 'registry_write' && typeof params.path === 'string') {
      found.push({
        kind: 'setting',
        name: String(params.name ?? params.path),
        locator: `${params.path}\\${params.name ?? ''}`,
      });
    }

    return found.map((partial) => this.save({ ...partial, requestId, sessionId }));
  }

  save(input: Omit<Artifact, 'id' | 'createdAt'>): Artifact {
    const artifact: Artifact = { ...input, id: randomUUID(), createdAt: Date.now() };
    db()
      .prepare(
        `INSERT INTO artifacts (id, request_id, session_id, kind, name, locator, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        artifact.id,
        artifact.requestId,
        artifact.sessionId,
        artifact.kind,
        artifact.name,
        artifact.locator,
        artifact.createdAt,
      );
    return artifact;
  }

  /** Newest first, optionally within a window. */
  recent(limit = 40, sinceMs?: number): Artifact[] {
    const rows = sinceMs
      ? db()
          .prepare('SELECT * FROM artifacts WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?')
          .all(Date.now() - sinceMs, limit)
      : db().prepare('SELECT * FROM artifacts ORDER BY created_at DESC LIMIT ?').all(limit);
    return (rows as Array<Record<string, unknown>>).map(hydrate);
  }

  forSession(sessionId: string): Artifact[] {
    return (db()
      .prepare('SELECT * FROM artifacts WHERE session_id = ? ORDER BY created_at DESC')
      .all(sessionId) as Array<Record<string, unknown>>).map(hydrate);
  }
}

function hydrate(row: Record<string, unknown>): Artifact {
  return {
    id: String(row.id),
    requestId: String(row.request_id),
    sessionId: String(row.session_id),
    kind: String(row.kind) as ArtifactKind,
    name: String(row.name),
    locator: String(row.locator),
    createdAt: Number(row.created_at),
  };
}

function looksLikePath(value: string): boolean {
  return /[\\/]/.test(value) && /\.\w{1,6}$/.test(value);
}

function titleOf(title: unknown, url: string): string {
  if (typeof title === 'string' && title.trim()) return title.trim().slice(0, 80);
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 80);
  }
}
