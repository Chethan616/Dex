import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CredentialStore } from '../../core/secrets/credential_store';
import { emit } from '../../core/events/bus';
import { McpTool } from './tool_binding';

export interface McpServerSpec {
  key: string;
  label: string;
  command: string;
  args: string[];
  /**
   * Credential-store name → environment variable the server reads it from.
   * The value never touches config.yaml, .env, or a command line; it is
   * decrypted at spawn time and handed to the child process only.
   */
  secrets: Record<string, string>;
  /** Which account the server acts as, when its tools ask. */
  identityCredential?: string;
  identityEnv?: string;
}

interface Connection {
  client: Client;
  transport: StdioClientTransport;
  tools: McpTool[];
  identity?: string;
}

const CONNECT_TIMEOUT_MS = 45_000;

/**
 * Keeps one live MCP server process per service, started on first use.
 *
 * Spawning a Node or Python MCP server costs a second or two and an OAuth
 * handshake; doing that per step would make "check my calendar, then send an
 * email" twice as slow as it needs to be. So servers are started lazily and
 * kept, and torn down with the core.
 */
export class McpPool {
  private connections = new Map<string, Connection>();
  private starting = new Map<string, Promise<Connection>>();

  constructor(
    private specs: Map<string, McpServerSpec>,
    private credentials: CredentialStore,
  ) {}

  knownServers(): string[] {
    return [...this.specs.keys()];
  }

  liveServers(): string[] {
    return [...this.connections.keys()];
  }

  async connection(key: string): Promise<Connection> {
    const existing = this.connections.get(key);
    if (existing) return existing;

    // Two steps in the same wave can both want Gmail. Share one spawn.
    const inFlight = this.starting.get(key);
    if (inFlight) return inFlight;

    const spec = this.specs.get(key);
    if (!spec) {
      throw new Error(
        `Unknown workspace server "${key}" — configured: ${this.knownServers().join(', ') || 'none'}`,
      );
    }

    const promise = this.start(spec).finally(() => this.starting.delete(key));
    this.starting.set(key, promise);
    return promise;
  }

  async tools(key: string): Promise<McpTool[]> {
    return (await this.connection(key)).tools;
  }

  async identity(key: string): Promise<string | undefined> {
    return (await this.connection(key)).identity;
  }

  async callTool(
    key: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: unknown; isError: boolean }> {
    const { client } = await this.connection(key);
    const result = await client.callTool({ name, arguments: args });
    return {
      content: (result as { content?: unknown }).content ?? result,
      isError: Boolean((result as { isError?: boolean }).isError),
    };
  }

  private async start(spec: McpServerSpec): Promise<Connection> {
    const env = this.envFor(spec);

    const transport = new StdioClientTransport({
      command: spec.command,
      args: spec.args,
      env,
      // Inherited stderr would interleave the server's chatter with the Dex
      // Bar's own output and make both unreadable.
      stderr: 'pipe',
    });

    const client = new Client(
      { name: 'dex-workspace', version: '0.1.0' },
      { capabilities: {} },
    );

    const connected = client.connect(transport);
    await withTimeout(
      connected,
      CONNECT_TIMEOUT_MS,
      `${spec.label} did not finish its MCP handshake within ${CONNECT_TIMEOUT_MS / 1000}s`,
    );

    transport.stderr?.on('data', (chunk: Buffer) => {
      if (process.env.DEX_DEBUG === 'true') {
        process.stderr.write(`[${spec.key}] ${chunk.toString('utf8')}`);
      }
    });

    const listed = await withTimeout(
      client.listTools(),
      CONNECT_TIMEOUT_MS,
      `${spec.label} never answered tools/list`,
    );

    const tools = (listed.tools ?? []) as McpTool[];

    const connection: Connection = {
      client,
      transport,
      tools,
      identity: spec.identityCredential
        ? this.credentials.resolve(spec.identityCredential, spec.identityEnv)
        : undefined,
    };

    this.connections.set(spec.key, connection);
    return connection;
  }

  private envFor(spec: McpServerSpec): Record<string, string> {
    // Start from a narrow base rather than all of process.env: an MCP server
    // has no business inheriting DEX's own ANTHROPIC_API_KEY or daemon paths.
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      SystemRoot: process.env.SystemRoot ?? '',
      TEMP: process.env.TEMP ?? '',
      TMP: process.env.TMP ?? '',
      APPDATA: process.env.APPDATA ?? '',
      LOCALAPPDATA: process.env.LOCALAPPDATA ?? '',
      USERPROFILE: process.env.USERPROFILE ?? '',
      HOME: process.env.HOME ?? process.env.USERPROFILE ?? '',
    };

    const missing: string[] = [];
    for (const [credential, variable] of Object.entries(spec.secrets)) {
      const value = this.credentials.resolve(credential, variable);
      if (value) env[variable] = value;
      else missing.push(credential);
    }

    if (missing.length > 0) {
      // Not fatal here — some servers only need credentials for a subset of
      // their tools, and the server itself gives the better error. But say it
      // once, plainly, with the command that fixes it.
      emit(
        'routing',
        `${spec.label}: no stored credential for ${missing.join(', ')} — ` +
          `set with: npm run cred -- set ${missing[0]}`,
        'workspace',
      );
    }

    return env;
  }

  async close(): Promise<void> {
    for (const [key, connection] of this.connections) {
      try {
        await connection.client.close();
      } catch {
        // Best effort; the transport kill below is what actually matters.
      }
      try {
        await connection.transport.close();
      } catch {
        /* already gone */
      }
      this.connections.delete(key);
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
