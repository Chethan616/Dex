/**
 * Syntax colours (src/renderer/hub/workspace/docs/highlight.ts): the text
 * comes back whole, coloured where DEX knows the language.
 */
import { describe, expect, it } from 'vitest';
import { MAX_HIGHLIGHT_CHARS, tokenize } from '../../../src/renderer/hub/workspace/docs/highlight';

const kinds = (text: string, name: string): Array<[string | null, string]> =>
  tokenize(text, name).filter((t) => t.text.trim()).map((t) => [t.kind, t.text.trim()]);

describe('syntax colours', () => {
  it('never loses or changes a character', () => {
    for (const [text, name] of [
      ['const x = "a\\"b"; // done\n/* c */ f(1.5e3)', 'a.ts'],
      ['def f(x):\n    return f"{x}" # hi', 'a.py'],
      ['{"a": [1, true, null], "b": "c"}', 'a.json'],
      ['<div class="x"><!-- c --></div>', 'a.html'],
      ['echo "$HOME" ${PATH} # c', 'a.sh'],
      ['$x = Get-Item -Path "C:\\" # c', 'a.ps1'],
      ['unterminated "string and `template', 'a.js'],
    ]) {
      expect(tokenize(text, name).map((t) => t.text).join('')).toBe(text);
    }
  });

  it('colours keywords, strings, comments, numbers and calls', () => {
    expect(kinds('const x = "hi"; // note\nfoo(42)', 'a.ts')).toEqual([
      ['k', 'const'], [null, 'x ='], ['s', '"hi"'], [null, ';'], ['c', '// note'], ['p', 'foo'], [null, '('], ['n', '42'], [null, ')'],
    ]);
  });

  it('tells JSON keys from values, and HTML tags from attributes', () => {
    expect(kinds('{"name": "dex", "on": true}', 'x.json')).toEqual([
      [null, '{'], ['p', '"name"'], [null, ':'], ['s', '"dex"'], [null, ','], ['p', '"on"'], [null, ':'], ['k', 'true'], [null, '}'],
    ]);
    expect(kinds('<a href="/x">go</a>', 'x.html')).toEqual([['t', '<a'], ['a', 'href'], [null, '='], ['s', '"/x"'], ['t', '>'], [null, 'go'], ['t', '</a>']]);
  });

  it('leaves unknown files and huge ones plain', () => {
    expect(tokenize('const x = 1', 'notes.txt')).toEqual([{ kind: null, text: 'const x = 1' }]);
    const big = 'a'.repeat(MAX_HIGHLIGHT_CHARS + 1);
    expect(tokenize(big, 'a.ts')).toHaveLength(1);
  });
});
