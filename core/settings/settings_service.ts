import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { buildBrainProvider } from '../llm/providers';
import { CredentialStore } from '../secrets/credential_store';
import { EnvStore } from './env_store';
import { resolveCommand } from './which';
import {
  BRAIN_PROVIDERS,
  CREDENTIALS,
  CREDENTIALS_BY_NAME,
  CredentialSpec,
} from './provider_catalog';

const run = promisify(execFile);

/**
 * What Settings can see and change.
 *
 * One rule governs the whole file: **a stored secret never travels back to the
 * UI.** `describe()` reports that a key exists and shows its last four
 * characters, and that is all. The credential store exists precisely so that
 * plaintext keys do not sit in files or scroll past on screen; a settings
 * screen that reads them back for the sake of a populated text field would
 * undo it, and would do so invisibly.
 *
 * The last four are there because they answer the one question a masked field
 * cannot — "is this the key I think it is?" — without being enough to use.
 */
export class SettingsService {
  private readonly credentials: CredentialStore;
  private readonly env: EnvStore;

  constructor(options: { credentials?: CredentialStore; envFile?: string } = {}) {
    this.credentials = options.credentials ?? new CredentialStore();
    this.env = new EnvStore(options.envFile ?? EnvStore.defaultPath());
  }

  /** Everything the Settings screen renders. No secrets. */
  async describe(): Promise<SettingsSnapshot> {
    const stored = new Set(this.credentials.list());
    const env = this.env.read();

    const credentials = CREDENTIALS.map((spec) =>
      this.describeCredential(spec, stored, env),
    );

    return {
      credentials,
      brainProviders: BRAIN_PROVIDERS,
      brain: {
        provider: (process.env.DEX_BRAIN_PROVIDER ?? env.DEX_BRAIN_PROVIDER ?? '')
          .toLowerCase(),
        model: process.env.DEX_BRAIN_MODEL ?? env.DEX_BRAIN_MODEL ?? '',
      },
      claudeCode: await describeClaudeCode(),
      env: publicEnv(env),
      credentialStore: this.credentials.location,
      envFile: EnvStore.defaultPath(),
    };
  }

  private describeCredential(
    spec: CredentialSpec,
    stored: Set<string>,
    env: Record<string, string>,
  ): CredentialStatus {
    const inStore = stored.has(spec.name);
    const envName = spec.name.toUpperCase();
    const inEnv = !inStore && Boolean(process.env[envName] ?? env[envName]);

    return {
      ...spec,
      stored: inStore,
      fromEnvironment: inEnv,
      hint: inStore ? this.lastFour(spec.name) : undefined,
    };
  }

  /**
   * The last four characters of a stored credential.
   *
   * This is the one place that decrypts for display, and it deliberately throws
   * the rest away before returning. A decrypt that fails — the usual cause is a
   * store copied from another Windows account — is swallowed: Settings should
   * show the key as present-but-unreadable rather than refusing to render.
   */
  private lastFour(name: string): string | undefined {
    try {
      const value = this.credentials.get(name);
      if (!value || value.length < 4) return undefined;
      return value.slice(-4);
    } catch {
      return undefined;
    }
  }

  /** Store a secret. The value is never echoed back, here or anywhere. */
  setCredential(name: string, value: string): void {
    const spec = CREDENTIALS_BY_NAME.get(name);
    if (!spec) throw new Error(`Unknown credential: ${name}`);
    const trimmed = value.trim();
    if (!trimmed) throw new Error(`${spec.label} cannot be empty`);
    this.credentials.set(name, trimmed);

    // Make it usable now rather than at the next restart. buildBrainProvider
    // consults the store first, so nothing else has to be told.
    process.env[name.toUpperCase()] = trimmed;
  }

  deleteCredential(name: string): boolean {
    if (!CREDENTIALS_BY_NAME.has(name)) throw new Error(`Unknown credential: ${name}`);
    delete process.env[name.toUpperCase()];
    return this.credentials.delete(name);
  }

  /** Non-secret settings, written back into `.env` with its comments intact. */
  setEnv(changes: Record<string, string | null>): void {
    for (const key of Object.keys(changes)) {
      if (!PUBLIC_ENV_KEYS.has(key)) {
        throw new Error(`${key} is not a setting Dex will write`);
      }
    }
    this.env.update(changes);
    this.env.applyToProcess(changes);
  }

