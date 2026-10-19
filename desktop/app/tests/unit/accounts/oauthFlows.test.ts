/**
 * The sign-in flows, end to end, offline: a fake browser follows each
 * authorization URL back to DEX's loopback server (the way the provider
 * would redirect), and the providers' token endpoints are stubbed. Proves the
 * code builds the right requests, checks state, does PKCE, and turns the
 * answers into an account — for Google, Slack, Hugging Face and GitHub.
 */
import { createHash } from 'node:crypto';
import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const opened: URL[] = [];
/** How the fake browser answers each authorization URL. */
let browser: (auth: URL) => Promise<void> = async () => {};
const clipboardWrites: string[] = [];
const vault = new Map<string, string>();
let failKeytarWrites = false;

vi.mock('electron', () => ({
  shell: { openExternal: async (url: string) => { const u = new URL(url); opened.push(u); setTimeout(() => { void browser(u); }, 5); } },
  clipboard: { writeText: (t: string) => clipboardWrites.push(t) },
  app: { getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));
vi.mock('../../../src/main/logger', () => ({ mainLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../src/main/accounts/oauthClients', () => ({
  oauthClient: (p: string) => ({
    google: { clientId: 'g-client', clientSecret: 'g-secret' },
    slack: { clientId: 's-client', clientSecret: 's-secret' },
    github: { clientId: 'gh-client' },
    reddit: { clientId: 'r-client' },
    microsoft: { clientId: 'm-client', clientSecret: 'm-secret' },
    discord: { clientId: 'd-client' },
  } as Record<string, unknown>)[p] ?? null,
}));
vi.mock('keytar', () => ({
  default: undefined,
  getPassword: async (s: string, a: string) => vault.get(`${s}/${a}`) ?? null,
  setPassword: async (s: string, a: string, v: string) => {
    if (failKeytarWrites) throw new Error('keychain unavailable');
    vault.set(`${s}/${a}`, v);
  },
  deletePassword: async (s: string, a: string) => vault.delete(`${s}/${a}`),
}));

/** Follow the redirect the provider would send: back to DEX's loopback. */
async function redirectBack(auth: URL, extra: Record<string, string>): Promise<string> {
  const back = new URL(auth.searchParams.get('redirect_uri')!);
  for (const [k, v] of Object.entries(extra)) back.searchParams.set(k, v);
  const res = await realFetch(back);
  return res.text();
}

const realFetch = globalThis.fetch;
type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
let routes: Array<[RegExp, Handler]> = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  opened.length = 0;
  routes = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('http://127.0.0.1')) return realFetch(input, init);
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) throw new Error(`unexpected fetch ${url}`);
    return hit[1](url, init);
  });
});
afterEach(() => { failKeytarWrites = false; vi.unstubAllGlobals(); });

const form = (init?: RequestInit) => new URLSearchParams(String(init?.body ?? ''));

