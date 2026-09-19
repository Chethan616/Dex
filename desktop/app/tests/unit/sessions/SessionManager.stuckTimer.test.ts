/**
 * The 30s "stuck" detector must not fire while a dex-registry confirmation
 * is outstanding — a human can take much longer than 30 seconds to read a
 * card and click a button, and marking the session "stuck" mid-wait would
 * be actively misleading (nothing is wrong; it is waiting on exactly the
 * person watching it). suspendStuckTimer is the one-line fix for that,
 * and this is what proves it actually holds off the timer rather than
 * merely delaying it by another 30 seconds.
 *
 * SessionDb is mocked the same way SessionManager.taskState.test.ts mocks
 * it — better-sqlite3 is built against Electron's ABI and will not dlopen
 * under plain Node.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HlEvent, SessionStatus } from '../../../src/shared/session-schemas';

type MockRow = { id: string; prompt: string; status: SessionStatus; created_at: number };
type MockStore = { rows: Map<string, MockRow>; events: Map<string, HlEvent[]> };

const mockState = vi.hoisted(() => ({ stores: new Map<string, MockStore>() }));

vi.mock('../../../src/main/sessions/SessionDb', () => {
  class MockSessionDb {
    private store: MockStore;

    constructor(dbPath: string) {
      let store = mockState.stores.get(dbPath);
      if (!store) {
        store = { rows: new Map(), events: new Map() };
        mockState.stores.set(dbPath, store);
      }
      this.store = store;
    }

    recoverStaleSessions(): number { return 0; }
    listSessions(): MockRow[] { return Array.from(this.store.rows.values()); }
    insertSession(session: { id: string; prompt: string; status: SessionStatus; createdAt: number }): void {
      this.store.rows.set(session.id, { id: session.id, prompt: session.prompt, status: session.status, created_at: session.createdAt });
    }
    updateSessionStatus(id: string, status: SessionStatus): void {
      const row = this.store.rows.get(id);
      if (row) row.status = status;
    }
    getTaskState(): never { throw new Error('not used in this test'); }
    saveTaskState(): void {}
    clearTaskState(): void {}
    appendEvent(sessionId: string, seq: number, event: HlEvent): void {
      const events = this.store.events.get(sessionId) ?? [];
      events[seq] = event;
      this.store.events.set(sessionId, events);
    }
    getEvents(sessionId: string): HlEvent[] { return this.store.events.get(sessionId) ?? []; }
    clearEvents(): void {}
    updateSessionPrompt(): void {}
    updateCreatedAt(): void {}
    updateNavigation(): void {}
    updateEngine(): void {}
    updateEngineSessionId(): void {}
    updateModel(): void {}
    updateAuth(): void {}
    updateUsage(): void {}
    saveMessages(): void {}
    getMessages(): unknown[] | null { return null; }
    getSessionOrigin(): { originChannel: null; originConversationId: null } { return { originChannel: null, originConversationId: null }; }
    deleteSession(): void {}
    getNextTurnIndex(): number { return 0; }
    saveAttachment(): number { return 1; }
    getAttachmentsMeta(): [] { return []; }
    getLatestTurnAttachments(): [] { return []; }
    close(): void {}
  }

  return { SessionDb: MockSessionDb };
});

const { SessionManager } = await import('../../../src/main/sessions/SessionManager');

// Mirrors STUCK_TIMEOUT_MS in SessionManager.ts, which isn't exported —
// this is deliberately the same magic number, not a re-derivation of it.
const STUCK_TIMEOUT_MS = 30_000;

let dbSeq = 0;
function tempDbPath(): string { dbSeq += 1; return `stuck-timer-db-${dbSeq}`; }

describe('stuck timer suspension for a pending confirmation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    mockState.stores.clear();
  });

  it('marks a session stuck after 30s of silence, as a control', () => {
    const manager = new SessionManager(tempDbPath());
    const id = manager.createSession('do something long');
    manager.startSession(id);

    vi.advanceTimersByTime(STUCK_TIMEOUT_MS + 1);

    expect(manager.getSession(id)?.status).toBe('stuck');
    manager.destroy();
  });

  it('never goes stuck while suspendStuckTimer is in effect, however long the wait', () => {
    const manager = new SessionManager(tempDbPath());
    const id = manager.createSession('needs a registry confirmation');
    manager.startSession(id);

    manager.suspendStuckTimer(id);
    vi.advanceTimersByTime(STUCK_TIMEOUT_MS * 5);

    expect(manager.getSession(id)?.status).toBe('running');
    manager.destroy();
  });

  it('resumes normal stuck detection once real activity follows the answered confirmation', () => {
    const manager = new SessionManager(tempDbPath());
    const id = manager.createSession('needs a registry confirmation');
    manager.startSession(id);

    manager.suspendStuckTimer(id);
    vi.advanceTimersByTime(STUCK_TIMEOUT_MS * 2); // the human takes their time answering
    expect(manager.getSession(id)?.status).toBe('running');

    // The confirmation was answered; the agent's next tool call reports back
    // through the same appendOutput every other event uses, which resets
    // the timer exactly as it would for any ordinary tool result.
    manager.appendOutput(id, { type: 'tool_call', name: 'dex-registry', args: {}, iteration: 1 });
    expect(manager.getSession(id)?.status).toBe('running');

    vi.advanceTimersByTime(STUCK_TIMEOUT_MS + 1);
    expect(manager.getSession(id)?.status).toBe('stuck');

    manager.destroy();
  });
});
