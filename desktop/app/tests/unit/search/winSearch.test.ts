/**
 * The pure halves of the Windows Search backend: building the query (which
 * embeds user-supplied terms, so quoting is a correctness *and* injection
 * concern) and parsing PowerShell's JSON back into SearchCandidates.
 *
 * The quoting rules here are not guesses — each was verified against the
 * live provider, which rejects the wrong form outright with
 * DB_E_ERRORSINCOMMAND rather than silently misbehaving.
 *
 * The spawn itself isn't exercised: it needs a real Windows Search service,
 * and the whole point of the design is that it is an opaque out-of-process
 * call. What must be right in-process is the string going out and the
 * parsing coming back.
 */
import { describe, expect, it } from 'vitest';
import { buildQuery, buildScript, parseRows } from '../../../src/main/search/winSearch';

describe('buildQuery', () => {
  it('returns null when there is nothing searchable', () => {
    expect(buildQuery([], 10)).toBeNull();
    expect(buildQuery(['   '], 10)).toBeNull();
  });

  it('searches both file contents and file names for each term', () => {
    const sql = buildQuery(['syllabus'], 10)!;
    // Single quotes are this dialect's string delimiter — double quotes are
    // a syntax error against the live provider.
    expect(sql).toContain("CONTAINS(System.Search.Contents, 'syllabus')");
    expect(sql).toContain("CONTAINS(System.ItemNameDisplay, 'syllabus')");
  });

  it('ORs multiple terms so any one of them can produce a candidate', () => {
    const sql = buildQuery(['da', 'assessment'], 10)!;
    expect(sql).toContain("'da'");
    expect(sql).toContain("'assessment'");
    expect(sql).toContain(' OR ');
  });

  it('wraps a multi-word term as a phrase, since bare whitespace parses as boolean operators', () => {
    // Verified: an unquoted multi-word term is a syntax error against the
    // live provider; a phrase-quoted one is accepted.
    const sql = buildQuery(['cryptography and network security'], 10)!;
    expect(sql).toContain(`'"cryptography and network security"'`);
  });

  it('leaves a single-word term unquoted inside the string literal', () => {
    expect(buildQuery(['syllabus'], 10)!).not.toContain('"syllabus"');
  });

  it('escapes an embedded single quote by doubling it rather than closing the literal', () => {
    expect(buildQuery(["o'brien"], 10)!).toContain("'o''brien'");
  });

  it('neutralises a term that tries to break out of the predicate', () => {
    const sql = buildQuery(["x') OR 1=1 --"], 10)!;
    // The injected single quote is doubled, so the payload stays inside one
    // string literal instead of becoming syntax.
    expect(sql).toContain("''");
    expect(sql).not.toMatch(/CONTAINS\(System\.Search\.Contents, 'x'\) OR 1=1/);
  });

  it('strips backslashes and control characters instead of passing them through', () => {
    const sql = buildQuery(['a\\b'], 10)!;
    expect(sql).not.toContain('a\\b');
    expect(buildQuery(['we\u0000ird'], 10)!).toContain("'weird'");
  });

  it('always bounds the result count, even for an absurd cap', () => {
    expect(buildQuery(['x'], 100000)!).toContain('SELECT TOP 500');
    expect(buildQuery(['x'], 0)!).toContain('SELECT TOP 1');
  });

  it('excludes folders so only real files become candidates', () => {
    expect(buildQuery(['x'], 10)!).toContain("System.Kind <> 'folder'");
  });
});

describe('buildScript', () => {
  it('writes results to the given path rather than stdout', () => {
    // stdout truncated a large result set mid-string at ~16 KB, which is
    // why this writes a file instead.
    const script = buildScript('C:\\temp\\out.json');
    expect(script).toContain("[IO.File]::WriteAllText('C:\\temp\\out.json'");
    // The JSON must be captured into a variable and written, never left to
    // fall out of the pipeline onto stdout.
    expect(script).toContain('$json = $rows | ConvertTo-Json');
  });

  it('escapes a single quote in the output path so it cannot break the script', () => {
    expect(buildScript("C:\\o'dir\\out.json")).toContain("'C:\\o''dir\\out.json'");
  });

  it('caps the per-row snippet, since one oversized value broke the whole response', () => {
    expect(buildScript('C:\\t.json', 1234)).toContain('$c.Length -gt 1234');
    expect(buildScript('C:\\t.json', 1234)).toContain('$c.Substring(0, 1234)');
  });

  it('writes the error branch to the same file so a failure is never silent', () => {
    const script = buildScript('C:\\t.json');
    expect(script).toContain('__error');
    expect(script.match(/WriteAllText/g)?.length).toBe(2);
  });
});

describe('parseRows', () => {
  const row = {
    path: 'C:\\docs\\syllabus.pdf',
    name: 'syllabus.pdf',
    size: 2048,
    mtime: '/Date(1699500874000)/',
    content: 'cryptography and network security',
  };

  it('returns nothing for empty output rather than throwing', () => {
    expect(parseRows('')).toEqual({ rows: [] });
    expect(parseRows('   ')).toEqual({ rows: [] });
  });

  it('maps a row onto the SearchCandidate shape the ranker expects', () => {
    const { rows } = parseRows(JSON.stringify([row]));
    expect(rows).toEqual([{
      path: 'C:\\docs\\syllabus.pdf',
      name: 'syllabus.pdf',
      content: 'cryptography and network security',
      size: 2048,
      mtime: 1699500874000,
    }]);
  });

  it('accepts a bare object, which is what PowerShell emits for a single result', () => {
    const { rows } = parseRows(JSON.stringify(row));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('syllabus.pdf');
  });

  it('parses an ISO date as well as the .NET /Date(...)/ form', () => {
    const { rows } = parseRows(JSON.stringify([{ ...row, mtime: '2023-11-09T04:54:34.000Z' }]));
    expect(rows[0].mtime).toBe(Date.parse('2023-11-09T04:54:34.000Z'));
  });

  it('falls back to 0 for an unparseable date instead of NaN', () => {
    const { rows } = parseRows(JSON.stringify([{ ...row, mtime: 'not a date' }]));
    expect(rows[0].mtime).toBe(0);
  });

  it('derives a name from the path when the name column came back empty', () => {
    const { rows } = parseRows(JSON.stringify([{ ...row, name: null }]));
    expect(rows[0].name).toBe('syllabus.pdf');
  });

  it('tolerates a null content column (no snippet available for that file)', () => {
    const { rows } = parseRows(JSON.stringify([{ ...row, content: null }]));
    expect(rows[0].content).toBe('');
  });

  it('skips rows with no path rather than emitting a useless candidate', () => {
    const { rows } = parseRows(JSON.stringify([{ ...row, path: null }, row]));
    expect(rows).toHaveLength(1);
  });

  it('surfaces an error object from the script as an error, not as results', () => {
    const { rows, error } = parseRows(JSON.stringify({ __error: 'provider not registered' }));
    expect(rows).toEqual([]);
    expect(error).toBe('provider not registered');
  });

  it('reports unparseable output as an error rather than throwing', () => {
    const { rows, error } = parseRows('this is not json');
    expect(rows).toEqual([]);
    expect(error).toMatch(/could not parse/i);
  });
});