describe('Google sign-in', () => {
  it('uses PKCE + state, asks for offline access, and returns the refresh token', async () => {
    let verifierSent = '';
    browser = async (auth) => { await redirectBack(auth, { code: 'g-code', state: auth.searchParams.get('state')! }); };
    routes.push([/oauth2\.googleapis\.com\/token/, (_u, init) => {
      const body = form(init);
      verifierSent = body.get('code_verifier')!;
      expect(body.get('code')).toBe('g-code');
      expect(body.get('client_secret')).toBe('g-secret');
      return json({ access_token: 'at', refresh_token: 'rt', id_token: 'it' });
    }]);
    routes.push([/openidconnect\.googleapis\.com\/v1\/userinfo/, () => json({ email: 'me@x.com', name: 'Me' })]);

    const { connectGoogle } = await import('../../../src/main/accounts/google');
    const account = await connectGoogle();
    expect(account).toMatchObject({ refreshToken: 'rt', email: 'me@x.com', name: 'Me' });

    const auth = opened[0];
    expect(auth.origin + auth.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(auth.searchParams.get('access_type')).toBe('offline');
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    // The challenge is the SHA-256 of the verifier that was later sent.
    expect(auth.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifierSent).digest('base64url'));
    expect(auth.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(auth.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/chat.messages');
    expect(auth.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/chat.spaces.readonly');
  });

  it('rejects a response whose state doesn’t match', async () => {
    browser = async (auth) => { await redirectBack(auth, { code: 'g-code', state: 'forged' }); };
    const { connectGoogle } = await import('../../../src/main/accounts/google');
    await expect(connectGoogle()).rejects.toThrow(/didn’t match/);
  });

  it('says so plainly when the user cancels', async () => {
    browser = async (auth) => { await redirectBack(auth, { error: 'access_denied', state: auth.searchParams.get('state')! }); };
    const { connectGoogle } = await import('../../../src/main/accounts/google');
    await expect(connectGoogle()).rejects.toThrow(/cancelled/);
  });
});

describe('Slack install', () => {
  it('exchanges the code for a bot token and the team', async () => {
    browser = async (auth) => { await redirectBack(auth, { code: 's-code', state: auth.searchParams.get('state')! }); };
    routes.push([/slack\.com\/api\/oauth\.v2\.access/, (_u, init) => {
      expect(form(init).get('client_secret')).toBe('s-secret');
      return json({ ok: true, access_token: 'xoxb-1', team: { id: 'T1', name: 'Team' } });
    }]);
    const { connectSlack } = await import('../../../src/main/accounts/slack');
    await expect(connectSlack()).resolves.toEqual({ botToken: 'xoxb-1', teamId: 'T1', teamName: 'Team' });
    expect(opened[0].searchParams.get('redirect_uri')).toBe('http://127.0.0.1:53682/slack/callback');
  });

  it('explains a busy port instead of failing cryptically', async () => {
    // The previous test's loopback lets go of the port a moment after its reply.
    const blocker = net.createServer();
    for (let tries = 0; ; tries += 1) {
      const bound = await new Promise<boolean>((r) => {
        blocker.once('error', () => r(false));
        blocker.listen(53682, '127.0.0.1', () => r(true));
      });
      if (bound) break;
      if (tries > 20) throw new Error('port 53682 never freed up');
      await new Promise((r) => setTimeout(r, 100));
    }
    try {
      const { connectSlack } = await import('../../../src/main/accounts/slack');
      await expect(connectSlack()).rejects.toThrow(/port 53682/);
    } finally {
      blocker.close();
    }
  });
});

describe('Reddit installed-app OAuth', () => {
  async function waitForRedditPort(): Promise<void> {
    for (let attempts = 0; attempts < 20; attempts += 1) {
      const free = await new Promise<boolean>((resolve) => {
        const probe = net.createServer();
        probe.once('error', () => resolve(false));
        probe.listen(53683, '127.0.0.1', () => probe.close(() => resolve(true)));
      });
      if (free) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Reddit loopback port did not become free');
  }

  beforeEach(waitForRedditPort);

  it('exchanges the code using the public client and verifies the account', async () => {
    browser = async (auth) => { await redirectBack(auth, { code: 'r-code', state: auth.searchParams.get('state')! }); };
    routes.push([/www\.reddit\.com\/api\/v1\/access_token/, (_u, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe(`Basic ${Buffer.from('r-client:').toString('base64')}`);
      expect(form(init)).toEqual(new URLSearchParams({ grant_type: 'authorization_code', code: 'r-code', redirect_uri: 'http://127.0.0.1:53683/reddit/callback' }));
      return json({ access_token: 'r-access', refresh_token: 'r-refresh' });
    }]);
    routes.push([/oauth\.reddit\.com\/api\/v1\/me/, (_u, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer r-access');
      return json({ name: 'reddit-user', subreddit: { title: 'Reddit User' } });
    }]);

    const { connectReddit } = await import('../../../src/main/accounts/reddit');
    await expect(connectReddit()).resolves.toEqual({ refreshToken: 'r-refresh', username: 'reddit-user', name: 'Reddit User' });
    const auth = opened[0];
    expect(auth.origin + auth.pathname).toBe('https://www.reddit.com/api/v1/authorize');
    expect(auth.searchParams.get('response_type')).toBe('code');
    expect(auth.searchParams.get('duration')).toBe('permanent');
    expect(auth.searchParams.get('scope')?.split(' ')).toEqual(expect.arrayContaining(['identity', 'read', 'history', 'submit', 'edit', 'save']));
    expect(auth.searchParams.get('state')).toBeTruthy();
    expect(auth.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:53683/reddit/callback');
  });

  it('rejects a forged callback without consuming the listener needed by the valid state', async () => {
    let invalidResponse = '';
    browser = async (auth) => {
      invalidResponse = await redirectBack(auth, { code: 'forged-code', state: 'forged-state' });
      await redirectBack(auth, { code: 'real-code', state: auth.searchParams.get('state')! });
    };
    routes.push([/www\.reddit\.com\/api\/v1\/access_token/, () => json({ access_token: 'r-access', refresh_token: 'r-refresh' })]);
    routes.push([/oauth\.reddit\.com\/api\/v1\/me/, () => json({ name: 'reddit-user' })]);

    const { connectReddit } = await import('../../../src/main/accounts/reddit');
    await expect(connectReddit()).resolves.toMatchObject({ username: 'reddit-user' });
    expect(invalidResponse).toContain('did not match');
  });

  it('does not exchange a code when the user cancels', async () => {
    browser = async (auth) => { await redirectBack(auth, { error: 'access_denied', state: auth.searchParams.get('state')! }); };
    const { connectReddit } = await import('../../../src/main/accounts/reddit');
    await expect(connectReddit()).rejects.toThrow(/cancelled/);
  });
});

describe('Discord sign-in', () => {
  async function waitForDiscordPort(): Promise<void> {
    for (let attempts = 0; attempts < 20; attempts += 1) {
      const free = await new Promise<boolean>((resolve) => {
        const probe = net.createServer();
        probe.once('error', () => resolve(false));
        probe.listen(53685, '127.0.0.1', () => probe.close(() => resolve(true)));
      });
      if (free) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Discord loopback port did not become free');
  }
  beforeEach(waitForDiscordPort);

  const guilds = () => json([{ id: '42', name: 'Study Group' }, { id: '7', name: 'Other' }]);

  it('uses PKCE as a public client, asks for the channel to post to, and names it after its server', async () => {
    browser = async (auth) => { await redirectBack(auth, { code: 'd-code', state: auth.searchParams.get('state')! }); };
    let verifier = '';
    routes.push([/discord\.com\/api\/v10\/oauth2\/token$/, (_u, init) => {
      const f = form(init);
      expect(f.get('grant_type')).toBe('authorization_code');
      expect(f.get('code')).toBe('d-code');
      expect(f.get('client_id')).toBe('d-client');
      expect(f.get('client_secret')).toBeNull();
      expect(f.get('redirect_uri')).toBe('http://127.0.0.1:53685/discord/callback');
      verifier = f.get('code_verifier') ?? '';
      return json({ access_token: 'd-access', refresh_token: 'd-refresh', expires_in: 604800, webhook: { id: '900', token: 'wh-secret', channel_id: '901', guild_id: '42' } });
    }]);
    routes.push([/\/users\/@me\/guilds/, guilds]);
    routes.push([/\/users\/@me$/, (_u, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer d-access');
      return json({ id: '5', username: 'chethan', global_name: 'Chethan', avatar: 'abc' });
    }]);

    const { connectDiscord } = await import('../../../src/main/accounts/discord');
    const account = await connectDiscord();
    expect(account).toMatchObject({
      accessToken: 'd-access', refreshToken: 'd-refresh', username: 'chethan', name: 'Chethan',
      picture: 'https://cdn.discordapp.com/avatars/5/abc.png?size=128',
      channel: { id: '900', token: 'wh-secret', channelId: '901', guildId: '42', label: 'Study Group' },
    });
    const auth = opened[0];
    expect(auth.origin + auth.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(auth.searchParams.get('scope')?.split(' ')).toEqual(['identify', 'guilds', 'webhook.incoming']);
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    expect(auth.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });

  it('a second channel in the same server gets its own name, and the newer grant comes back', async () => {
    browser = async (auth) => { await redirectBack(auth, { code: 'd-code-2', state: auth.searchParams.get('state')! }); };
    routes.push([/oauth2\/token$/, () => json({ access_token: 'd-access-2', refresh_token: 'd-refresh-2', webhook: { id: '910', token: 'wh-2', channel_id: '911', guild_id: '42' } })]);
    routes.push([/\/users\/@me\/guilds/, guilds]);
    const { addDiscordChannel } = await import('../../../src/main/accounts/discord');
    const added = await addDiscordChannel([{ id: '900', token: 'wh-secret', channelId: '901', guildId: '42', label: 'Study Group' }]);
    expect(added).toMatchObject({ accessToken: 'd-access-2', refreshToken: 'd-refresh-2', channel: { id: '910', label: 'Study Group (2)' } });
  });

  it('says so plainly when the user cancels', async () => {
    browser = async (auth) => { await redirectBack(auth, { error: 'access_denied', state: auth.searchParams.get('state')! }); };
    const { connectDiscord } = await import('../../../src/main/accounts/discord');
    await expect(connectDiscord()).rejects.toThrow(/cancelled the Discord sign-in/);
  });

  it('keeps only well-formed channels from storage', async () => {
    const { parseChannels } = await import('../../../src/main/accounts/discord');
    expect(parseChannels('not json')).toEqual([]);
    expect(parseChannels(JSON.stringify([{ id: '1', token: 't', channelId: '2', guildId: '3', label: 'A' }, { id: 'x', token: 't', channelId: '2', label: 'B' }]))).toEqual([{ id: '1', token: 't', channelId: '2', guildId: '3', label: 'A' }]);
  });
});

describe('Microsoft sign-in', () => {
  it('uses PKCE, requests full scopes, and returns the tokens and user profile', async () => {
    let verifierSent = '';
    browser = async (auth) => {
      // What the Entra app registers: localhost, any port, this path.
      expect(auth.searchParams.get('redirect_uri')).toMatch(/^http:\/\/localhost:\d+\/microsoft\/callback$/);
      await redirectBack(auth, { code: 'm-code', state: auth.searchParams.get('state')! });
    };
    routes.push([/login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/token/, (_u, init) => {
      const body = form(init);
      verifierSent = body.get('code_verifier')!;
      expect(body.get('code')).toBe('m-code');
      expect(body.get('client_id')).toBe('m-client');
      expect(body.get('client_secret')).toBe('m-secret');
      return json({ access_token: 'ms-at', refresh_token: 'ms-rt', expires_in: 3600 });
    }]);
    routes.push([/graph\.microsoft\.com\/v1\.0\/me$/, () => json({ displayName: 'Alex MS', mail: 'alex@outlook.com' })]);
    routes.push([/graph\.microsoft\.com\/v1\.0\/me\/photo\/\$value/, () => new Response('avatar-bytes', { status: 200, headers: { 'content-type': 'image/jpeg' } })]);

    const { connectMicrosoft } = await import('../../../src/main/accounts/microsoft');
    const account = await connectMicrosoft();
    expect(account).toMatchObject({
      refreshToken: 'ms-rt',
      accessToken: 'ms-at',
      email: 'alex@outlook.com',
      name: 'Alex MS',
    });
    expect(account.picture).toMatch(/^data:image\/jpeg;base64,/);

    const auth = opened[0];
    expect(auth.origin + auth.pathname).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    expect(auth.searchParams.get('prompt')).toBe('select_account');
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    expect(auth.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifierSent).digest('base64url'));
    expect(auth.searchParams.get('scope')).toContain('offline_access');
    expect(auth.searchParams.get('scope')).toContain('Mail.ReadWrite');
    expect(auth.searchParams.get('scope')).toContain('Calendars.ReadWrite');
    expect(auth.searchParams.get('scope')).toContain('Files.ReadWrite.All');
    expect(auth.searchParams.get('scope')).toContain('Chat.ReadWrite');
    expect(auth.searchParams.get('scope')).toContain('Tasks.ReadWrite');
  });

  it('rejects when the state in the redirect does not match', async () => {
    browser = async (auth) => { await redirectBack(auth, { code: 'm-code', state: 'bad-state' }); };
    const { connectMicrosoft } = await import('../../../src/main/accounts/microsoft');
    await expect(connectMicrosoft()).rejects.toThrow(/didn’t match/);
  });

  it('explains when the user cancels the sign-in', async () => {
    browser = async (auth) => { await redirectBack(auth, { error: 'access_denied', state: auth.searchParams.get('state')! }); };
    const { connectMicrosoft } = await import('../../../src/main/accounts/microsoft');
    await expect(connectMicrosoft()).rejects.toThrow(/cancelled/);
  });
});

describe('MCP credential persistence', () => {
  it('fails closed on keytar errors and keeps other accounts when Reddit is updated', async () => {
    vault.clear();
    failKeytarWrites = false;
    vi.resetModules();
    const moduleRuntime = (await import('node:module')).default as unknown as {
      _load: (request: string, parent: unknown, isMain: boolean) => unknown;
    };
    const originalLoad = moduleRuntime._load;
    moduleRuntime._load = function loadMock(request, parent, isMain) {
      if (request === 'keytar') {
        return {
          getPassword: async (service: string, account: string) => vault.get(`${service}/${account}`) ?? null,
          setPassword: async (service: string, account: string, value: string) => {
            if (failKeytarWrites) throw new Error('keychain unavailable');
            vault.set(`${service}/${account}`, value);
          },
          deletePassword: async (service: string, account: string) => vault.delete(`${service}/${account}`),
        };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    const store = await import('../../../src/main/mcp/store');
    await store.setConnection('google', { enabled: true, values: { GOOGLE_REFRESH_TOKEN: 'google-old' } });
    await store.setConnection('slack', { enabled: true, values: { SLACK_BOT_TOKEN: 'slack-token' } });

    failKeytarWrites = true;
    await expect(store.setConnection('reddit', { enabled: true, values: { REDDIT_REFRESH_TOKEN: 'reddit-token' } })).rejects.toThrow(/OS credential store/);
    expect((await store.listConnections()).map((connection) => connection.id)).toEqual(['google', 'slack']);
    failKeytarWrites = false;

    await store.setConnection('reddit', { enabled: true, values: { REDDIT_REFRESH_TOKEN: 'reddit-old', REDDIT_USERNAME: 'user' } });
    await store.setConnection('reddit', { values: { REDDIT_REFRESH_TOKEN: 'reddit-new' } });
    expect(await store.listConnections()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'google', values: { GOOGLE_REFRESH_TOKEN: 'google-old' } }),
      expect.objectContaining({ id: 'slack', values: { SLACK_BOT_TOKEN: 'slack-token' } }),
      expect.objectContaining({ id: 'reddit', values: { REDDIT_REFRESH_TOKEN: 'reddit-new', REDDIT_USERNAME: 'user' } }),
    ]));
    moduleRuntime._load = originalLoad;
  });
});

describe('Hugging Face sign-in', () => {
  it('signs in with the public client document, PKCE, and stores the account', async () => {
    browser = async (auth) => { await redirectBack(auth, { code: 'h-code', state: auth.searchParams.get('state')! }); };
    routes.push([/huggingface\.co\/oauth\/token/, (_u, init) => {
      const body = form(init);
      expect(body.get('client_id')).toBe('https://dexv3-chethan616.web.app/.well-known/oauth-cimd');
      expect(body.get('code_verifier')).toBeTruthy();
      return json({ access_token: 'hf-at', refresh_token: 'hf-rt', expires_in: 3600 });
    }]);
    routes.push([/huggingface\.co\/api\/whoami-v2/, () => json({ name: 'me', fullname: 'Me', avatarUrl: '/avatars/x.svg' })]);
    const { connectHuggingFace, loadHuggingFace } = await import('../../../src/main/accounts/huggingface');
    const account = await connectHuggingFace();
    expect(account).toMatchObject({ username: 'me', kind: 'oauth', picture: 'https://huggingface.co/avatars/x.svg' });
    expect((await loadHuggingFace())?.refreshToken).toBe('hf-rt');
    expect(opened[0].searchParams.get('scope')).toBe('openid profile inference-api');
  });
});

describe('GitHub device flow', () => {
  it('shows the code, survives a network blip while waiting, and connects', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    let polls = 0;
    browser = async () => {};
    routes.push([/github\.com\/login\/device\/code/, () => json({ device_code: 'd', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 })]);
    routes.push([/github\.com\/login\/oauth\/access_token/, () => {
      polls += 1;
      if (polls === 1) return json({ error: 'authorization_pending' });
      if (polls === 2) throw new Error('socket hang up');
      return json({ access_token: 'gho_x' });
    }]);
    routes.push([/api\.github\.com\/user/, () => json({ login: 'octo', name: 'Octo' })]);
    const codes: string[] = [];
    const { connectGitHub } = await import('../../../src/main/accounts/github');
    const done = connectGitHub((c) => codes.push(c.userCode));
    for (let i = 0; i < 4; i += 1) await vi.advanceTimersByTimeAsync(5000);
    await expect(done).resolves.toMatchObject({ token: 'gho_x', login: 'octo' });
    expect(codes).toEqual(['ABCD-1234']);
    expect(clipboardWrites).toContain('ABCD-1234');
    vi.useRealTimers();
  });

  it('a cancel stops the waiting loop', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    routes.push([/github\.com\/login\/device\/code/, () => json({ device_code: 'd', user_code: 'WXYZ-0000', interval: 5, expires_in: 900 })]);
    routes.push([/github\.com\/login\/oauth\/access_token/, () => json({ error: 'authorization_pending' })]);
    const { connectGitHub, cancelGitHub } = await import('../../../src/main/accounts/github');
    const done = connectGitHub(() => {});
    const caught = done.catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(5000);
    cancelGitHub();
    await vi.advanceTimersByTimeAsync(5000);
    expect(String(await caught)).toMatch(/cancelled/);
    vi.useRealTimers();
  });
});

describe('loopback page', () => {
  it('never puts the callback’s text into the page unescaped', async () => {
    const { startLoopback } = await import('../../../src/main/accounts/loopback');
    const lb = await startLoopback({ providerName: 'Test' });
    const url = new URL(lb.redirectUri);
    url.searchParams.set('error', '<script>alert(1)</script>');
    const html = await (await realFetch(url)).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    await lb.wait;
  });
});
