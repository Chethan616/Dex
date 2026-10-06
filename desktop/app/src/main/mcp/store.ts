/**
 * Which MCP connections are switched on, and the credentials they need.
 *
 * Credentials go to the OS credential store through keytar, the same place the
 * engine API keys live. They are API tokens with real access to the user's
 * mail, files and repositories; writing them into a JSON file in userData
 * would be the wrong default even though the generated mcp.json ends up
 * holding them at spawn time.
 *
 * Enabled/disabled state is kept in the same blob rather than in settings,
 * so a connection and its secret can never disagree about whether it exists.
 */
import { mainLogger } from '../logger';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);

const MCP_SERVICE = 'com.chethan616.dex.mcp';
const ACCOUNT = 'connections';

interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

function getKeytar(): KeytarLike | null {
  try {
    return nodeRequire('keytar') as KeytarLike;
  } catch {
    return null;
  }
}

export interface McpConnection {
  id: string;
  enabled: boolean;
  values: Record<string, string>;
  /** Tool names from the last successful verification, for the prompt. */
  toolNames?: string[];
  /** Account the credential belongs to, e.g. a GitHub login. */
  identity?: string;
}

type Store = Record<string, McpConnection>;

let cached: Store | null = null;
let loading: Promise<Store> | null = null;

async function load(): Promise<Store> {
  if (cached) return cached;
  if (loading) return loading;

  loading = (async () => {
    const keytar = getKeytar();
    if (!keytar) {
      // No credential store (Linux without libsecret, or a locked keychain).
      // Connections simply stay off rather than the app failing to start.
      mainLogger.warn('mcp.store.noKeytar');
      cached = {};
      return cached;
    }
    try {
      const blob = await keytar.getPassword(MCP_SERVICE, ACCOUNT);
      cached = blob ? (JSON.parse(blob) as Store) : {};
    } catch (err) {
      mainLogger.warn('mcp.store.load.failed', { error: (err as Error).message });
      cached = {};
    }
    return cached;
  })().finally(() => {
    loading = null;
  });

  return loading;
}

async function persist(store: Store): Promise<void> {
  const keytar = getKeytar();
  if (!keytar) throw new Error('The OS credential store is unavailable. Connect a credential store before saving MCP accounts.');
  try {
    await keytar.setPassword(MCP_SERVICE, ACCOUNT, JSON.stringify(store));
    // Publish only after the OS keychain confirms the write. A failed write
    // must not look connected for the remainder of this process.
    cached = store;
  } catch (err) {
    mainLogger.error('mcp.store.save.failed', { error: (err as Error).message });
    throw new Error('Could not save the connection in the OS credential store.', { cause: err });
  }
}

export async function listConnections(): Promise<McpConnection[]> {
  return Object.values(await load());
}

/** Enabled connections, in the shape config.ts wants. */
export async function enabledConnections(): Promise<
  Array<{ id: string; values: Record<string, string>; toolNames?: string[]; identity?: string }>
> {
  const store = await load();
  return Object.values(store)
    .filter((connection) => connection.enabled)
    .map(({ id, values, toolNames, identity }) => ({ id, values, toolNames, identity }));
}

export async function setConnection(
  id: string,
  patch: { enabled?: boolean; values?: Record<string, string>; toolNames?: string[]; identity?: string },
): Promise<McpConnection> {
  const store = { ...(await load()) };
  const existing = store[id] ?? { id, enabled: false, values: {} };
  const next: McpConnection = {
    id,
    enabled: patch.enabled ?? existing.enabled,
    // Merge rather than replace, so saving one field does not wipe the others
    // — and so an empty string can still clear a single credential explicitly.
    values: patch.values ? { ...existing.values, ...patch.values } : existing.values,
    toolNames: patch.toolNames ?? existing.toolNames,
    identity: patch.identity ?? existing.identity,
  };
  store[id] = next;
  await persist(store);
  mainLogger.info('mcp.store.set', {
    id,
    enabled: next.enabled,
    // Key names only. The values are tokens.
    credentials: Object.keys(next.values),
  });
  return next;
}

export async function removeConnection(id: string): Promise<void> {
  const store = { ...(await load()) };
  delete store[id];
  await persist(store);
  mainLogger.info('mcp.store.removed', { id });
}
