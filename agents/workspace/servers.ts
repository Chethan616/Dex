import { McpServerSpec } from './mcp_pool';

/**
 * The MCP servers DEX knows how to start.
 *
 * Every field is overridable by environment variable on purpose. These
 * packages rename their entry points and env vars between releases, and the
 * failure mode when they do is a spawn error deep in a stdio transport. One
 * `DEX_GOOGLE_MCP_CMD=...` should be enough to fix that without a code change.
 *
 * Note what is NOT here: any actual secret. `secrets` maps a credential-store
 * name to the environment variable the server expects, and the value is
 * decrypted at spawn time — see core/secrets/credential_store.ts.
 */

function words(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value.split(' ').filter(Boolean);
}

export function defaultServers(): McpServerSpec[] {
  return [
    {
      key: 'google',
      label: 'Google Workspace',
      command: process.env.DEX_GOOGLE_MCP_CMD ?? 'uvx',
      args: words(process.env.DEX_GOOGLE_MCP_ARGS, ['workspace-mcp']),
      secrets: {
        google_oauth_client_id: 'GOOGLE_OAUTH_CLIENT_ID',
        google_oauth_client_secret: 'GOOGLE_OAUTH_CLIENT_SECRET',
      },
      identityCredential: 'google_account_email',
      identityEnv: 'USER_GOOGLE_EMAIL',
    },
    {
      key: 'ms365',
      label: 'Microsoft 365',
      command: process.env.DEX_MS365_MCP_CMD ?? 'npx',
      args: words(process.env.DEX_MS365_MCP_ARGS, ['-y', '@softeria/ms-365-mcp-server']),
      secrets: {
        ms365_client_id: 'MS365_MCP_CLIENT_ID',
        ms365_client_secret: 'MS365_MCP_CLIENT_SECRET',
        ms365_tenant_id: 'MS365_MCP_TENANT_ID',
      },
      identityCredential: 'ms365_account_email',
      identityEnv: 'MS365_MCP_ACCOUNT',
    },
  ];
}

/**
 * Which server answers each action. Defaults to Google; set
 * `DEX_WORKSPACE_PROVIDER=ms365` if the owner lives in Outlook instead.
 */
export function defaultRoutes(): Record<string, string> {
  const provider = process.env.DEX_WORKSPACE_PROVIDER;
  if (!provider) return {};
  return {
    search_email: provider,
    read_email: provider,
    send_email: provider,
    list_calendar_events: provider,
    create_calendar_event: provider,
    search_drive: provider,
    read_drive_file: provider,
  };
}
