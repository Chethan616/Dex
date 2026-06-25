import { expect, test, describe } from 'vitest';
import { compressResult, outlineJson, extractKeywords } from '../../src/tools/result-compressor.js';

describe('result compressor', () => {
  test('extractKeywords filters stop words', () => {
    const kw = extractKeywords('please run git status for me on the codebase');
    expect(kw).toContain('git');
    expect(kw).toContain('status');
    expect(kw).toContain('codebase');
    expect(kw).not.toContain('please');
    expect(kw).not.toContain('run');
    expect(kw).not.toContain('for');
  });

  test('outlineJson truncates and simplifies complex json', () => {
    const rawObj = {
      id: 'element-1',
      screenshot: 'base64-extremely-long-string-representing-image-data-that-should-be-omitted',
      coords: [100, 200, 300, 400],
      attributes: {
        visible: true,
        text: 'Click here to save the changes to the system database'
      },
      list: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    };

    const outline = outlineJson(rawObj);
    expect(outline).toContain('element-1');
    expect(outline).not.toContain('screenshot'); // omitted heavy field
    expect(outline).toContain('5 more items'); // list truncated
  });

  test('compressResult returns short output as is', () => {
    const short = 'hello world';
    expect(compressResult(short)).toBe(short);
  });

  test('compressResult parses and outlines JSON output', () => {
    const jsonStr = JSON.stringify({
      status: 'success',
      screenshot: 'image-data',
      data: { count: 42 }
    });
    const compressed = compressResult(jsonStr);
    expect(compressed).toContain('success');
    expect(compressed).toContain('count');
    expect(compressed).not.toContain('screenshot');
  });

  test('compressResult handles exec outputs by preserving errors and final lines', () => {
    const mockOutputLines = [
      'Initializing process...',
      'Step 1: Check environment',
      'Step 2: Connect database',
      'Error: Database connection failed due to credentials exception',
      ...Array.from({ length: 30 }, (_, i) => `Loading asset row-${i}...`),
      'Step 3: Post-processing',
      'Step 4: Cleanup active sessions',
      'Process execution finished with status code 1',
      'Telemetry recorded',
      'Done'
    ];
    const output = mockOutputLines.join('\n');
    const compressed = compressResult(output, 'exec');

    expect(compressed).toContain('Error: Database connection failed');
    expect(compressed).toContain('Process execution finished');
    expect(compressed).toContain('Done');
    expect(compressed).toContain('[Output truncated. Kept 1 error lines and 5 final lines]');
    // Verify it doesn't contain the asset loading rows (or at least most of them)
    expect(compressed).not.toContain('Loading asset row-15...');
  });

  test('compressResult scores lines by keyword density when intent is provided', () => {
    const mockOutputLines = [
      'Line 1: starting build pipeline',
      'Line 2: compiling source files',
      'Line 3: error compiling compiler-core.ts file missing key declaration',
      'Line 4: unit test run succeeded',
      'Line 5: summary of results: all tests passed',
      ...Array.from({ length: 20 }, (_, i) => `Noise line item ${i}`)
    ];
    const output = mockOutputLines.join('\n');
    const compressed = compressResult(output, undefined, 'fix compiling missing error');

    expect(compressed).toContain('Line 3: error compiling compiler-core.ts file missing key declaration');
    expect(compressed).toContain('[Output truncated. Showing top');
  });

  test('compressResult falls back to first 5 and last 5 lines for long output without matches', () => {
    const mockOutputLines = Array.from({ length: 50 }, (_, i) => `Generic line number ${i + 1}`);
    const output = mockOutputLines.join('\n');
    const compressed = compressResult(output);

    expect(compressed).toContain('Generic line number 1');
    expect(compressed).toContain('Generic line number 5');
    expect(compressed).toContain('Generic line number 46');
    expect(compressed).toContain('Generic line number 50');
    expect(compressed).not.toContain('Generic line number 10');
  });
});
