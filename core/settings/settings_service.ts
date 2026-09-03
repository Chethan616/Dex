import * as net from 'net';
import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { buildBrainProvider } from '../llm/providers';
import { CredentialStore } from '../secrets/credential_store';
import { EnvStore } from './env_store';
import { resolveCommand } from './which';
import {
  BRAIN_PROVIDERS,
  CLAUDE_MODELS,
  CREDENTIALS,
  CREDENTIALS_BY_NAME,
  CredentialSpec,
} from './provider_catalog';
import { DexConfig, readConfig, updateConfig } from './config_store';

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
    const config = readConfig();

    const credentials = CREDENTIALS.map((spec) =>
      this.describeCredential(spec, stored, env),
    );
    // The provider that will actually answer, not merely the one written down.
    // With nothing chosen, Dex falls back to whichever key is stored, and a
    // screen reporting "none" beside a core that is planning fine is a lie the
    // owner cannot see through.
    const provider = effectiveBrainProvider(this.credentials);
    const model = config.brainModel ||
      BRAIN_PROVIDERS.find((candidate) => candidate.id === provider)?.defaultModel ||
      '';

    return {
      credentials,
      brainProviders: BRAIN_PROVIDERS,
      claudeModels: CLAUDE_MODELS,
      config,
      brain: {
        provider,
        model,
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

  /**
   * Forget a secret.
   *
   * Needed because unpairing a channel has to actually remove the token, not
   * merely stop using it. A token left in the credential store is a token that
   * comes back the next time something reads it, and the owner who pressed
   * disconnect would have no way of knowing.
   */
  clearCredential(name: string): boolean {
    return this.credentials.delete(name);
  }

  /** Store a secret. The value is never echoed back, here or anywhere. */
  setCredential(name: string, value: string): void {
    const trimmed = value.trim();
    if (!trimmed) throw new Error('A credential cannot be empty');

    // A site sign-in, rather than one of the provider keys in the catalogue.
    //
    // The catalogue is a fixed list because a typo'd `grok_api_key` should be
    // refused rather than silently stored and never read. But site credentials
    // are named after whatever host the owner has an account on, so there is no
    // list to be on — the Settings card that stores them called this method and
    // got "Unknown credential: site.vtop.vit.ac.in", which is why signing in to
    // the portal then reported no saved credential. Nothing had ever been
    // stored.
    //
    // Validated as a hostname instead, so the name is still checked; it just is
    // not checked against a list it could never be on.
    if (isSiteCredential(name)) {
      this.credentials.set(name, trimmed);
      // Deliberately NOT mirrored into process.env, unlike a provider key. A
      // site password has no business in the environment, where it would be
      // inherited by every child process Dex spawns.
      return;
    }

    const spec = CREDENTIALS_BY_NAME.get(name);
    if (!spec) throw new Error(`Unknown credential: ${name}`);
    this.credentials.set(name, trimmed);

    // Make it usable now rather than at the next restart. buildBrainProvider
    // consults the store first, so nothing else has to be told.
    process.env[name.toUpperCase()] = trimmed;
  }

  deleteCredential(name: string): boolean {
    if (isSiteCredential(name)) return this.credentials.delete(name);
    if (!CREDENTIALS_BY_NAME.has(name)) throw new Error(`Unknown credential: ${name}`);
    delete process.env[name.toUpperCase()];
    return this.credentials.delete(name);
  }

  /** Choose the brain. Refuses a provider that cannot answer. */
  setBrain(provider: string, model: string): { ok: boolean; reason?: string } {
    return setBrain(provider, model, this.credentials);
  }

  /** Non-secret settings, in Dex's own settings.json. */
  setConfig(changes: Record<string, unknown>): DexConfig {
    const allowed: (keyof DexConfig)[] = [
      'brainProvider', 'brainModel', 'browserAgent', 'desktopAgent',
      'telegramOwner', 'discordOwner', 'whatsappOwner', 'whatsappEnabled',
      'browserHeadless', 'theme',
    ];
    const clean: Partial<DexConfig> = {};
    for (const [key, value] of Object.entries(changes)) {
      if (!allowed.includes(key as keyof DexConfig)) {
        throw new Error(`${key} is not a Dex setting`);
      }
      (clean as Record<string, unknown>)[key] = value;
    }
    return updateConfig(clean);
  }

  /**
   * Sign in to Claude Code from the app.
   *
   * `claude setup-token` opens the browser flow and prints a token. It is
   * launched detached rather than captured: the flow is interactive and can
   * take a minute, and holding the WebSocket open on it would look like Dex
   * had frozen. The card polls `describe` afterwards and turns green when the
   * credential file appears — the same check the status uses, so there is one
   * definition of "signed in".
   */
  async startClaudeSignIn(): Promise<{ started: boolean; reason?: string }> {
    const invocation = resolveCommand('claude', ['setup-token']);
    if (!invocation) {
      return {
        started: false,
        reason: 'The Claude Code CLI is not installed. Install it with: npm i -g @anthropic-ai/claude-code',
      };
    }

    try {
      const child = spawn(invocation.file, invocation.args, {
        detached: true,
        stdio: 'ignore',
        // Deliberately NOT windowsHide. This is the one place a console is
        // wanted: `setup-token` is interactive and prints a URL and a prompt.
        // Hiding it would leave the owner waiting on a window that never came.
        windowsHide: false,
      });
      child.unref();
      return { started: true };
    } catch (err) {
      return {
        started: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
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

  /**
   * Which parts of Dex are actually alive right now.
   *
   * Probed, not assumed. The Connectors screen used to list twenty
   * integrations — Slack, Signal, iMessage, Teams — that this Dex has never
   * had, each with an Install button wired to a gateway that no longer exists.
   * A capability list that cannot be checked is a brochure; this one asks.
   */
  async health(): Promise<CapabilityHealth[]> {
    const stored = new Set(this.credentials.list());
    const config = readConfig();

    const [browser, appAgent, vision] = await Promise.all([
      probePort(Number(process.env.BROWSER_AGENT_PORT ?? 8766)),
      probePort(Number(process.env.APP_AGENT_PORT ?? 8767)),
      probePort(Number(process.env.DESKTOP_AGENT_PORT ?? 8765)),
    ]);

    const daemon = await probePipe('dex_privileged_daemon');

    return [
      {
        id: 'os', name: 'Windows control', group: 'built in',
        detail: 'Volume, DNS, Wi-Fi, power, display, brightness, processes, registry, apps',
        ok: daemon,
        reason: daemon ? undefined : 'The privileged daemon is not running.',
      },
      {
        id: 'commands', name: 'Commands', group: 'built in',
        detail: 'git, npm, compilers, rg, netstat, PowerShell — classified before they run',
        ok: daemon,
        reason: daemon ? undefined : 'Runs through the daemon, which is not running.',
      },
      {
        id: 'files', name: 'Files', group: 'built in',
        detail: 'Read, write, search, copy, rename, hash, download — inside your profile',
        ok: true,
      },
      {
        id: 'apps', name: 'Application control', group: 'agents',
        detail: 'Drives apps by control name through UI Automation. No screenshots',
        ok: appAgent,
        reason: appAgent ? undefined : 'The app agent is not running.',
      },
      {
        id: 'web', name: 'Browser', group: 'agents',
        detail: 'Navigates, reads pages, fills forms, screenshots',
        ok: browser,
        reason: browser ? undefined : 'The browser agent is not running.',
      },
      {
        id: 'vision', name: 'Vision', group: 'agents',
        detail: 'Reads the screen when an app exposes no controls. Last resort',
        ok: vision,
        reason: vision
          ? undefined
          : 'Not running. It needs an Anthropic API key for its worker loop.',
      },
      {
        id: 'telegram', name: 'Telegram', group: 'chat',
        detail: 'Send Dex tasks from your phone, and receive files back',
        ok: stored.has('telegram_bot_token') && Boolean(config.telegramOwner),
        reason: !stored.has('telegram_bot_token')
          ? 'Add a bot token in Intelligence.'
          : !config.telegramOwner
            ? 'Set your Telegram user id, or the bot refuses everyone.'
            : undefined,
      },
      {
        id: 'discord', name: 'Discord', group: 'chat',
        detail: 'Same, through a Discord bot',
        ok: stored.has('discord_bot_token') && Boolean(config.discordOwner),
        reason: !stored.has('discord_bot_token')
          ? 'Add a bot token in Intelligence.'
          : !config.discordOwner
            ? 'Set your Discord user id.'
            : undefined,
      },
      {
        id: 'whatsapp', name: 'WhatsApp', group: 'chat',
        detail: 'Pairs by QR. Unofficial client — accounts using it can be banned',
        ok: config.whatsappEnabled && Boolean(config.whatsappOwner),
        reason: config.whatsappEnabled
          ? (config.whatsappOwner ? undefined : 'Set your WhatsApp number.')
          : 'Off by default. Turn it on only if you accept the ban risk.',
      },
      {
        id: 'workspace', name: 'Email, calendar and files', group: 'accounts',
        detail: 'Gmail, Calendar and Drive — or the Microsoft 365 equivalents',
        ok: stored.has('google_oauth_client_id') || stored.has('ms365_client_id'),
        reason: 'Add Google or Microsoft credentials in Intelligence.',
      },
    ];
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
  claudeModels: typeof CLAUDE_MODELS;
  config: DexConfig;
  brain: { provider: string; model: string };
  claudeCode: ClaudeCodeStatus;
  env: Record<string, string>;
  credentialStore: string;
  envFile: string;
}

/**
 * Which provider will actually answer, not merely which one is configured.
 *
 * `buildBrainProvider` falls back through the stored keys when nothing is
 * chosen, so an unset configuration still plans — on Groq, usually. Reporting
 * the configured value in that case shows "none selected" on a Settings screen
 * belonging to a Dex that is planning perfectly well, and the owner has no way
 * to tell which is true. This mirrors the fallback so the screen agrees with
 * the behaviour.
 */
export function effectiveBrainProvider(credentials: CredentialStore): string {
  const config = readConfig();
  const chosen = (config.brainProvider || process.env.DEX_BRAIN_PROVIDER || '').toLowerCase();
  if (chosen) return chosen;

  if (credentials.has('groq_api_key') || process.env.GROQ_API_KEY) return 'groq';
  if (credentials.has('anthropic_api_key') || process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return '';
}

/**
 * Is Claude Code signed in, and what would it cost to fix if not?
 *
 * Split from describeClaudeCode's boolean so the app can offer the right
 * action: a missing CLI needs an install, a signed-out one needs `claude` run
 * once in a terminal. They are different problems with different fixes and the
 * card says which.
 */
export async function claudeSignIn(): Promise<ClaudeCodeStatus> {
  return describeClaudeCode();
}

/** Change the brain, and say whether it will actually work. */
export function setBrain(
  provider: string,
  model: string,
  credentials: CredentialStore,
): { ok: boolean; reason?: string } {
  const spec = BRAIN_PROVIDERS.find((p) => p.id === provider);
  if (!spec) return { ok: false, reason: `Unknown provider: ${provider}` };

  // Refuse a provider that cannot possibly answer, rather than accepting the
  // choice and failing on the owner's next request. The failure would arrive
  // one screen away from the setting that caused it.
  if (spec.credential && !credentials.has(spec.credential) && !process.env[spec.credential.toUpperCase()]) {
    return {
      ok: false,
      reason: `${spec.label} needs its API key first — add it above, then select it.`,
    };
  }

  updateConfig({ brainProvider: provider, brainModel: model });
  return { ok: true };
}

export interface CapabilityHealth {
  id: string;
  name: string;
  /** `built in`, `agents`, `chat`, `accounts` — for grouping on screen. */
  group: string;
  detail: string;
  ok: boolean;
  /** What to do about it, when it is not ok. */
  reason?: string;
}

/** Is something listening? A connect and an immediate close, nothing more. */
function probePort(port: number, timeout = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (result: boolean): void => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, '127.0.0.1');
  });
}

/**
 * Is the daemon serving its pipe?
 *
 * Read from the pipe namespace rather than by connecting. The daemon serves a
 * fixed number of instances and a probe that opened one would consume it —
 * a health check that degrades the thing it checks is worse than none.
 */
async function probePipe(name: string): Promise<boolean> {
  try {
    return fs
      // '\\\\.\\pipe\\' — the pipe namespace. Not String.raw: its closing
      // backtick would be escaped by the trailing backslash this path needs.
      .readdirSync('\\\\.\\pipe\\')
      .some((entry) => entry.toLowerCase() === name.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * `site.vtop.vit.ac.in` — a sign-in for one host.
 *
 * Deliberately strict about the shape. The name becomes a filename in the
 * credential store, and it is also the key `sign_in` looks up after resolving
 * a page's real host, so a name that is not a hostname is a credential nothing
 * will ever match. Requiring at least one dot rejects `site.localhost` and
 * `site.` alike; rejecting a trailing dot keeps this in step with `host_of` in
 * agents/browser/site_credentials.py, which strips one.
 */
export function isSiteCredential(name: string): boolean {
  if (!name.startsWith('site.')) return false;
  const host = name.slice(5);
  if (host.length === 0 || host.length > 253) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host);
}
