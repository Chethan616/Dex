import { expect, test, describe } from 'vitest';
import { parseIntent } from '../../src/brain/intent-analyzer.js';
import { classifyTier } from '../../src/brain/tier-classifier.js';

describe('tier classifier', () => {
  test('classifies Tier 0 deterministic match correctly', () => {
    const intent = parseIntent('please kindly open notepad for me');
    const classified = classifyTier(intent);
    expect(classified.tier).toBe(0);
  });

  test('classifies Tier 0.5 parametric match correctly', () => {
    const intent = parseIntent('set brightness to 50 percent');
    const classified = classifyTier(intent);
    expect(classified.tier).toBe(0.5);
  });

  test('classifies Tier 1 flash match correctly', () => {
    const intent = parseIntent('change standard keyboard layout to spanish');
    const classified = classifyTier(intent);
    expect(classified.tier).toBe(1);
  });

  test('classifies Tier 2 reasoning match correctly based on keywords', () => {
    const intent = parseIntent('plan a weekly backup script and summarize errors');
    const classified = classifyTier(intent);
    expect(classified.tier).toBe(2);
  });

  test('classifies compound intents correctly', () => {
    const intent = parseIntent('open notepad and then kill chrome and write text hello to file output.txt');
    const classified = classifyTier(intent);
    expect(classified.kind).toBe('compound');
    expect(classified.tier).toBe(0.5); // max of 0, 0.5, 0.5 is 0.5
    expect(classified.subIntents).toBeDefined();
    expect(classified.subIntents?.[0].tier).toBe(0);
    expect(classified.subIntents?.[1].tier).toBe(0.5);
    expect(classified.subIntents?.[2].tier).toBe(0.5);
  });
});
