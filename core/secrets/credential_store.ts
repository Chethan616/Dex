import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Secrets at rest, encrypted by Windows itself.
 *
 * SAFETY.md forbids secrets in config.yaml, and .env is only marginally better
 * — it is plaintext on disk and one careless `git add -f` from being published.
 * This store hands the bytes to DPAPI (`ProtectedData`, CurrentUser scope), so
 * the ciphertext is bound to this Windows account on this machine: copying the
 * file to another machine, or reading it as another user, yields nothing.
 *
 * DPAPI is reached through PowerShell rather than a native npm module on
 * purpose — no compiler toolchain, no prebuilt-binary drift across Node
 * upgrades, and nothing to audit but the script below.
 *
 * Plaintext never appears on a command line (visible in the process list) or
 * in the child's environment. It moves over stdin only.
 */

const NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

/*
 * Both scripts move base64 in and base64 out, and never let PowerShell see the
 * secret as *text*. A console's input and output encodings default to the
 * machine's OEM codepage, which quietly mangles any byte outside ASCII — a
 * passphrase with an umlaut in it would round-trip to something that no longer
 * unlocks anything. Base64 sidesteps every encoding in the pipe.
 */
const PROTECT_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$prot  = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser')
[Console]::Out.Write([Convert]::ToBase64String($prot))
`;

const UNPROTECT_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$prot  = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$bytes = [Security.Cryptography.ProtectedData]::Unprotect($prot, $null, 'CurrentUser')
[Console]::Out.Write([Convert]::ToBase64String($bytes))
`;

function encodeCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function runPowerShell(script: string, input: string): string {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodeCommand(script)],
    { input, encoding: 'utf8', windowsHide: true, timeout: 20_000 },
  );

  if (result.error) throw new Error(`DPAPI call failed: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`DPAPI call failed: ${(result.stderr || '').trim() || `exit ${result.status}`}`);
  }
  return result.stdout;
}

export class CredentialStore {
  private readonly dir: string;

  constructor(dir?: string) {
    const base =
      process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? '.', 'AppData', 'Local');
    this.dir = dir ?? path.join(base, 'DEX', 'credentials');
  }

  get location(): string {
    return this.dir;
  }

  private fileFor(name: string): string {
    if (!NAME_RE.test(name)) {
      // Names come from config and CLI arguments; a name containing a slash or
      // ".." would write outside the store.
      throw new Error(
        `Invalid credential name "${name}" — use lowercase letters, digits, _ . - (max 64)`,
      );
    }
    return path.join(this.dir, `${name}.dpapi`);
  }

  has(name: string): boolean {
    return fs.existsSync(this.fileFor(name));
  }

  set(name: string, value: string): void {
    const file = this.fileFor(name);
    fs.mkdirSync(this.dir, { recursive: true });
    const ciphertext = runPowerShell(PROTECT_SCRIPT, Buffer.from(value, 'utf8').toString('base64'));
    if (!ciphertext.trim()) throw new Error(`DPAPI returned nothing for "${name}"`);
    fs.writeFileSync(file, ciphertext.trim(), { encoding: 'utf8', mode: 0o600 });
  }

  /** Returns undefined when unset — callers decide whether that is fatal. */
  get(name: string): string | undefined {
    const file = this.fileFor(name);
    if (!fs.existsSync(file)) return undefined;
    const ciphertext = fs.readFileSync(file, 'utf8');
    try {
      const plainB64 = runPowerShell(UNPROTECT_SCRIPT, ciphertext);
      return Buffer.from(plainB64.trim(), 'base64').toString('utf8');
    } catch (err) {
      // Almost always the file was copied from another machine or account.
      throw new Error(
        `Could not decrypt credential "${name}" — it was encrypted by a different Windows ` +
          `account or machine. Re-set it with: npm run cred -- set ${name}\n${
            err instanceof Error ? err.message : String(err)
          }`,
      );
    }
  }

  delete(name: string): boolean {
    const file = this.fileFor(name);
    if (!fs.existsSync(file)) return false;
    fs.rmSync(file);
    return true;
  }

  /** Names only. There is no bulk read — nothing should ever dump every secret. */
  list(): string[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith('.dpapi'))
      .map((f) => f.slice(0, -'.dpapi'.length))
      .sort();
  }

  /**
   * Store first, environment second. The env fallback exists so a fresh
   * checkout can boot from .env, and it tells the owner to migrate — it is not
   * a supported resting place for a secret.
   */
  resolve(name: string, envVar?: string): string | undefined {
    if (this.has(name)) return this.get(name);
    const fromEnv = envVar ? process.env[envVar] : undefined;
    if (fromEnv) {
      console.warn(
        `\x1b[33m[credentials]\x1b[0m "${name}" is coming from ${envVar} in plaintext. ` +
          `Move it into the OS store: npm run cred -- set ${name}`,
      );
    }
    return fromEnv;
  }
}
