import { expect, test, describe } from 'vitest';
import { isToolAvailable, resolveToolDefs } from '../../src/tools/registry.js';

describe('tool registry', () => {
  test('resolves only locally available tools', () => {
    const resolved = resolveToolDefs(['exec', 'slack']);
    expect(resolved.length).toBe(1);
    expect(resolved[0].name).toBe('exec');
    expect(resolved[0].inputSchema.type).toBe('object');
  });

  test('filters out invalid and unavailable tools', () => {
    const resolved = resolveToolDefs(['exec', 'non-existent-tool', 'slack']);
    expect(resolved.length).toBe(1);
    expect(resolved.map(t => t.name)).toEqual(['exec']);
  });

  test('resolves empty array', () => {
    const resolved = resolveToolDefs([]);
    expect(resolved.length).toBe(0);
  });

  test('reports availability honestly', () => {
    expect(isToolAvailable('exec')).toBe(true);
    expect(isToolAvailable('gmail')).toBe(false);
    expect(isToolAvailable('whatsapp')).toBe(false);
  });
});
