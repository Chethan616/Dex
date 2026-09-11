/**
 * A minimal MCP client, used to prove a connection actually works.
 *
 * Settings previously showed a connection as good once its credentials were
 * *present*, which is not the same thing as working: a mistyped token looks
 * identical to a correct one until a task fails halfway through. So this
 * starts the server exactly as the generated config describes and runs the
 * real handshake — initialize, then tools/list. Anything short of a tool list
 * is a failure, because a server that connects but exposes nothing is no use
 * to the agent either.
 *
 * Deliberately not a persistent connection. The engine spawns its own servers;
 * this exists to answer one question, once, and then get out of the way.
 */
import { spawn } from 'node:child_process';
import { mainLogger } from '../logger';
import type { McpServerDefinition } from './catalog';

export interface McpVerifyResult {
  ok: boolean;
  /** Server's self-reported name, when it got far enough to say. */
  serverName?: string;
  toolCount?: number;
  /**
   * Bare tool names as the server reports them, e.g. `list_issues`.
   *
   * Kept because the engine defers tools it has not used yet, and the agent
   * has to go looking. Searching "github" returned an unrelated tool and it
   * gave up and drove the website instead — so the prompt names the tools
   * outright rather than trusting discovery.
   */
  toolNames?: string[];
  error?: string;
}

/**
 * First run downloads the server package through npx, which on a cold cache
 * is slow enough that a short timeout would report a working connection as
 * broken. Later runs are a couple of seconds.
 */
const VERIFY_TIMEOUT_MS = 60_000;

export function verifyServer(
  definition: McpServerDefinition,
  values: Record<string, string>,
): Promise<McpVerifyResult> {
  return new Promise((resolve) => {
    let settled = false;
    let buffer = '';
    let stderr = '';
    let serverName: string | undefined;

    const finish = (result: McpVerifyResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // Already gone.
      }
      mainLogger.info('mcp.verify.result', {
        id: definition.id,
        ok: result.ok,
        toolCount: result.toolCount,
        // Never the credentials, and never raw stderr, which can echo a token
        // back in an auth error.
        error: result.error?.slice(0, 200),
      });
      resolve(result);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(definition.command, definition.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...definition.env, ...values },
        // npx is a shell script on Windows; without this the spawn fails with
        // ENOENT even though it works fine from a terminal.
        shell: process.platform === 'win32',
        windowsHide: true,
      });
    } catch (err) {
      resolve({ ok: false, error: (err as Error).message });
      return;
    }

    const timer = setTimeout(() => {
      finish({
        ok: false,
        error: `The server did not respond within ${Math.round(VERIFY_TIMEOUT_MS / 1000)}s.`,
      });
    }, VERIFY_TIMEOUT_MS);

    const send = (message: unknown): void => {
      try {
        child.stdin?.write(`${JSON.stringify(message)}\n`);
      } catch {
        // The exit handler reports it.
      }
    };

    child.stdout?.setEncoding('utf-8');
    child.stdout?.on('data', (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\n');
        if (!line) continue;

        let message: { id?: number; result?: Record<string, unknown>; error?: { message?: string } };
        try {
          message = JSON.parse(line);
        } catch {
          // Servers sometimes log plain text to stdout; ignore non-JSON.
          continue;
        }

        if (message.id === 1) {
          if (message.error) {
            finish({ ok: false, error: message.error.message ?? 'initialize was rejected' });
            return;
          }
          const info = message.result?.serverInfo as { name?: string } | undefined;
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
          // Remember the name for the success message below.
          serverName = info?.name;
        }

        if (message.id === 2) {
          if (message.error) {
            finish({ ok: false, error: message.error.message ?? 'the server exposed no tools' });
            return;
          }
          const tools = (message.result?.tools as Array<{ name?: string }> | undefined) ?? [];
          const toolNames = tools
            .map((tool) => tool?.name)
            .filter((name): name is string => typeof name === 'string');
          finish({
            ok: tools.length > 0,
            serverName,
            toolCount: tools.length,
            toolNames,
            error: tools.length > 0 ? undefined : 'The server started but exposed no tools.',
          });
          return;
        }
      }
    });

    child.stderr?.setEncoding('utf-8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (err) => {
      finish({ ok: false, error: err.message });
    });

    child.on('exit', (code) => {
      // Only meaningful if we never completed the handshake.
      finish({
        ok: false,
        error: summariseStartupFailure(stderr, code),
      });
    });

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'dex', version: '1.0.0' },
      },
    });
  });
}

/**
 * Turn a wall of npm noise into one line a person can act on.
 *
 * Raw stderr here is mostly deprecation warnings, and can contain the token
 * itself in an auth error — neither belongs in the UI.
 */
function summariseStartupFailure(stderr: string, code: number | null): string {
  const text = stderr.toLowerCase();
  // Observed from @modelcontextprotocol/server-gdrive, which needs a separate
  // one-off OAuth run before a credentials path means anything. Without this
  // the user gets "exit code 1" for a problem with a specific remedy.
  if (text.includes('credentials not found') || text.includes("run with 'auth'")) {
    return 'The server needs a one-off sign-in before it can be used. Run its auth step, then re-check.';
  }
  if (text.includes('401') || text.includes('unauthorized') || text.includes('bad credentials')) {
    return 'The credential was rejected. Check the token and try again.';
  }
  if (text.includes('403') || text.includes('forbidden')) {
    return 'The credential is valid but lacks permission for this account.';
  }
  if (text.includes('enotfound') || text.includes('getaddrinfo') || text.includes('network')) {
    return 'Could not reach the network to start the server.';
  }
  if (text.includes('404') || text.includes('e404')) {
    return 'The server package could not be downloaded.';
  }
  return `The server stopped before connecting (exit code ${code ?? 'unknown'}).`;
}
