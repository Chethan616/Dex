/**
 * What DEX remembers about the user's sites: what they call them, and how to
 * sign in.
 *
 * Two kinds of memory, stored differently on purpose.
 *
 * Aliases — "university portal" → vtop.vit.ac.in — are not secret. They save
 * the user from repeating a URL, and the agent needs the URL in hand to
 * navigate. Those live in `<userData>/memory/sites.json` and can be read back
 * freely.
 *
 * Credentials are secret, and they are handled like a password manager, not
 * like a note. They live in the OS credential store through keytar, one entry
 * per site, never in a plaintext file. And — the part that matters — a stored
 * password is NEVER returned to the agent or written to a transcript. When a
 * login needs one, `fillSecret` types it straight into the focused browser
 * field via the WebContentsView, so the value goes from the keychain to the
 * page and is seen by nothing in between. The agent orchestrates the login; it
 * never handles the password.
 *
 * Everything used to be one keychain entry. Windows caps an entry at 2,560
 * bytes, so somewhere past a dozen sites a save failed — logged, cached for
 * the session, and gone after a restart. `load` moves that entry over once.
 */
import { mainLogger } from '../logger';
import { memoryFile, readJson, writeJson } from './files';

const SITE_SERVICE = 'com.chethan616.dex.sites';
/** The old all-in-one entry, moved to the file and per-site logins on first load. */
const LEGACY_ACCOUNT = 'sites';
const LOGIN = 'login:';
const SITES_FILE = 'sites.json';
/** Well under the 2,560 bytes Windows allows one credential. */
const MAX_LOGIN_BYTES = 2000;

interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
  findCredentials(service: string): Promise<Array<{ account: string; password: string }>>;
}

function getKeytar(): KeytarLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('keytar') as KeytarLike;
  } catch {
    return null;
  }
}

export interface SiteCredential {
  username?: string;
  /** Present only in the store; never leaves this module. */
  password?: string;
}

export interface SiteRecord {
  /** Canonical host, e.g. "vtop.vit.ac.in". The key. */
  host: string;
  /** The full URL to open, if the user gave more than a bare host. */
  url?: string;
  /** Nicknames the user calls it, lowercased: "university portal", "vtop". */
  aliases: string[];
  credential?: SiteCredential;
}

type Store = Record<string, SiteRecord>;

interface SitesFile { version: 1; sites: Record<string, Omit<SiteRecord, 'credential'>> }

/** What may safely cross to the agent: everything except the password. */
export interface SafeSiteRecord {
  host: string;
  url?: string;
  aliases: string[];
  hasUsername: boolean;
  username?: string;
  hasPassword: boolean;
}

let cached: Store | null = null;
let loading: Promise<Store> | null = null;

