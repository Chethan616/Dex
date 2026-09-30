import { describe, expect, it } from 'vitest';
import { liveMood, moodFor } from '../../../src/renderer/components/lib/botMood';

describe('bot moods', () => {
  it('reads a live run: working while a tool runs, thinking while it writes', () => {
    expect(liveMood([{ type: 'tool_call', name: 'Bash' }])).toBe('working');
    expect(liveMood([{ type: 'tool_call', name: 'Bash' }, { type: 'tool_result', name: 'Bash' }, { type: 'thinking' }])).toBe('thinking');
    expect(liveMood([{ type: 'tool_call', name: 'Bash' }, { type: 'tool_result', name: 'Bash' }])).toBe('thinking');
    expect(liveMood([])).toBe('working');
  });

  it('needs you while an approval is pending, not once it was answered', () => {
    expect(liveMood([{ type: 'confirmation', id: 'c1', status: 'pending' }])).toBe('needs-you');
    expect(liveMood([{ type: 'confirmation', id: 'c1', status: 'pending' }, { type: 'confirmation', id: 'c1', status: 'approved' }, { type: 'thinking' }])).toBe('thinking');
    expect(liveMood([{ type: 'notify', level: 'blocking' }])).toBe('needs-you');
  });

  it('sleeps when paused or done, and is sad when it failed', () => {
    expect(moodFor({ status: 'paused' })).toBe('sleeping');
    expect(moodFor({ status: 'idle', output: [{ type: 'done' }] })).toBe('sleeping');
    expect(moodFor({ status: 'stopped', error: 'boom' })).toBe('sad');
    expect(moodFor({ status: 'stopped', error: 'Task was cancelled' })).toBe('sleeping');
    expect(moodFor({ status: 'idle', output: [{ type: 'user_input' }, { type: 'error' }] })).toBe('sad');
    expect(moodFor({ status: 'draft' })).toBe('awake');
  });
});
