import { expect, test, describe } from 'vitest';
import { TIER1_ACTION_SCHEMA, TIER2_PLAN_SCHEMA, ALL_TOOLS } from '../../src/llm/output-schema.js';

describe('output schema configuration', () => {
  test('schemas have valid structural definitions', () => {
    expect(TIER1_ACTION_SCHEMA.type).toBe('object');
    expect(TIER1_ACTION_SCHEMA.required).toContain('t');
    expect(TIER1_ACTION_SCHEMA.required).toContain('a');
    expect(TIER1_ACTION_SCHEMA.properties.t.enum).toBe(ALL_TOOLS);

    expect(TIER2_PLAN_SCHEMA.type).toBe('object');
    expect(TIER2_PLAN_SCHEMA.required).toContain('steps');
    expect(TIER2_PLAN_SCHEMA.properties.steps.type).toBe('array');
  });
});
