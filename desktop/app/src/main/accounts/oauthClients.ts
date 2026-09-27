/**
 * The OAuth apps DEX signs in with.
 *
 * A one-click "Continue with Google" needs an OAuth client registered to the
 * app (not to the user): a Google Cloud "Desktop app" client, a Slack app, a
 * GitHub OAuth App. Resolved in order:
 *
 *   1. environment — DEX_GOOGLE_CLIENT_ID, DEX_GOOGLE_CLIENT_SECRET,
 *      DEX_GITHUB_CLIENT_ID, DEX_SLACK_CLIENT_ID, DEX_SLACK_CLIENT_SECRET,
 *      DEX_SLACK_REDIRECT_URI (dev: desktop/app/.env)
 *   2. config/oauth-clients.json next to the app (gitignored) — how a
 *      packaged build carries them. Written once by the developer with
 *      `yarn oauth:setup`; users never see a client id, only "Connect".
 */
import fs from 'node:fs';
import path from 'node:path';
import { mainLogger } from '../logger';

export type OAuthProvider = 'google' | 'github' | 'slack' | 'huggingface';

export interface OAuthClient {
  clientId: string;
  clientSecret?: string;
  /** Slack only: must match a redirect URL registered on the Slack app. */
  redirectUri?: string;
}

type ClientMap = Partial<Record<OAuthProvider, OAuthClient>>;

let fileCache: ClientMap | null = null;

function appRoot(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron');
    return app.getAppPath();
  } catch {
    return process.cwd();
  }
}

function fromFile(): ClientMap {
  if (fileCache) return fileCache;
  const target = path.join(appRoot(), 'config', 'oauth-clients.json');
  try {
    fileCache = JSON.parse(fs.readFileSync(target, 'utf-8')) as ClientMap;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      mainLogger.warn('accounts.oauthClients.readFailed', { target, error: (err as Error).message });
    }
    fileCache = {};
  }
  return fileCache;
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function oauthClient(provider: OAuthProvider): OAuthClient | null {
  const file = fromFile()[provider];
  const upper = provider.toUpperCase();
  const clientId = env(`DEX_${upper}_CLIENT_ID`) ?? file?.clientId;
  if (!clientId) return null;
  return {
    clientId,
    clientSecret: env(`DEX_${upper}_CLIENT_SECRET`) ?? file?.clientSecret,
    redirectUri: env(`DEX_${upper}_REDIRECT_URI`) ?? file?.redirectUri,
  };
}
