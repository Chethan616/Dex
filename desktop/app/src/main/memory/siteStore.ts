/**
 * What DEX remembers about the user's sites: what they call them, and how to
 * sign in.
 *
 * Two kinds of memory, stored differently on purpose.
 *
 * Aliases — "university portal" → vtop.vit.ac.in — are not secret. They save
 * the user from repeating a URL, and the agent needs the URL in hand to
 * navigate. Those can be read back freely.
 *
 * Credentials are secret, and they are handled like a password manager, not
 * like a note. They live in the OS credential store through keytar, never in a
 * plaintext file. And — the part that matters — a stored password is NEVER
 * returned to the agent or written to a transcript. When a login needs one,
 * `fillSecret` types it straight into the focused browser field via the
 * WebContentsView, so the value goes from the keychain to the page and is seen
 * by nothing in between. The agent orchestrates the login; it never handles
 * the password.
 */
import { mainLogger } from '../logger';

const SITE_SERVICE = 'com.chethan616.dex.sites';
const ACCOUNT = 'sites';

interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
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

async function load(): Promise<Store> {
  if (cached) return cached;
  if (loading) return loading;
  loading = (async () => {
    const keytar = getKeytar();
    if (!keytar) {
      mainLogger.warn('siteStore.noKeytar');
      cached = {};
      return cached;
    }
    try {
      const blob = await keytar.getPassword(SITE_SERVICE, ACCOUNT);
      cached = blob ? (JSON.parse(blob) as Store) : {};
    } catch (err) {
      mainLogger.warn('siteStore.load.failed', { error: (err as Error).message });
      cached = {};
    }
    return cached;
  })().finally(() => { loading = null; });
  return loading;
}

async function persist(store: Store): Promise<void> {
  cached = store;
  const keytar = getKeytar();
  if (!keytar) return;
  try {
    await keytar.setPassword(SITE_SERVICE, ACCOUNT, JSON.stringify(store));
  } catch (err) {
    mainLogger.error('siteStore.save.failed', { error: (err as Error).message });
  }
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
  await persist(store);
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
  store[host] = next;
  await persist(store);
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
  const store = { ...(await load()) };
  delete store[hostFromInput(target)];
  await persist(store);
}

/** Test seam. */
export function _resetCache(): void {
  cached = null;
  loading = null;
}
