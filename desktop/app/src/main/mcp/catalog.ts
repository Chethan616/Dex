/**
 * The MCP servers DEX knows how to connect to.
 *
 * The point of MCP here is narrow and worth stating: when a service exposes a
 * real API, driving its website instead is slow, fragile and expensive. The
 * agent spends a dozen turns and a lot of tokens clicking through Gmail to do
 * what one tool call does, and every one of those clicks is a chance for a
 * layout change to break the task. So anything with a server in this catalogue
 * should be reached through it, and the browser kept for the web that has no
 * API.
 *
 * Each entry is a *definition*, not a connection: what to run, and what the
 * user must supply before it can run. Whether it is switched on, and the
 * secrets themselves, live in store.ts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { oauthClient } from '../accounts/oauthClients';
import { knownFolders } from '../startup/knownFolders';
import { blenderHome, findBlender } from '../startup/blender';
import { HOSTED_CONNECTORS, remoteConnectionId, type HostedConnector } from '../../shared/connectorCatalog';

export type McpTransport = 'stdio';

/** Which one-click sign-in Settings offers instead of credential fields. */
export type AccountProvider = 'google' | 'github' | 'slack' | 'reddit' | 'microsoft';

export interface McpCredentialField {
  /** Key used in the env passed to the server process. */
  key: string;
  label: string;
  /** Rendered as a password field and never logged or echoed back. */
  secret: boolean;
  help?: string;
  /** Unlocks extras; the server works without it (e.g. Blender's Sketchfab key). */
  optional?: boolean;
}

export interface McpServerDefinition {
  id: string;
  /**
   * Who the credential belongs to, when the service can say.
   *
   * Without this the agent has a token but no idea whose account it opens.
   * Asked for "my repositories" it guessed a username from the email address
   * — chethankrishna2022 rather than Chethan616 — the API rejected it, and it
   * gave up and asked. A token that works but cannot say who it is for is
   * only half a connection.
   */
  resolveIdentity?: (values: Record<string, string>) => Promise<string | undefined>;
  displayName: string;
  /** One line, shown in Settings. What the agent gains by enabling it. */
  summary: string;
  transport: McpTransport;
  command: string;
  args: string[];
  /** Static env, merged under the user-supplied credentials. */
  env?: Record<string, string>;
  credentials: McpCredentialField[];
  /** Where to get the credential, linked from Settings. */
  docsUrl?: string;
  /**
   * Connected by signing in (OAuth), not by pasting a token. The credential
   * fields are still what the server receives — the sign-in fills them.
   */
  connect?: AccountProvider;
  /**
   * A server shipped inside DEX (mcp-servers/<name>/server.mjs), run with
   * Electron's own Node so it needs nothing installed.
   */
  builtIn?: string;
  /** Env resolved at launch time rather than stored (e.g. OAuth client ids). */
  launchEnv?: () => Record<string, string>;
}

export interface LaunchSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
  /** npx is a .cmd shim on Windows and needs a shell; an .exe path must not get one. */
  shell: boolean;
}

function appRoot(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron');
    return app.getAppPath();
  } catch {
    return process.cwd();
  }
}

/** Copy the bridge out of app.asar for the child Node process. */
function redditBridgePath(): string {
  const source = path.join(appRoot(), 'mcp-servers', 'reddit', 'oauth-bridge.mjs');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron');
    const target = path.join(app.getPath('userData'), 'mcp-servers', 'reddit', 'oauth-bridge.mjs');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target) || fs.statSync(source).mtimeMs > fs.statSync(target).mtimeMs) fs.copyFileSync(source, target);
    return target;
  } catch {
    return source;
  }
}

/** mcp-servers/launch.mjs — how engines that can't read mcp.json start a connected server. */
export function mcpLauncherScript(): string {
  return path.join(appRoot(), 'mcp-servers', 'launch.mjs');
}

