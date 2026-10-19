/**
 * mcp-servers/discord: DEX's Discord MCP server, run for real over stdio —
 * its tools, the channels it may post to, and the plain answers it gives
 * when something is missing. (Calls that reach Discord aren't made here.)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { afterEach, describe, expect, it } from 'vitest';

const SERVER = path.resolve(__dirname, '../../../mcp-servers/discord/server.mjs');
let child: ChildProcess | null = null;

interface RpcReply { result: { tools?: Array<{ name: string }>; content?: Array<{ text: string }>; isError?: boolean } }

function start(env: Record<string, string>) {
  child = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map<number, (v: RpcReply) => void>();
  createInterface({ input: child.stdout! }).on('line', (line) => {
    const msg = JSON.parse(line) as RpcReply & { id: number };
    pending.get(msg.id)?.(msg);
  });
  let n = 0;
  return (method: string, params: unknown = {}) => new Promise<RpcReply>((resolve) => {
    const id = ++n;
    pending.set(id, resolve);
    child!.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

afterEach(() => { child?.kill(); child = null; });

const text = (r: RpcReply) => r.result.content?.[0].text ?? '';

describe('the Discord MCP server', () => {
  it('lists its tools: no reading, only servers and posting', async () => {
    const rpc = start({ DISCORD_ACCESS_TOKEN: 'x', DISCORD_CHANNELS: '[]' });
    await rpc('initialize', { protocolVersion: '2025-06-18' });
    const tools = (await rpc('tools/list')).result.tools?.map((t) => t.name);
    expect(tools).toEqual(['discord_me', 'discord_servers', 'discord_channels', 'discord_post', 'discord_edit', 'discord_delete']);
  });

  it('names the channels it may post to, without their webhook tokens', async () => {
    const rpc = start({ DISCORD_CHANNELS: JSON.stringify([{ id: '900', token: 'wh-secret', channelId: '901', guildId: '42', label: 'Study Group' }]) });
    const r = await rpc('tools/call', { name: 'discord_channels', arguments: {} });
    expect(JSON.parse(text(r))).toEqual([{ channel: 'Study Group', server_id: '42', channel_id: '901' }]);
    expect(text(r)).not.toContain('wh-secret');
  });

  it('says where to add a channel when there is none, and which to pick when there are several', async () => {
    let rpc = start({ DISCORD_CHANNELS: '[]' });
    let r = await rpc('tools/call', { name: 'discord_post', arguments: { content: 'hi' } });
    expect(r.result.isError).toBe(true);
    expect(text(r)).toMatch(/Connectors › Discord › Add a channel/);
    child?.kill();
    rpc = start({ DISCORD_CHANNELS: JSON.stringify([
      { id: '1', token: 'a', channelId: '11', guildId: '42', label: 'Study Group' },
      { id: '2', token: 'b', channelId: '22', guildId: '42', label: 'Study Group (2)' },
    ]) });
    r = await rpc('tools/call', { name: 'discord_post', arguments: { content: 'hi' } });
    expect(text(r)).toMatch(/Say which channel: "Study Group", "Study Group \(2\)"/);
    r = await rpc('tools/call', { name: 'discord_post', arguments: { channel: 'homework', content: 'hi' } });
    expect(text(r)).toMatch(/No channel "homework"/);
  });

  it('without a sign-in, says to connect Discord', async () => {
    const rpc = start({ DISCORD_ACCESS_TOKEN: '' });
    const r = await rpc('tools/call', { name: 'discord_servers', arguments: {} });
    expect(text(r)).toMatch(/Discord is not connected/);
  });
});
