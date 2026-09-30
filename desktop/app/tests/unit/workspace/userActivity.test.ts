import { afterEach, describe, expect, it, vi } from 'vitest';
import { noteAgentInput, noteInputEvent, userActiveWithin, waitForUserIdle } from '../../../src/main/workspace/userActivity';

describe('userActivity', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('counts clicks, scrolls and typing as you using the page; hovering isn’t', () => {
    const tab = {};
    noteInputEvent(tab, 'mouseMove');
    expect(userActiveWithin(tab, 1000)).toBe(false);
    noteInputEvent(tab, 'mouseWheel');
    expect(userActiveWithin(tab, 1000)).toBe(true);
  });

  it('does not mistake DEX’s own input for yours', () => {
    const tab = {};
    noteAgentInput(tab, 400);
    noteInputEvent(tab, 'mouseDown');
    noteInputEvent(tab, 'keyDown');
    expect(userActiveWithin(tab, 1000)).toBe(false);
  });

  it('waits while you are active, then lets DEX continue', async () => {
    vi.useFakeTimers();
    const tab = {};
    noteInputEvent(tab, 'mouseDown');
    let waited = -1;
    const done = waitForUserIdle(tab, { idleMs: 1000, maxWaitMs: 8000 }).then((ms) => { waited = ms; });
    await vi.advanceTimersByTimeAsync(500);
    expect(waited).toBe(-1);
    await vi.advanceTimersByTimeAsync(700);
    await done;
    expect(waited).toBeGreaterThanOrEqual(1000);
    expect(waited).toBeLessThan(1400);
  });

  it('never stalls DEX longer than the cap, however busy you are', async () => {
    vi.useFakeTimers();
    const tab = {};
    noteInputEvent(tab, 'keyDown');
    const busy = setInterval(() => noteInputEvent(tab, 'keyDown'), 50);
    let waited = -1;
    const done = waitForUserIdle(tab, { idleMs: 1000, maxWaitMs: 3000 }).then((ms) => { waited = ms; });
    await vi.advanceTimersByTimeAsync(3300);
    await done;
    clearInterval(busy);
    expect(waited).toBeGreaterThanOrEqual(3000);
    expect(waited).toBeLessThan(3300);
  });

  it('does not wait at all for a page you haven’t touched', async () => {
    expect(await waitForUserIdle({})).toBeLessThan(20);
  });
});
