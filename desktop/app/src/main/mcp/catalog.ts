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

import path from 'node:path';
import { oauthClient } from '../accounts/oauthClients';
import { knownFolders } from '../startup/knownFolders';
import { findBlender } from '../startup/blender';

export type McpTransport = 'stdio';

/** Which one-click sign-in Settings offers instead of credential fields. */
export type AccountProvider = 'google' | 'github' | 'slack';

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

/** mcp-servers/launch.mjs — how engines that can't read mcp.json start a connected server. */
export function mcpLauncherScript(): string {
  return path.join(appRoot(), 'mcp-servers', 'launch.mjs');
}

/** How to start a server: the one place every spawner (verify, tool calls, engine config) asks. */
export function launchSpec(definition: McpServerDefinition, values: Record<string, string>): LaunchSpec {
  const env = { ...(definition.env ?? {}), ...(definition.launchEnv?.() ?? {}), ...values };
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
    id: 'google',
    displayName: 'Google',
    summary: 'Gmail, Calendar, Meet, Drive, Docs, Sheets, Contacts and Tasks for your Google account — read and send mail, schedule meetings with Meet links, find and write documents.',
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
    // run with uvx like the npx servers above; not vendored. It drives a
    // running Blender over localhost:9876 through its add-on, and returns
    // viewport screenshots as images, so the agent can see what it built.
    id: 'blender',
    displayName: 'Blender',
    summary: 'Build 3D scenes and models in a live Blender: run Python in the scene, see the viewport, pull free Poly Haven HDRIs, textures and models, export GLB/FBX.',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-for-blender'],
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
];

export function findServerDefinition(id: string): McpServerDefinition | undefined {
  return MCP_CATALOG.find((server) => server.id === id);
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