function hostFromInput(raw: string): string {
  const trimmed = raw.trim().replace(/^@/, '');
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

const hasLogin = (c: SiteCredential | undefined): c is SiteCredential => Boolean(c?.username || c?.password);

function parseCredential(raw: string): SiteCredential | null {
  try {
    const c = JSON.parse(raw) as SiteCredential;
    const out: SiteCredential = {
      username: typeof c.username === 'string' ? c.username : undefined,
      password: typeof c.password === 'string' ? c.password : undefined,
    };
    return hasLogin(out) ? out : null;
  } catch {
    return null;
  }
}

async function load(): Promise<Store> {
  if (cached) return cached;
  if (loading) return loading;
  loading = (async () => {
    const store: Store = {};
    for (const r of Object.values(readJson<SitesFile>(memoryFile(SITES_FILE))?.sites ?? {})) {
      if (!r || typeof r.host !== 'string') continue;
      store[r.host] = {
        host: r.host,
        url: typeof r.url === 'string' ? r.url : undefined,
        aliases: Array.isArray(r.aliases) ? r.aliases.filter((a): a is string => typeof a === 'string') : [],
      };
    }
    const keytar = getKeytar();
    if (!keytar) {
      mainLogger.warn('siteStore.noKeytar');
    } else {
      try {
        for (const { account, password } of await keytar.findCredentials(SITE_SERVICE)) {
          if (!account.startsWith(LOGIN)) continue;
          const host = account.slice(LOGIN.length);
          const credential = parseCredential(password);
          if (credential) store[host] = { ...(store[host] ?? { host, aliases: [] }), credential };
        }
        await moveLegacy(keytar, store);
      } catch (err) {
        mainLogger.warn('siteStore.load.failed', { error: (err as Error).message });
      }
    }
    cached = store;
    return store;
  })().finally(() => { loading = null; });
  return loading;
}

/** The old single entry: its sites into the file, its logins one per site, then it goes. */
async function moveLegacy(keytar: KeytarLike, store: Store): Promise<void> {
  const blob = await keytar.getPassword(SITE_SERVICE, LEGACY_ACCOUNT);
  if (!blob) return;
  let legacy: Store;
  try { legacy = JSON.parse(blob) as Store; } catch { return; } // unreadable: leave it be
  for (const r of Object.values(legacy)) {
    if (!r || typeof r.host !== 'string') continue;
    const mine = store[r.host];
    const credential = mine?.credential ?? (hasLogin(r.credential) ? r.credential : undefined);
    store[r.host] = {
      host: r.host,
      url: mine?.url ?? r.url,
      aliases: [...new Set([...(mine?.aliases ?? []), ...(Array.isArray(r.aliases) ? r.aliases : [])])],
      credential,
    };
    if (!mine?.credential && credential) await keytar.setPassword(SITE_SERVICE, LOGIN + r.host, JSON.stringify(credential));
  }
  writeSites(store);
  await keytar.deletePassword(SITE_SERVICE, LEGACY_ACCOUNT);
  mainLogger.info('siteStore.moved', { sites: Object.keys(legacy).length });
}

/** The file half: hosts, URLs, nicknames. Never a credential. */
function writeSites(store: Store): void {
  const sites: SitesFile['sites'] = {};
  for (const r of Object.values(store)) sites[r.host] = { host: r.host, url: r.url, aliases: r.aliases };
  writeJson(memoryFile(SITES_FILE), { version: 1, sites } satisfies SitesFile);
}

function toSafe(record: SiteRecord): SafeSiteRecord {
  return {
    host: record.host,
    url: record.url,
    aliases: record.aliases,
    hasUsername: Boolean(record.credential?.username),
    username: record.credential?.username,
    hasPassword: Boolean(record.credential?.password),
  };
}

/** Remember a nickname for a site. */
export async function rememberSite(target: string, aliases: string[]): Promise<SafeSiteRecord> {
  const host = hostFromInput(target);
  const url = target.includes('://') ? target.trim() : undefined;
  const store = { ...(await load()) };
  const existing = store[host] ?? { host, aliases: [] };

  const merged = new Set(existing.aliases);
  for (const alias of aliases) {
    const clean = alias.trim().toLowerCase();
    if (clean) merged.add(clean);
  }

  const next: SiteRecord = { ...existing, host, url: url ?? existing.url, aliases: [...merged] };
  store[host] = next;
  writeSites(store);
  cached = store;
  mainLogger.info('siteStore.rememberSite', { host, aliases: next.aliases });
  return toSafe(next);
}

/** Remember a username and/or password for a site. */
export async function rememberLogin(target: string, credential: SiteCredential): Promise<SafeSiteRecord> {
  const host = hostFromInput(target);
  const store = { ...(await load()) };
  const existing = store[host] ?? { host, aliases: [] };
  const next: SiteRecord = {
    ...existing,
    host,
    credential: {
      username: credential.username ?? existing.credential?.username,
      password: credential.password ?? existing.credential?.password,
    },
  };
  const keytar = getKeytar();
  if (!keytar) throw new Error("This PC's credential store isn't available, so DEX can't keep a login here.");
  const blob = JSON.stringify(next.credential);
  if (Buffer.byteLength(blob) > MAX_LOGIN_BYTES) throw new Error('That login is too long to store.');
  await keytar.setPassword(SITE_SERVICE, LOGIN + host, blob);
  store[host] = next;
  writeSites(store);
  cached = store;
  // Key facts only. Never the values — this line goes to a log file.
  mainLogger.info('siteStore.rememberLogin', {
    host,
    hasUsername: Boolean(next.credential?.username),
    hasPassword: Boolean(next.credential?.password),
  });
  return toSafe(next);
}

/**
 * Resolve a nickname or host to a site, for the agent.
 *
 * Matches an exact host, then an exact alias, then a loose contains — so "my
 * uni portal" finds the record aliased "university portal". Returns the safe
 * view; the password never comes back this way.
 */
export async function recallSite(query: string): Promise<SafeSiteRecord | null> {
  const store = await load();
  const q = query.trim().toLowerCase().replace(/^@/, '');
  const records = Object.values(store);

  const host = hostFromInput(query);
  if (store[host]) return toSafe(store[host]);

  const exactAlias = records.find((r) => r.aliases.includes(q));
  if (exactAlias) return toSafe(exactAlias);

  // Loose: the query contains an alias, or an alias contains the query. Covers
  // "open my college portal please" against the alias "college portal".
  const loose = records.find((r) =>
    r.aliases.some((alias) => q.includes(alias) || alias.includes(q)),
  );
  return loose ? toSafe(loose) : null;
}

export async function listSites(): Promise<SafeSiteRecord[]> {
  return Object.values(await load()).map(toSafe);
}

/**
 * The raw secret, for the fill path only.
 *
 * Not exported to any route that returns data to the agent. The only caller is
 * the main-process fill handler, which types it into the page and returns
 * nothing but success.
 */
export async function getSecret(target: string, field: 'username' | 'password'): Promise<string | null> {
  const store = await load();
  const record = store[hostFromInput(target)] ?? (await recallSite(target).then((safe) =>
    safe ? store[safe.host] : undefined,
  ));
  return record?.credential?.[field] ?? null;
}

export async function forgetSite(target: string): Promise<void> {
  const host = hostFromInput(target);
  const store = { ...(await load()) };
  if (store[host]?.credential) await getKeytar()?.deletePassword(SITE_SERVICE, LOGIN + host).catch(() => false);
  delete store[host];
  writeSites(store);
  cached = store;
}

/** Test seam. */
export function _resetCache(): void {
  cached = null;
  loading = null;
}
