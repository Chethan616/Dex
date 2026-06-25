import { expect, test, describe } from 'vitest';
import { normalizeIntent } from '../../src/brain/intent-normalizer.js';

describe('intent normalizer', () => {
  test('strips filler words correctly', () => {
    expect(normalizeIntent('please kindly open notepad for me')).toBe('open notepad');
    expect(normalizeIntent('hey dex, can you kill chrome quickly')).toBe('kill chrome');
    expect(normalizeIntent('i want you to check updates')).toBe('check updates');
  });

  test('resolves app aliases correctly', () => {
    expect(normalizeIntent('open Word')).toBe('open winword');
    expect(normalizeIntent('open Excel')).toBe('open excel');
    expect(normalizeIntent('open paint')).toBe('open mspaint');
    expect(normalizeIntent('open terminal')).toBe('open wt');
    expect(normalizeIntent('open vs code')).toBe('open code');
  });

  test('resolves number words and percents correctly', () => {
    expect(normalizeIntent('set volume to seventy percent')).toBe('set volume to 70%');
    expect(normalizeIntent('ping google.com five times')).toBe('ping google.com 5 times');
    expect(normalizeIntent('set volume to zero')).toBe('set volume to 0');
  });

  test('collapses double spaces and normalizes quotes', () => {
    expect(normalizeIntent('open  notepad  "file.txt"')).toBe('open notepad "file.txt"');
  });
});