/** How to start a server: the one place every spawner (verify, tool calls, engine config) asks. */
export function launchSpec(definition: McpServerDefinition, values: Record<string, string>): LaunchSpec {
  const env = { ...(definition.env ?? {}), ...(definition.launchEnv?.() ?? {}), ...values };
  // reddit-mcp-server currently hard-codes client_credentials/password grants.
  // For DEX OAuth accounts, preload a narrow fetch adapter that exchanges the
  // saved refresh token instead, while leaving all other requests untouched.
  if (definition.id === 'reddit' && values.REDDIT_REFRESH_TOKEN) {
    // Keep the refresh token out of mcp.json and the npx installer process.
    // The bundled launcher reads it from keytar only after npx has finished.
    env.DEX_REDDIT_CLIENT_ID ||= env.REDDIT_CLIENT_ID || oauthClient('reddit')?.clientId || '';
    env.DEX_REDDIT_USERNAME ||= values.REDDIT_USERNAME || '';
    env.DEX_REDDIT_BRIDGE_PATH ||= redditBridgePath();
    for (const key of ['REDDIT_REFRESH_TOKEN', 'DEX_REDDIT_REFRESH_TOKEN', 'REDDIT_CLIENT_SECRET', 'REDDIT_PASSWORD', 'REDDIT_CLIENT_ID', 'REDDIT_USERNAME']) {
      delete env[key];
    }
  }
  // A hosted connector's proxy needs its URL and current access token only;
  // the refresh token and client details stay in the credential store.
  if (definition.builtIn === 'remote') {
    for (const key of Object.keys(env)) {
      if (key.startsWith('DEX_REMOTE_') && !['DEX_REMOTE_URL', 'DEX_REMOTE_TOKEN', 'DEX_REMOTE_ID'].includes(key)) delete env[key];
    }
  }
  if (definition.builtIn) {
    return {
      command: process.execPath,
      args: [path.join(appRoot(), 'mcp-servers', definition.builtIn, 'server.mjs')],
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      shell: false,
    };
  }
  return { command: definition.command, args: definition.args, env, shell: process.platform === 'win32' };
}

/**
 * Built-in definitions.
 *
 * All of these are npx-launched reference servers, so there is nothing to
 * bundle and nothing to keep up to date in this repo — the cost of a wrong
 * pin here is a broken connection the user cannot fix, which is worse than a
 * slightly slower first launch.
 */