  /**
   * Make one real call and report what happened.
   *
   * A "Test" button that checks whether a string is non-empty is worse than no
   * button: it tells you the thing is fine right up until you use it. This
   * spends one cheap request and reports the latency, or the provider's own
   * error text — which is where "your credit ran out" and "that key was
   * revoked" actually live.
   */
  async test(providerId: string): Promise<ProviderTestResult> {
    const started = Date.now();
    try {
      const previous = process.env.DEX_BRAIN_PROVIDER;
      process.env.DEX_BRAIN_PROVIDER = providerId;
      try {
        const provider = buildBrainProvider(this.credentials);
        await provider.callTool({
          system: 'Reply by calling the tool. Nothing else.',
          user: 'Say ok.',
          maxTokens: 64,
          tool: {
            name: 'reply',
            description: 'Reply with one word.',
            schema: {
              type: 'object',
              properties: { word: { type: 'string' } },
              required: ['word'],
            },
          },
        });
        return {
          ok: true,
          provider: provider.label,
          latencyMs: Date.now() - started,
        };
      } finally {
        if (previous === undefined) delete process.env.DEX_BRAIN_PROVIDER;
        else process.env.DEX_BRAIN_PROVIDER = previous;
      }
    } catch (err) {
      return {
        ok: false,
        provider: providerId,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Tail one of the log files for the Logs screen. */
  readLog(name: string, lines = 400): string {
    if (!/^[a-z]{3,10}$/.test(name)) throw new Error(`Unknown log: ${name}`);
    const base =
      process.env.LOCALAPPDATA ??
      path.join(process.env.USERPROFILE ?? '.', 'AppData', 'Local');
    const file = path.join(base, 'DEX', `${name}.log`);
    if (!fs.existsSync(file)) return '';

    // Read the tail rather than the whole file: daemon.log runs to megabytes
    // after a few days and the screen shows the last few hundred lines.
    const size = fs.statSync(file).size;
    const window = Math.min(size, 256 * 1024);
    const handle = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(window);
      fs.readSync(handle, buffer, 0, window, size - window);
      const text = buffer.toString('utf8');
      return text.split(/\r?\n/).slice(-lines).join('\n');
    } finally {
      fs.closeSync(handle);
    }
  }
}

/**
 * Is Claude Code usable as the Brain on this machine?
 *
 * Two separate questions, and the card shows both because they fail
 * differently: the CLI may not be installed at all, or it may be installed and
 * not signed in. Only the second one has "run `claude` and log in" as its fix.
 *
 * `claude --version` is cheap and does not need auth, so it answers the first.
 * Sign-in state is inferred from the presence of Claude Code's own credential
 * store rather than by making a billed request — probing auth by spending a
 * token on every Settings load would be rude.
 */
export async function describeClaudeCode(): Promise<ClaudeCodeStatus> {
  const invocation = resolveCommand('claude', ['--version']);
  if (!invocation) {
    return {
      installed: false,
      signedIn: false,
      reason:
        'The Claude Code CLI is not on PATH. Install it with: npm i -g @anthropic-ai/claude-code',
    };
  }

  let version: string | undefined;
  try {
    const { stdout, stderr } = await run(invocation.file, invocation.args, {
      timeout: 8000,
      windowsHide: true,
    });
    version = (stdout.trim() || stderr.trim()).split(/\s+/)[0];
  } catch (err) {
    return {
      installed: true,
      signedIn: false,
      reason: `Claude Code was found but could not start: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  const signedIn =
    fs.existsSync(path.join(home, '.claude', '.credentials.json')) ||
    fs.existsSync(path.join(home, '.claude.json'));

  return {
    installed: true,
    version,
    signedIn,
    reason: signedIn
      ? undefined
      : 'Claude Code is installed but not signed in. Run `claude` in a terminal once and log in.',
  };
}

/**
 * Settings that live in `.env` and are safe to show.
 *
 * An allow-list, not a deny-list. `.env` may hold whatever a developer has put
 * there, including keys that predate the credential store, and a screen that
 * renders the file would put those on display. Anything not named here is not
 * shown and cannot be written.
 */
export const PUBLIC_ENV_KEYS = new Set([
  'DEX_BRAIN_PROVIDER',
  'DEX_BRAIN_MODEL',
  'DEX_OWNER_TELEGRAM',
  'DEX_OWNER_DISCORD',
  'DEX_OWNER_WHATSAPP',
  'DEX_TRIGGER_PREFIX',
  'DEX_WHATSAPP',
  'DEX_WORKSPACE_PROVIDER',
  'BROWSER_HEADLESS',
  'BROWSER_MODEL',
  'BROWSER_AGENT_PORT',
  'DESKTOP_AGENT_PORT',
  'APP_AGENT_PORT',
  'DEX_DEBUG',
]);

function publicEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of PUBLIC_ENV_KEYS) {
    const value = process.env[key] ?? env[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export interface CredentialStatus extends CredentialSpec {
  /** In the encrypted store. */
  stored: boolean;
  /** Only in the environment — works, but is not where a secret should live. */
  fromEnvironment: boolean;
  /** Last four characters, so you can tell which key it is. Never more. */
  hint?: string;
}

export interface ClaudeCodeStatus {
  installed: boolean;
  version?: string;
  signedIn: boolean;
  reason?: string;
}

export interface ProviderTestResult {
  ok: boolean;
  provider: string;
  latencyMs: number;
  error?: string;
}

export interface SettingsSnapshot {
  credentials: CredentialStatus[];
  brainProviders: typeof BRAIN_PROVIDERS;
  brain: { provider: string; model: string };
  claudeCode: ClaudeCodeStatus;
  env: Record<string, string>;
  credentialStore: string;
  envFile: string;
}
