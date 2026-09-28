/**
 * A one-shot MCP tool call, for the one place main needs to reach a connected
 * server itself rather than leaving it to the spawned engine: `@drive`
 * search, which runs the local file index and Google Drive concurrently so
 * tagging a query costs one round trip, not two turns.
 *
 * Deliberately not a persistent connection, same reasoning as client.ts's
 * verifyServer: spin the server up, ask the one question, get out. A
 * long-lived pool is not worth the complexity for a call this infrequent.
 */
import { spawn } from 'node:child_process';
import { mainLogger } from '../logger';
import { launchSpec, type McpServerDefinition } from './catalog';

export interface McpToolCallResult {
  ok: boolean;
  /** Concatenated text content from the tool result, when it succeeded. */
  text?: string;
  error?: string;
}

const CALL_TIMEOUT_MS = 20_000;

export function callServerTool(
  definition: McpServerDefinition,
  values: Record<string, string>,
  toolName: string,
  toolArgs: Record<string, unknown>,
): Promise<McpToolCallResult> {
  return new Promise((resolve) => {
    let settled = false;
    let buffer = '';

    const finish = (result: McpToolCallResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // Already gone.
      }
      if (!result.ok) {
        mainLogger.warn('mcp.toolCall.failed', { id: definition.id, tool: toolName, error: result.error });
      }
      resolve(result);
    };

    const launch = launchSpec(definition, values);
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(launch.command, launch.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...launch.env },
        // npx is a shell script on Windows; without a shell the spawn fails
        // with ENOENT. Built-in servers are a plain .exe and must not get one.
        shell: launch.shell,
        windowsHide: true,
      });
    } catch (err) {
      resolve({ ok: false, error: (err as Error).message });
      return;
    }

    const timer = setTimeout(() => {
      finish({ ok: false, error: `${definition.displayName} did not respond in time.` });
    }, CALL_TIMEOUT_MS);

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
          continue;
        }

        if (message.id === 1) {
          if (message.error) {
            finish({ ok: false, error: message.error.message ?? 'initialize was rejected' });
            return;
          }
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: toolName, arguments: toolArgs } });
        }

        if (message.id === 2) {
          if (message.error) {
            finish({ ok: false, error: message.error.message ?? `${toolName} failed` });
            return;
          }
          const content = (message.result?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
          const text = content
            .filter((block) => block.type === 'text' && typeof block.text === 'string')
            .map((block) => block.text as string)
            .join('\n');
          finish({ ok: true, text });
        }
      }
    });

    child.on('error', (err) => finish({ ok: false, error: err.message }));
    child.on('exit', (code) => finish({ ok: false, error: `server exited before responding (code ${code ?? 'unknown'})` }));

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'dex', version: '1.0.0' } },
    });
  });
}