export const MCP_CATALOG: McpServerDefinition[] = [
  {
    id: 'github',
    displayName: 'GitHub',
    summary: 'Read and write issues, pull requests and repository contents without opening github.com.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    credentials: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'Personal access token',
        secret: true,
        help: 'A fine-grained token with access to the repositories you want DEX to reach.',
      },
    ],
    docsUrl: 'https://github.com/settings/tokens',
    connect: 'github',
    resolveIdentity: async (values) => {
      const token = values.GITHUB_PERSONAL_ACCESS_TOKEN;
      if (!token) return undefined;
      try {
        const response = await fetch('https://api.github.com/user', {
          headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
        });
        if (!response.ok) return undefined;
        const body = (await response.json()) as { login?: string };
        return typeof body.login === 'string' ? body.login : undefined;
      } catch {
        // Identity is a nicety; a failure here must not fail the connection.
        return undefined;
      }
    },
  },
  {
    id: 'slack',
    displayName: 'Slack',
    summary: 'Read channels and post messages directly, instead of driving the Slack web app.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    credentials: [
      { key: 'SLACK_BOT_TOKEN', label: 'Bot token', secret: true, help: 'Starts with xoxb-.' },
      { key: 'SLACK_TEAM_ID', label: 'Team ID', secret: false },
    ],
    docsUrl: 'https://api.slack.com/apps',
    connect: 'slack',
  },
  {
    id: 'reddit',
    displayName: 'Reddit',
    summary: 'Search Reddit, read posts and comments, and manage your own posts through your account.',
    transport: 'stdio',
    command: 'node',
    args: [],
    builtIn: 'reddit',
    credentials: [
      {
        key: 'REDDIT_REFRESH_TOKEN',
        label: 'Reddit account',
        secret: true,
        help: 'Filled securely when you connect Reddit in Accounts.',
      },
      {
        key: 'REDDIT_USERNAME',
        label: 'Reddit username',
        secret: false,
        help: 'Filled in by Reddit sign-in.',
      },
    ],
    docsUrl: 'https://github.com/jordanburke/reddit-mcp-server',
    connect: 'reddit',
  },
  {
    id: 'google',
    displayName: 'Google',
    summary: 'Gmail, Calendar, Meet, Drive, Docs, Sheets, Contacts, Tasks and Chat for your Google account — read and send mail, schedule meetings with Meet links, find and write documents, and message in Google Chat.',
    transport: 'stdio',
    command: 'node',
    args: [],
    builtIn: 'google',
    connect: 'google',
    credentials: [
      {
        key: 'GOOGLE_REFRESH_TOKEN',
        label: 'Google account',
        secret: true,
        help: 'Filled in by "Continue with Google" — you never paste this.',
      },
    ],
    launchEnv: () => {
      const client = oauthClient('google');
      const folders = knownFolders();
      return {
        GOOGLE_CLIENT_ID: client?.clientId ?? '',
        GOOGLE_CLIENT_SECRET: client?.clientSecret ?? '',
        // Where drive_download saves: the real Downloads folder, which on a
        // OneDrive-redirected PC is not ~/Downloads.
        DEX_DOWNLOADS_DIR: folders.downloads ?? '',
        DEX_HOME_DIR: folders.home ?? '',
      };
    },
  },
  {
    // github.com/ahujasid/mcp-for-blender (MIT) — the maintainer's package,
    // run with uvx; not vendored. mcp-servers/blender wraps it so it drives a
    // Blender that runs in the BACKGROUND (no window, one per task, started
    // on the first Blender tool call) — the user keeps their desktop. Its
    // "viewport screenshots" are real renders through the scene camera.
    id: 'blender',
    displayName: 'Blender',
    summary: 'Build 3D scenes and models in Blender, in the background — no window, your desktop stays yours: run Python in the scene, see renders of it, pull free Poly Haven HDRIs, textures and models, export GLB/FBX.',
    transport: 'stdio',
    command: 'node',
    args: [],
    builtIn: 'blender',
    launchEnv: () => ({
      DEX_BLENDER: findBlender() ?? '',
      DEX_BLENDER_HOME: blenderHome(),
    }),
    env: {
      // Anonymous usage pings off; content collection is off by default anyway.
      DISABLE_TELEMETRY: 'true',
      // Its installer prints "→", which Windows' cp1252 console can't encode.
      PYTHONIOENCODING: 'utf-8',
    },
    credentials: [
      {
        key: 'BLENDERMCP_SKETCHFAB_API_KEY',
        label: 'Sketchfab API key (optional)',
        secret: true,
        optional: true,
        help: 'Free: sketchfab.com → Settings → Password & API. Adds real-world models.',
      },
      {
        key: 'BLENDERMCP_POLYPIZZA_API_KEY',
        label: 'Poly Pizza API key (optional)',
        secret: true,
        optional: true,
        help: 'Free: poly.pizza/settings/api. Adds low-poly models.',
      },
    ],
    docsUrl: 'https://github.com/ahujasid/mcp-for-blender',
    resolveIdentity: async () => {
      const exe = findBlender();
      const version = exe?.match(/Blender (\d+(?:\.\d+)*)/)?.[1];
      return version ? `Blender ${version}` : undefined;
    },
  },
  {
    id: 'microsoft',
    displayName: 'Microsoft 365',
    summary: 'Outlook mail, Calendar, OneDrive/SharePoint files, Teams chats and Microsoft To Do — read, send and manage through your Microsoft account.',
    transport: 'stdio',
    command: 'node',
    args: [],
    builtIn: 'microsoft',
    connect: 'microsoft',
    credentials: [
      {
        key: 'MICROSOFT_REFRESH_TOKEN',
        label: 'Microsoft account',
        secret: true,
        help: 'Filled in by "Continue with Microsoft" — you never paste this.',
      },
    ],
    launchEnv: () => {
      const client = oauthClient('microsoft');
      return {
        MICROSOFT_CLIENT_ID: client?.clientId ?? '',
        MICROSOFT_CLIENT_SECRET: client?.clientSecret ?? '',
      };
    },
  },
];

