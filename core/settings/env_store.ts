import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Reads and writes `.env` without destroying it.
 *
 * The obvious implementation — parse to an object, write the object back — is
 * wrong here. `.env.example` is heavily commented, and those comments are the
 * only documentation for several settings: why `BROWSER_HEADLESS` should stay
 * false, why owner ids live in the file while tokens do not, what the trigger
 * prefix is for. A round-trip through a plain map throws all of that away the
 * first time someone changes a checkbox in Settings.
 *
 * So this edits in place: an existing key keeps its line and its position, and
 * only the value after the `=` changes. New keys are appended under a heading
 * so a file edited by the app still reads like one a person wrote.
 *
 * Secrets do not belong here and are not written here — see
 * core/secrets/credential_store.ts. The one exception the file itself
 * documents is owner ids, which are usernames rather than secrets.
 */
export class EnvStore {
  constructor(private readonly file: string) {}

  static defaultPath(): string {
    return path.join(process.cwd(), '.env');
  }

  exists(): boolean {
    return fs.existsSync(this.file);
  }

  /** Every key currently in the file. Comments and blank lines are ignored. */
  read(): Record<string, string> {
    if (!this.exists()) return {};
    const out: Record<string, string> = {};
    for (const line of fs.readFileSync(this.file, 'utf8').split(/\r?\n/)) {
      const parsed = parseLine(line);
      if (parsed) out[parsed.key] = parsed.value;
    }
    return out;
  }

  get(key: string): string | undefined {
    return this.read()[key];
  }

  /**
   * Apply a set of changes.
   *
   * A value of `null` removes the key rather than setting it empty — for a
   * boolean-ish setting those are the same thing, but for `DEX_BRAIN_MODEL` an
   * empty string overrides the built-in default with nothing, which is not what
   * "clear this" should mean.
   *
   * Written to a temporary file and renamed, so an interrupted write cannot
   * leave a half-truncated `.env` behind — which would take the model key with
   * it and leave Dex unable to start.
   */
  update(changes: Record<string, string | null>): void {
    const pending = new Map(Object.entries(changes));
    const original = this.exists()
      ? fs.readFileSync(this.file, 'utf8')
      : '';
    const newline = original.includes('\r\n') ? '\r\n' : os.EOL;
    const lines = original.length > 0 ? original.split(/\r?\n/) : [];

    const kept: string[] = [];
    for (const line of lines) {
      const parsed = parseLine(line);
      if (!parsed || !pending.has(parsed.key)) {
        kept.push(line);
        continue;
      }

      const value = pending.get(parsed.key)!;
      pending.delete(parsed.key);

      if (value === null) {
        // Deliberately not deleted: the line, and the comment block above it,
        // is documentation. Emptying it restores the built-in default while
        // leaving the explanation in place.
        kept.push(`${parsed.key}=`);
      } else {
        kept.push(`${parsed.key}=${quoteIfNeeded(value)}`);
      }
    }

    const additions = [...pending.entries()].filter(([, v]) => v !== null);
    if (additions.length > 0) {
      if (kept.length > 0 && kept[kept.length - 1].trim() !== '') kept.push('');
      kept.push('# Added by Dex Settings');
      for (const [key, value] of additions) {
        kept.push(`${key}=${quoteIfNeeded(value!)}`);
      }
    }

    if (kept.length === 0 || kept[kept.length - 1].trim() !== '') kept.push('');

    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, kept.join(newline), { encoding: 'utf8' });
    fs.renameSync(temp, this.file);
  }

  /**
   * Mirror a change into this process, so a setting takes effect without a
   * restart wherever the code reads `process.env` at use time.
   *
   * Not everything can be applied live — a port a server is already listening
   * on, for instance — and the caller is expected to say which of those need a
   * restart. This just keeps the two views from disagreeing.
   */
  applyToProcess(changes: Record<string, string | null>): void {
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') delete process.env[key];
      else process.env[key] = value;
    }
  }
}

interface ParsedLine {
  key: string;
  value: string;
}

function parseLine(line: string): ParsedLine | null {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;

  const eq = trimmed.indexOf('=');
  if (eq <= 0) return null;

  const key = trimmed.slice(0, eq).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  let value = trimmed.slice(eq + 1).trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

/**
 * Quote only when the value would not survive a round trip otherwise.
 *
 * Quoting everything would work but makes the file worse to read by hand, and
 * this file is read by hand constantly.
 */
function quoteIfNeeded(value: string): string {
  if (value === '') return '';
  if (/^[A-Za-z0-9_./:\\@+-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}
