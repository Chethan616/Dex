import { expect, test, describe } from 'vitest';
import {
  TIER1_ACTION_SCHEMA,
  TIER2_PLAN_SCHEMA,
  ALL_TOOLS,
  buildTier1ActionSchema,
  buildTier2PlanSchema,
} from '../../src/llm/output-schema.js';

describe('output schema configuration', () => {
  test('schemas have valid structural definitions', () => {
    expect(TIER1_ACTION_SCHEMA.type).toBe('object');
    expect(TIER1_ACTION_SCHEMA.required).toContain('t');
    expect(TIER1_ACTION_SCHEMA.required).toContain('a');
    expect(TIER1_ACTION_SCHEMA.properties.t.enum).toEqual(ALL_TOOLS);

    expect(TIER2_PLAN_SCHEMA.type).toBe('object');
    expect(TIER2_PLAN_SCHEMA.required).toContain('steps');
    expect(TIER2_PLAN_SCHEMA.properties.steps.type).toBe('array');
  });

  test('builds query-specific schemas from the real tool subset', () => {
    const tier1 = buildTier1ActionSchema(['exec', 'browser']);
    expect(tier1.properties.t.enum).toEqual(['exec', 'browser']);
    expect(tier1.properties.fb.enum).toEqual(['exec', 'browser']);

    const tier2 = buildTier2PlanSchema(['desktop']);
    expect(tier2.properties.steps.items.properties.t.enum).toEqual(['desktop']);
  });
});
