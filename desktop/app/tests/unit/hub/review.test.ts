/**
 * Review (src/renderer/hub/workspace/review.ts): what a task changed, from
 * its own events, and the line diffs shown for it.
 */
import { describe, expect, it } from 'vitest';
import { changeCounts, collectReview, diffLines } from '../../../src/renderer/hub/workspace/review';

describe('Review: what the task changed', () => {
  it('collects edits and writes that succeeded, newest file first, and the files it made', () => {
    const files = collectReview([
      { type: 'tool_call', name: 'Write', args: { file_path: 'C:\\work\\notes.md', content: 'a\nb' }, at: 1 },
      { type: 'tool_result', name: 'Write', ok: true },
      { type: 'tool_call', name: 'Edit', args: { file_path: 'C:\\work\\app.ts', old_string: 'x = 1', new_string: 'x = 2' }, at: 2 },
      { type: 'tool_result', name: 'Edit', ok: false },
      { type: 'tool_call', name: 'Edit', args: { file_path: 'C:\\work\\app.ts', old_string: 'y = 1', new_string: 'y = 3' }, at: 3 },
      { type: 'tool_result', name: 'Edit', ok: true },
      { type: 'tool_call', name: 'Read', args: { file_path: 'C:\\work\\other.ts' } },
      { type: 'tool_result', name: 'Read', ok: true },
      { type: 'file_output', name: 'report.pdf', path: 'C:\\out\\report.pdf' },
    ]);
    expect(files.map((f) => f.name)).toEqual(['report.pdf', 'app.ts', 'notes.md']);
    const app = files.find((f) => f.name === 'app.ts')!;
    // The failed edit isn't a change.
    expect(app.edits).toEqual([{ kind: 'edit', before: 'y = 1', after: 'y = 3', at: 3 }]);
    expect(files[0]).toMatchObject({ made: true, edits: [] });
  });

  it('takes MultiEdit apart, and Codex changes as paths with what happened to them', () => {
    const files = collectReview([
      { type: 'tool_call', name: 'MultiEdit', args: { file_path: '/a.ts', edits: [{ old_string: '1', new_string: '2' }, { old_string: '3', new_string: '4' }] } },
      { type: 'tool_result', name: 'MultiEdit', ok: true },
      { type: 'tool_call', name: 'Edit', args: { changes: [{ path: '/b.ts', kind: 'add' }, { path: '/c.ts', kind: 'delete' }, { path: '/d.ts', kind: 'update' }] } },
      { type: 'tool_result', name: 'Edit', ok: true },
    ]);
    expect(files.find((f) => f.path === '/a.ts')!.edits).toHaveLength(2);
    expect(files.filter((f) => f.path !== '/a.ts').map((f) => [f.name, f.edits[0].kind])).toEqual(
      expect.arrayContaining([['b.ts', 'add'], ['c.ts', 'delete'], ['d.ts', 'update']]),
    );
  });

  it('diffs line by line, keeping three lines of context and folding the rest', () => {
    const before = ['1', '2', '3', '4', '5', '6', 'old', '8', '9', '10', '11', '12'].join('\n');
    const after = ['1', '2', '3', '4', '5', '6', 'new', 'added', '8', '9', '10', '11', '12'].join('\n');
    expect(diffLines(before, after)).toEqual([
      { type: 'gap', count: 3 },
      { type: ' ', text: '4' }, { type: ' ', text: '5' }, { type: ' ', text: '6' },
      { type: '-', text: 'old' },
      { type: '+', text: 'new' }, { type: '+', text: 'added' },
      { type: ' ', text: '8' }, { type: ' ', text: '9' }, { type: ' ', text: '10' },
      { type: 'gap', count: 2 },
    ]);
  });

  it('keeps common lines inside a change as context', () => {
    expect(diffLines('a\nb\nc', 'a2\nb\nc2')).toEqual([
      { type: '-', text: 'a' }, { type: '+', text: 'a2' }, { type: ' ', text: 'b' }, { type: '-', text: 'c' }, { type: '+', text: 'c2' },
    ]);
  });

  it('counts lines added and removed', () => {
    expect(changeCounts({ path: '/x', name: 'x', made: false, edits: [{ kind: 'edit', before: 'a\nb', after: 'a\nc\nd' }, { kind: 'write', after: '1\n2\n3' }] }))
      .toEqual({ added: 5, removed: 1 });
  });
});
