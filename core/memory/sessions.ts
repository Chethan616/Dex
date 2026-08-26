import { randomUUID } from 'crypto';
import { db } from './db';

/**
 * One conversation, however it arrives.
 *
 * Dex has exactly one owner, which makes this far simpler than it would be for
 * a multi-user assistant: a task started on a phone and followed up at the desk
 * twenty minutes later is the *same* conversation, and there is nobody else it
 * could belong to. So sessions are keyed by time, not by channel.
 *
 * That is what makes "start it on WhatsApp, ask about it on Telegram" work.
 * The previous behaviour — a session map keyed by sender id, held in memory —
 * gave each channel its own history and lost all of it on restart, so the same
 * person talking to Dex two ways was two strangers.
 */

export interface Session {
  id: string;
  startedAt: number;
  lastSeenAt: number;
  /** Every channel that has spoken into this session. */
  channels: string[];
}

/**
 * How long a conversation stays open.
 *
 * Long enough to cover stepping away and coming back — the "start it on the
 * phone, finish at the desk" case this exists for. Short enough that tomorrow
 * morning's first request does not inherit last night's references, which is
 * how "the report" quietly resolves to the wrong thing.
 */
const IDLE_TIMEOUT_MS = 90 * 60 * 1000;

export class SessionStore {
  constructor(private idleTimeoutMs = IDLE_TIMEOUT_MS) {}

  /**
   * The session this message belongs to, creating one if the last has gone
   * cold. Records which channel it arrived on, so the history shows a task
   * genuinely crossing devices.
   */
  current(channel: string, now = Date.now()): Session {
    const row = db()
      .prepare('SELECT * FROM sessions ORDER BY last_seen_at DESC LIMIT 1')
      .get() as Record<string, unknown> | undefined;

    if (row && now - Number(row.last_seen_at) <= this.idleTimeoutMs) {
      const channels = JSON.parse(String(row.channels)) as string[];
      if (!channels.includes(channel)) channels.push(channel);
      db()
        .prepare('UPDATE sessions SET last_seen_at = ?, channels = ? WHERE id = ?')
        .run(now, JSON.stringify(channels), row.id);
      return {
        id: String(row.id),
        startedAt: Number(row.started_at),
        lastSeenAt: now,
        channels,
      };
    }

    const session: Session = {
      id: randomUUID(),
      startedAt: now,
      lastSeenAt: now,
      channels: [channel],
    };
    db()
      .prepare(
        'INSERT INTO sessions (id, started_at, last_seen_at, channels) VALUES (?, ?, ?, ?)',
      )
      .run(session.id, session.startedAt, session.lastSeenAt, JSON.stringify(session.channels));
    return session;
  }

  get(id: string): Session | undefined {
    const row = db().prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id),
      startedAt: Number(row.started_at),
      lastSeenAt: Number(row.last_seen_at),
      channels: JSON.parse(String(row.channels)) as string[],
    };
  }

  recent(limit = 10): Session[] {
    return (db()
      .prepare('SELECT * FROM sessions ORDER BY last_seen_at DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      startedAt: Number(row.started_at),
      lastSeenAt: Number(row.last_seen_at),
      channels: JSON.parse(String(row.channels)) as string[],
    }));
  }
}
