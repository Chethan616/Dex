import { describe, expect, it } from 'vitest';
import { displayAddress, normalizeAddress, searchUrl } from '../../../src/shared/address';

describe('normalizeAddress', () => {
  it('opens things that look like addresses', () => {
    expect(normalizeAddress('github.com')).toBe('https://github.com/');
    expect(normalizeAddress('  vtop.vit.ac.in/vtop/open/page ')).toBe('https://vtop.vit.ac.in/vtop/open/page');
    expect(normalizeAddress('https://example.com/a?b=1#c')).toBe('https://example.com/a?b=1#c');
    expect(normalizeAddress('localhost:5173/x')).toBe('http://localhost:5173/x');
    expect(normalizeAddress('192.168.1.4')).toBe('http://192.168.1.4/');
    expect(normalizeAddress('about:blank')).toBe('about:blank');
  });

  it('searches for words', () => {
    expect(normalizeAddress('vit library proxy')).toBe(searchUrl('vit library proxy'));
    expect(normalizeAddress('resnet')).toBe(searchUrl('resnet'));
    expect(normalizeAddress('what is 2+2?')).toBe(searchUrl('what is 2+2?'));
  });

  it('never opens script, data or file URLs from the address bar', () => {
    expect(normalizeAddress('javascript:alert(1)')).toBe(searchUrl('javascript:alert(1)'));
    expect(normalizeAddress('data:text/html,<b>x</b>')).toBe(searchUrl('data:text/html,<b>x</b>'));
    expect(normalizeAddress('file:///C:/Windows/win.ini')).toBe(searchUrl('file:///C:/Windows/win.ini'));
  });

  it('ignores empty input', () => {
    expect(normalizeAddress('   ')).toBeNull();
  });
});

describe('displayAddress', () => {
  it('drops the scheme and a bare slash', () => {
    expect(displayAddress('https://github.com/')).toBe('github.com');
    expect(displayAddress('https://github.com/a/b?c=1')).toBe('github.com/a/b?c=1');
    expect(displayAddress('about:blank')).toBe('');
  });
});
