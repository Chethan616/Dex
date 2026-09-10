/**
 * The task-state ledger.
 *
 * SessionDb is mocked the same way SessionManager.persistence.test.ts mocks it
 * — better-sqlite3 is built against Electron's ABI and will not dlopen under
 * plain Node — but the mock stores the ledger as the real one does (serialised
 * JSON, keyed by db path) so a "restart" still round-trips through a string.
 *
 * The behaviour that matters most here is the fallback rule: a step that fails
 * on one interface and names another stays OPEN, and keeps the failure as
 * history once it later succeeds. That is what "a tool failure is not a task
 * failure" reduces to in code, and it is the thing a future refactor is most
 * likely to quietly break.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HlEvent, SessionStatus, TaskState } from '../../../src/shared/session-schemas';

type MockRow = { id: string; prompt: string; status: SessionStatus; created_at: number };
type MockStore = {
  rows: Map<string, MockRow>;
  events: Map<string, HlEvent[]>;
  /** Serialised exactly like the real table's JSON columns. */
  ledger: Map<string, string>;
};

const mockState = vi.hoisted(() => ({ stores: new Map<string, MockStore>() }));

vi.mock('../../../src/main/sessions/SessionDb', () => {
  const EMPTY: TaskState = { objective: '', steps: [], currentStep: null, files: [], notes: [], updatedAt: 0 };

  class MockSessionDb {
    private store: MockStore;

    constructor(dbPath: string) {
      let store = mockState.stores.get(dbPath);
      if (!store) {
        store = { rows: new Map(), events: new Map(), ledger: new Map() };
        mockState.stores.set(dbPath, store);
      }
      this.store = store;
    }

    recoverStaleSessions(): number { return 0; }
    listSessions(): MockRow[] { return Array.from(this.store.rows.values()); }

    insertSession(session: { id: string; prompt: string; status: SessionStatus; createdAt: number }): void {
      this.store.rows.set(session.id, {
        id: session.id, prompt: session.prompt, status: session.status, created_at: session.createdAt,
      });
    }

    updateSessionStatus(id: string, status: SessionStatus): void {
      const row = this.store.rows.get(id);
      if (row) row.status = status;
    }

    getTaskState(sessionId: string): TaskState {
      const raw = this.store.ledger.get(sessionId);
      return raw ? (JSON.parse(raw) as TaskState) : { ...EMPTY };
    }

    saveTaskState(sessionId: string, state: TaskState): void {
      this.store.ledger.set(sessionId, JSON.stringify(state));
    }

    clearTaskState(sessionId: string): void { this.store.ledger.delete(sessionId); }

    appendEvent(sessionId: string, seq: number, event: HlEvent): void {
      const events = this.store.events.get(sessionId) ?? [];
      events[seq] = event;
      this.store.events.set(sessionId, events);
    }

    getEvents(sessionId: string): HlEvent[] { return this.store.events.get(sessionId) ?? []; }
    clearEvents(sessionId: string): void { this.store.events.set(sessionId, []); }
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
    getSessionOrigin(): { originChannel: null; originConversationId: null } {
      return { originChannel: null, originConversationId: null };
    }
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

let dbSeq = 0;
function tempDbPath(): string { dbSeq += 1; return `ledger-db-${dbSeq}`; }

afterEach(() => { mockState.stores.clear(); });

/** A manager with one session and, optionally, a plan already recorded. */
function setup(...titles: string[]): { manager: InstanceType<typeof SessionManager>; id: string; dbPath: string } {
  const dbPath = tempDbPath();
  const manager = new SessionManager(dbPath);
  const id = manager.createSession('download the syllabus and send it on whatsapp');
  if (titles.length > 0) {
    manager.applyTaskState(id, {
      op: 'plan',
      objective: 'download the syllabus and send it on whatsapp',
      steps: titles.map((title) => ({ title })),
    });
  }
  return { manager, id, dbPath };
}

describe('task state ledger', () => {
  it('records a plan with numbered, pending steps', () => {
    const { manager, id } = setup('Open the portal', 'Log in', 'Download the PDF');
    const state = manager.getTaskState(id);

    expect(state.objective).toBe('download the syllabus and send it on whatsapp');
    expect(state.steps.map((s) => s.id)).toEqual(['step_1', 'step_2', 'step_3']);
    expect(state.steps.every((s) => s.status === 'pending')).toBe(true);
    expect(state.currentStep).toBeNull();
    manager.destroy();
  });

  it('survives a restart', () => {
    const { manager, id, dbPath } = setup('Open the portal', 'Log in');
    manager.applyTaskState(id, { op: 'step-start', stepId: 'step_1' });
    manager.applyTaskState(id, { op: 'step-done' });
    manager.destroy();

    const reopened = new SessionManager(dbPath);
    const state = reopened.getTaskState(id);
    expect(state.steps[0].status).toBe('done');
    expect(state.objective).toBe('download the syllabus and send it on whatsapp');
    reopened.destroy();
  });

  it('step-done with no id completes whichever step is active', () => {
    const { manager, id } = setup('One', 'Two');
    manager.applyTaskState(id, { op: 'step-start', stepId: 'step_2' });
    manager.applyTaskState(id, { op: 'step-done' });

    const state = manager.getTaskState(id);
    expect(state.steps[1].status).toBe('done');
    expect(state.steps[0].status).toBe('pending');
    expect(state.currentStep).toBeNull();
    manager.destroy();
  });

  it('keeps a step ACTIVE when a failure names a fallback', () => {
    const { manager, id } = setup('Attach the file');
    manager.applyTaskState(id, { op: 'step-start', stepId: 'step_1' });
    manager.applyTaskState(id, {
      op: 'step-fail',
      reason: 'attachment button missing from the accessibility tree',
      tool: 'uia',
      fallback: 'vision',
    });

    const state = manager.getTaskState(id);
    // Still current: the agent is mid-recovery, not finished with this step.
    expect(state.steps[0].status).toBe('active');
    expect(state.currentStep).toBe('step_1');
    expect(state.steps[0].failures).toHaveLength(1);
    expect(state.steps[0].failures[0].fallback).toBe('vision');
    manager.destroy();
  });

  it('closes a step as failed when there is no fallback left', () => {
    const { manager, id } = setup('Attach the file');
    manager.applyTaskState(id, { op: 'step-start', stepId: 'step_1' });
    manager.applyTaskState(id, { op: 'step-fail', reason: 'portal returned 503 three times' });

    const state = manager.getTaskState(id);
    expect(state.steps[0].status).toBe('failed');
    expect(state.currentStep).toBeNull();
    manager.destroy();
  });

  it('a recovered step ends up done but still carries what went wrong', () => {
    const { manager, id } = setup('Attach the file');
    manager.applyTaskState(id, { op: 'step-start', stepId: 'step_1' });
    manager.applyTaskState(id, { op: 'step-fail', reason: 'not in the tree', tool: 'uia', fallback: 'vision' });
    manager.applyTaskState(id, { op: 'step-done' });

    const step = manager.getTaskState(id).steps[0];
    expect(step.status).toBe('done');
    expect(step.failures).toHaveLength(1);
    expect(step.failures[0].tool).toBe('uia');
    manager.destroy();
  });

  it('re-planning preserves the history of steps whose ids are reused', () => {
    const { manager, id } = setup('One', 'Two');
    manager.applyTaskState(id, { op: 'step-start', stepId: 'step_1' });
    manager.applyTaskState(id, { op: 'step-done' });

    manager.applyTaskState(id, {
      op: 'plan',
      steps: [
        { id: 'step_1', title: 'One' },
        { id: 'step_2', title: 'Two, revised' },
        { id: 'step_3', title: 'Three' },
      ],
    });

    const state = manager.getTaskState(id);
    // The whole point: a mid-task re-plan must not erase completed work.
    expect(state.steps[0].status).toBe('done');
    expect(state.steps[1].title).toBe('Two, revised');
    expect(state.steps[2].status).toBe('pending');
    expect(state.objective).toBe('download the syllabus and send it on whatsapp');
    manager.destroy();
  });

  it('marks an abandoned step skipped rather than leaving two active', () => {
    const { manager, id } = setup('One', 'Two');
    manager.applyTaskState(id, { op: 'step-start', stepId: 'step_1' });
    manager.applyTaskState(id, { op: 'step-start', stepId: 'step_2' });

    const state = manager.getTaskState(id);
    expect(state.steps[0].status).toBe('skipped');
    expect(state.steps[1].status).toBe('active');
    expect(state.steps.filter((s) => s.status === 'active')).toHaveLength(1);
    manager.destroy();
  });

  it('records produced files without duplicating a repeated path', () => {
    const { manager, id } = setup('Download');
    manager.applyTaskState(id, { op: 'file', path: 'C:\\Users\\me\\syllabus.pdf', size: 1024 });
    manager.applyTaskState(id, { op: 'file', path: 'C:\\Users\\me\\syllabus.pdf', size: 2048 });

    const files = manager.getTaskState(id).files;
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('syllabus.pdf');
    expect(files[0].size).toBe(2048);
    manager.destroy();
  });

  it('derives a file name from a POSIX path too', () => {
    const { manager, id } = setup('Download');
    manager.applyTaskState(id, { op: 'file', path: '/home/me/reports/q3.csv' });
    expect(manager.getTaskState(id).files[0].name).toBe('q3.csv');
    manager.destroy();
  });

  it('publishes every change as a task_state event on the session', () => {
    const { manager, id } = setup();
    const seen: HlEvent[] = [];
    manager.on('session-output', (_id: string, event: HlEvent) => seen.push(event));

    manager.applyTaskState(id, { op: 'plan', objective: 'x', steps: [{ title: 'One' }] });
    manager.applyTaskState(id, { op: 'step-start', stepId: 'step_1' });

    const ledgerEvents = seen.filter((e) => e.type === 'task_state');
    expect(ledgerEvents).toHaveLength(2);
    const last = ledgerEvents[1];
    if (last.type !== 'task_state') throw new Error('expected a task_state event');
    expect(last.state.currentStep).toBe('step_1');
    manager.destroy();
  });

  it('get returns the ledger without recording anything', () => {
    const { manager, id } = setup('One');
    const before = manager.getTaskState(id).updatedAt;
    const returned = manager.applyTaskState(id, { op: 'get' });

    expect(returned.steps).toHaveLength(1);
    expect(manager.getTaskState(id).updatedAt).toBe(before);
    manager.destroy();
  });

  it('rejects a step id that is not in the plan', () => {
    const { manager, id } = setup('One');
    expect(() => manager.applyTaskState(id, { op: 'step-start', stepId: 'step_9' })).toThrow(/unknown step/);
    manager.destroy();
  });

  it('rejects an unknown session', () => {
    const { manager } = setup();
    expect(() => manager.applyTaskState('nope', { op: 'get' })).toThrow(/unknown session/);
    manager.destroy();
  });

  it('starts empty for a session that never wrote to the ledger', () => {
    const { manager, id } = setup();
    const state = manager.getTaskState(id);
    expect(state.steps).toEqual([]);
    expect(state.objective).toBe('');
    expect(state.files).toEqual([]);
    manager.destroy();
  });
});