/**
 * A hosted connector (shared/connectorCatalog.ts) as an MCP server: DEX's
 * proxy, mcp-servers/remote, pointed at the service with its token.
 */
function remoteDefinition(c: HostedConnector): McpServerDefinition {
  return {
    id: remoteConnectionId(c.id),
    displayName: c.name,
    summary: c.blurb,
    transport: 'stdio',
    command: 'node',
    args: [],
    builtIn: 'remote',
    launchEnv: () => ({ DEX_REMOTE_URL: c.url, DEX_REMOTE_ID: remoteConnectionId(c.id), DEX_CONTROL_FILE: controlFilePath() }),
    credentials: c.auth === 'oauth' ? [{ key: 'DEX_REMOTE_TOKEN', label: `${c.name} sign-in`, secret: true }] : [],
  };
}

function controlFilePath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron');
    return path.join(app.getPath('userData'), 'local-task-server.json');
  } catch {
    return '';
  }
}

/**
 * DEX's Windows server (mcp-servers/windows, docs/desktop-control): Windows
 * apps, media and PC diagnostics in the background. Every task on Windows
 * gets it without the user turning anything on (see alwaysOnConnections).
 */
export const WINDOWS_TOOL_NAMES = [
  'windows_list', 'window_tree', 'window_find', 'window_capture', 'ui_invoke', 'ui_set_text', 'ui_toggle', 'ui_select',
  'ui_expand', 'ui_scroll', 'ui_wait', 'app_launch', 'window_manage', 'media', 'system_info', 'open_settings',
];

export const WINDOWS_DEFINITION: McpServerDefinition = {
  id: 'windows',
  displayName: 'Windows',
  summary: 'Use Windows apps and settings in the background — your mouse, keyboard and windows stay yours.',
  transport: 'stdio',
  command: 'node',
  args: [],
  builtIn: 'windows',
  credentials: [],
  launchEnv: () => {
    let home = '';
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { app } = require('electron') as typeof import('electron');
      home = path.join(app.getPath('userData'), 'desktop');
    } catch { /* tests */ }
    return { DEX_EXE_PATH: process.execPath, DEX_DESK_HOME: home, DEX_CONTROL_FILE: controlFilePath() };
  },
};

/** Servers every task gets on this platform (unless the user switched one off). */
export function alwaysOnConnections(stored: Array<{ id: string; enabled: boolean }>): Array<{ id: string; values: Record<string, string>; toolNames: string[] }> {
  if (process.platform !== 'win32') return [];
  if (stored.some((c) => c.id === 'windows' && c.enabled === false)) return [];
  return [{ id: 'windows', values: {}, toolNames: WINDOWS_TOOL_NAMES }];
}

const REMOTE_DEFINITIONS = new Map(HOSTED_CONNECTORS.map((c) => [remoteConnectionId(c.id), c]));

export function findServerDefinition(id: string): McpServerDefinition | undefined {
  const builtIn = MCP_CATALOG.find((server) => server.id === id);
  if (builtIn) return builtIn;
  if (id === WINDOWS_DEFINITION.id) return WINDOWS_DEFINITION;
  const hosted = REMOTE_DEFINITIONS.get(id);
  return hosted ? remoteDefinition(hosted) : undefined;
}

/**
 * Which required credentials are still missing.
 *
 * Returned rather than thrown: a half-configured server should be visible in
 * Settings with the gap named, not silently absent.
 */
export function missingCredentials(
  definition: McpServerDefinition,
  values: Record<string, string>,
): McpCredentialField[] {
  return definition.credentials.filter((field) => {
    if (field.optional) return false;
    const value = values[field.key];
    return !value || value.trim().length === 0;
  });
}
