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

export type McpTransport = 'stdio';

export interface McpCredentialField {
  /** Key used in the env passed to the server process. */
  key: string;
  label: string;
  /** Rendered as a password field and never logged or echoed back. */
  secret: boolean;
  help?: string;
}

export interface McpServerDefinition {
  id: string;
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
  },
  {
    id: 'google-drive',
    displayName: 'Google Drive',
    summary: 'Search and read Drive files. Also what @drive searches alongside your PC.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gdrive'],
    credentials: [
      {
        key: 'GDRIVE_CREDENTIALS_PATH',
        label: 'Credentials file path',
        secret: false,
        help: 'Path to the OAuth client credentials JSON downloaded from Google Cloud Console.',
      },
    ],
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
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
    const value = values[field.key];
    return !value || value.trim().length === 0;
  });
}
