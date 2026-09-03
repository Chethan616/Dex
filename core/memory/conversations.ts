/**
 * What was actually said, kept.
 *
 * The sidebar has always shown history, and clicking a row could only ever
 * re-run the request — because the only thing on disk was the request. There
 * were tasks, steps, workflows, artifacts and schedules; there was no record
 * of a single sentence Dex or the owner had said. "History" meant "a list of
 * things you once asked", and clicking one meant "ask it again", which is the
 * one thing a person looking at their history rarely wants.
 *
 * So messages are written as they happen. Not reconstructed at the end from
 * the task record — a reconstruction is a summary of what the transcript
 * would have been, and it loses exactly the thing worth keeping: the step that
 * failed, the card that was shown, the answer in the words it was given in.
 *
 * **A conversation is not a task.** A task is one request and its plan; a
 * conversation is the thread the owner sees, and it holds however many
 * requests they made without starting a new chat. Turns are grouped by
 * conversation id, which the app supplies and the core does not invent.
 */
import { Database } from './db';

export type Speaker = 'human' | 'agent' | 'step';

export interface StoredMessage {
  id: number;
  conversationId: string;
  requestId: string | null;
  speaker: Speaker;
  text: string;
  /**
   * Everything the app needs to redraw the message that is not its text: a
   * step's action and verdict, an artifact card, the engine that ran it.
   * Stored as JSON because its shape belongs to the app, and a column per
   * field would mean a migration every time a card gains a line.
   */
  detail: Record<string, unknown> | null;
  at: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  messageCount: number;
  startedAt: number;
  lastAt: number;
  /** True when any task in it ended badly. Failures are worth finding again. */
  failed: boolean;
}

export class Conversations {
  constructor(private db: Database) {}

  /**
   * Record one message.
   *
   * Never throws into the caller. A conversation that cannot be written is a
   * lost record, which is bad; a task that dies because its record could not
   * be written is worse, and it is the owner's actual work.
   */
  append(message: {
    conversationId: string;
    requestId?: string | null;
    speaker: Speaker;
    text: string;
    detail?: Record<string, unknown> | null;
    at?: number;
  }): void {
    const text = (message.text ?? '').trim();
    if (!message.conversationId || !text) return;

    try {
      this.db
        .prepare(
          'INSERT INTO messages (conversation_id, request_id, speaker, text, detail, at) ' +
            'VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          message.conversationId,
          message.requestId ?? null,
          message.speaker,
          text.slice(0, 20_000),
          message.detail ? JSON.stringify(message.detail).slice(0, 200_000) : null,
          message.at ?? Date.now(),
        );
    } catch {
      // Deliberately silent. See above.
    }
  }

  /** Every message in one conversation, oldest first — the thread as it ran. */
  messages(conversationId: string, limit = 500): StoredMessage[] {
    const rows = this.db
      .prepare(
        'SELECT id, conversation_id, request_id, speaker, text, detail, at ' +
          'FROM messages WHERE conversation_id = ? ORDER BY at ASC, id ASC LIMIT ?',
      )
      .all(conversationId, limit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: Number(row.id),
      conversationId: String(row.conversation_id),
      requestId: row.request_id === null ? null : String(row.request_id),
      speaker: String(row.speaker) as Speaker,
      text: String(row.text),
      detail: parseDetail(row.detail),
      at: Number(row.at),
    }));
  }

  /**
   * The conversations, newest first.
   *
   * The title is the first thing the owner said, which is what they will
   * recognise. A generated summary would read better and be wrong more often,
   * and a row nobody recognises is a row nobody clicks.
   */
  list(limit = 50): ConversationSummary[] {
    const rows = this.db
      .prepare(
        `SELECT m.conversation_id AS id,
                COUNT(*)          AS count,
                MIN(m.at)         AS started_at,
                MAX(m.at)         AS last_at,
                (SELECT text FROM messages
                  WHERE conversation_id = m.conversation_id AND speaker = 'human'
                  ORDER BY at ASC, id ASC LIMIT 1) AS title,
                (SELECT name FROM conversation_names
                  WHERE conversation_id = m.conversation_id)        AS given_name,
                (SELECT COUNT(*) FROM tasks t
                  WHERE t.request_id IN (
                    SELECT request_id FROM messages
                     WHERE conversation_id = m.conversation_id AND request_id IS NOT NULL
                  )
                  AND t.status IS NOT NULL
                  AND t.status NOT IN ('COMPLETED', 'ANSWERED'))    AS failures
           FROM messages m
          GROUP BY m.conversation_id
          ORDER BY last_at DESC
          LIMIT ?`,
      )
      .all(limit) as Array<Record<string, unknown>>;

    return rows
      .map((row) => ({
        id: String(row.id),
        title: String(row.given_name ?? row.title ?? '').trim(),
        messageCount: Number(row.count ?? 0),
        startedAt: Number(row.started_at ?? 0),
        lastAt: Number(row.last_at ?? 0),
        failed: Number(row.failures ?? 0) > 0,
      }))
      .filter((row) => row.title.length > 0);
  }

  /**
   * Conversations containing this text.
   *
   * Searching *inside* messages is the thing task history could never do: the
   * answer to "what was that command Dex gave me last week" is in a reply, not
   * in a request.
   */
  search(query: string, limit = 30): ConversationSummary[] {
    const term = query.trim();
    if (!term) return [];

    const ids = this.db
      .prepare(
        'SELECT DISTINCT conversation_id FROM messages ' +
          'WHERE text LIKE ? ORDER BY at DESC LIMIT ?',
      )
      .all(`%${term}%`, limit) as Array<Record<string, unknown>>;

    const wanted = new Set(ids.map((row) => String(row.conversation_id)));
    return this.list(200).filter((row) => wanted.has(row.id));
  }

  /** Give a conversation a name of the owner's choosing. */
  rename(conversationId: string, name: string): void {
    const cleaned = name.trim().slice(0, 200);
    if (!conversationId) return;

    if (!cleaned) {
      this.db
        .prepare('DELETE FROM conversation_names WHERE conversation_id = ?')
        .run(conversationId);
      return;
    }
    this.db
      .prepare(
        'INSERT INTO conversation_names (conversation_id, name) VALUES (?, ?) ' +
          'ON CONFLICT(conversation_id) DO UPDATE SET name = excluded.name',
      )
      .run(conversationId, cleaned);
  }

  /**
   * Forget a conversation.
   *
   * The messages and the name only. The tasks stay: they are what the planner
   * learns from, and deleting a chat should not quietly make Dex worse at the
   * thing it was about.
   */
  remove(conversationId: string): number {
    if (!conversationId) return 0;
    const result = this.db
      .prepare('DELETE FROM messages WHERE conversation_id = ?')
      .run(conversationId);
    this.db
      .prepare('DELETE FROM conversation_names WHERE conversation_id = ?')
      .run(conversationId);
    return Number((result as { changes?: number }).changes ?? 0);
  }
}

function parseDetail(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
