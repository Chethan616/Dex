import { expect, test, describe } from 'vitest';
import { resolveToolDefs } from '../../src/tools/registry.js';

describe('tool registry', () => {
  test('resolves valid tools', () => {
    const resolved = resolveToolDefs(['exec', 'slack']);
    expect(resolved.length).toBe(2);
    expect(resolved[0].name).toBe('exec');
    expect(resolved[0].inputSchema.type).toBe('object');
    expect(resolved[1].name).toBe('slack');
  });

  test('filters out invalid tools', () => {
    const resolved = resolveToolDefs(['exec', 'non-existent-tool', 'slack']);
    expect(resolved.length).toBe(2);
    expect(resolved.map(t => t.name)).toEqual(['exec', 'slack']);
  });

  test('resolves empty array', () => {
    const resolved = resolveToolDefs([]);
    expect(resolved.length).toBe(0);
  });
});
