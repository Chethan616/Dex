import * as fs from 'fs';
import * as path from 'path';

/**
 * Dex's own settings, owned by the app rather than by a file you edit.
 *
 * `.env` is a developer's mechanism. It works, and it is exactly wrong as the
 * place a *product* keeps its configuration: it lives in the source tree, it
 * does not survive a reinstall, it is not there at all in a packaged build, and
 * the only way to change a setting is to open a text editor next to the code.
 *
 * So non-secret settings live here, in `%LOCALAPPDATA%\Dex\settings.json`,
 * beside the logs and the database — the same place every other Windows
 * application keeps its state.
 *
 * Secrets do **not** live here. API keys stay in the DPAPI credential store
 * (core/secrets/credential_store.ts), encrypted against this Windows account.
 * That was already true and stays true: a settings file is a settings file, and
 * a plaintext key in one is a key in every backup of it.
 *
 * `.env` is still *read*, once, and only to migrate: an existing checkout with
 * `DEX_BRAIN_PROVIDER=groq` in it keeps working, its value is copied here the
 * first time, and after that this file is the truth.
 */

export interface DexConfig {
  /** `claude-code`, `groq`, `anthropic`, `gemini`. */
  brainProvider: string;
  /** Empty means "whatever the provider's default is". */
  brainModel: string;

  /** Which optional agents to start. */
  browserAgent: boolean;
  desktopAgent: boolean;

  /** Chat channels. Owner ids are usernames, not secrets. */
  telegramOwner: string;
  discordOwner: string;
  whatsappOwner: string;
  whatsappEnabled: boolean;

  /** Whether the browser runs without a visible window. */
  browserHeadless: boolean;

  /**
   * Which Chrome profile Dex browses in.
   *
   * Empty means Dex's own — isolated, signed in to nothing, and safe for
   * anything public. A profile name or email means the owner's real one,
   * which is what makes "change my GitHub pins" possible at all: Chrome will
   * no longer let a program install an extension, so the profile where they
   * loaded it by hand and are already signed in is worth more than an empty
   * one Dex controls.
   *
   * It is a real choice and not a convenience. In their own profile a mistake
   * lands on their account, which is why every consequential action still
   * raises a card.
   */
  browserProfile: string;

  theme: 'system' | 'light' | 'dark';

  /**
   * Whether the owner has granted Full Access.
   *
   * It lived in `.env` and in a Machine environment variable, written by the
   * install script. Both were wrong. `.env` is a file this project does not
   * want to have — configuration belongs in this store, which the app reads and
   * writes — and a Machine variable is not visible to a process that was
   * already running, so the setting the owner had just granted was invisible
   * until they logged out.
   *
   * Configured is still not the same as effective. This says the owner asked
   * for it; only the daemon reporting `elevated: true` turns it on. See
   * reportAccess in src/main.ts.
   */
  fullAccess: boolean;

  // ── Device mesh ───────────────────────────────────────────────────────────
  // Reaching this PC from a phone when neither Bluetooth nor a shared network
  // is available. Declared here so the mesh work adds files rather than
  // editing this one. See docs/MESH.md.

  /// Whether to open the outbound connection to the relay at startup.
  meshEnabled: boolean;

  /// Which relay to dial. Outbound only — this PC is never a server.
  meshRelayUrl: string;

  /// This machine's stable public identity, derived from its keypair at
  /// pairing. Not a secret: it is the address the relay routes on.
  meshDeviceId: string;

  /// Devices allowed to command this PC, by their public key fingerprint.
  /// Empty means nothing is paired and every inbound request is refused.
  meshPairedDevices: string[];
}

const DEFAULTS: DexConfig = {
  brainProvider: '',
  brainModel: '',
  browserAgent: true,
  desktopAgent: false,
  telegramOwner: '',
  discordOwner: '',
  whatsappOwner: '',
  whatsappEnabled: false,
  browserHeadless: false,
  browserProfile: '',
  theme: 'system',
  fullAccess: false,
  meshEnabled: false,
  meshRelayUrl: '',
  meshDeviceId: '',
  meshPairedDevices: [],
};

/** Env names the old `.env` used, for the one-time migration. */
const LEGACY: Partial<Record<keyof DexConfig, string>> = {
  brainProvider: 'DEX_BRAIN_PROVIDER',
  brainModel: 'DEX_BRAIN_MODEL',
  telegramOwner: 'DEX_OWNER_TELEGRAM',
  discordOwner: 'DEX_OWNER_DISCORD',
  whatsappOwner: 'DEX_OWNER_WHATSAPP',
};

export function configDir(): string {
  const base =
    process.env.LOCALAPPDATA ??
    path.join(process.env.USERPROFILE ?? process.env.HOME ?? '.', 'AppData', 'Local');
  return path.join(base, 'DEX');
}

export function configPath(): string {
  // DEX_CONFIG lets a test point at a temporary file.
  //
  // Without it the suite reads — and would write — the owner's real settings,
  // so a test asserting the default model failed on a machine where someone
  // had chosen a different one. Same reasoning as DEX_DB for the database:
  // a test that depends on the developer's live state is a test that passes
  // or fails for reasons that have nothing to do with the code.
  const override = process.env.DEX_CONFIG;
  if (override) return override;
  return path.join(configDir(), 'settings.json');
}

let cached: DexConfig | undefined;

export function readConfig(): DexConfig {
  if (cached) return cached;

  let stored: Partial<DexConfig> = {};
  try {
    const file = configPath();
    if (fs.existsSync(file)) {
      stored = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<DexConfig>;
    }
  } catch {
    // A corrupt settings file must not stop Dex starting. Defaults are a
    // working configuration; a crash on boot is not.
  }

  const config = { ...DEFAULTS, ...stored };

  // One-time migration from .env, for checkouts that predate this file.
  let migrated = false;
  for (const [key, envName] of Object.entries(LEGACY) as [keyof DexConfig, string][]) {
    if (stored[key] === undefined && process.env[envName]) {
      (config as Record<string, unknown>)[key] = process.env[envName];
      migrated = true;
    }
  }
  if (migrated) writeConfig(config);

  cached = config;
  return config;
}

export function writeConfig(config: DexConfig): void {
  cached = config;
  // The file's own directory, not configDir(): under DEX_CONFIG they differ,
  // and creating the wrong one leaves the write to fail on a missing path.
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  // Written to a temporary file and renamed. An interrupted write would
  // otherwise leave a truncated JSON file, and the next start would fall back
  // to defaults with no explanation — losing which provider was chosen.
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(config, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

export function updateConfig(changes: Partial<DexConfig>): DexConfig {
  const next = { ...readConfig(), ...changes };
  writeConfig(next);
  return next;
}

/** Drop the cache so the next read comes from disk. Used by the tests. */
export function reloadConfig(): void {
  cached = undefined;
}
