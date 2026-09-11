import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const helpers = require('../../../src/main/hl/stock/helpers.js') as {
  browserHarnessCommand: () => string;
  connectSnippet: string;
};

describe('stock helpers browser-harness-js bridge', () => {
  test('points legacy helpers readers at the vendored browser-harness-js CLI', () => {
    // The path is built with path.join, so on Windows it is backslash
    // separated — a regex hardcoding forward slashes failed a function that
    // was producing exactly the right value for the platform it runs on.
    const tail = path.join('browser-harness-js', 'sdk', 'browser-harness-js');
    expect(helpers.browserHarnessCommand().endsWith(tail)).toBe(true);
    expect(helpers.connectSnippet).toBe('await connectToAssignedTarget()');
  });
});
