#!/usr/bin/env node
/**
 * DEX's built-in Discord MCP server.
 *
 * One "Continue with Discord" in Connectors gives every engine:
 *   who the user is, the servers they're in, and posting to the channels they
 *   picked for DEX (each one a webhook Discord made on its consent screen).
 *
 * Discord gives sign-in apps no access to read messages, so there are no
 * read tools: post, edit or delete DEX's own posts, and list servers.
 *
 * Credentials come through env:
 *   DISCORD_ACCESS_TOKEN  the user's OAuth token (identify, guilds); DEX keeps it fresh
 *   DISCORD_CHANNELS      JSON: [{ id, token, channelId, guildId, label }]
 *
 * Protocol: MCP over stdio, newline-delimited JSON-RPC 2.0.
 * No external dependencies — runs from inside app.asar with Node's stdlib.
 */

import { createInterface } from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'dex-discord', version: '1.0.0' };
const API = 'https://discord.com/api/v10';
const MAX_TEXT = 2000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const ACCESS_TOKEN = process.env.DISCORD_ACCESS_TOKEN ?? '';

function log(...args) {
  process.stderr.write(`[dex-discord] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`);
}

function channels() {
  try {
    const list = JSON.parse(process.env.DISCORD_CHANNELS || '[]');
    return Array.isArray(list) ? list.filter((c) => c && c.id && c.token && c.channelId) : [];
  } catch {
    return [];
  }
}

/** A channel by its label (or part of it), its channel id, or the only one there is. */
function pickChannel(which) {
  const all = channels();
  if (!all.length) throw new Error('DEX has no Discord channel to post to yet. Ask the user to add one: Connectors › Discord › Add a channel.');
  if (!which) {
    if (all.length === 1) return all[0];
    throw new Error(`Say which channel: ${all.map((c) => `"${c.label}"`).join(', ')}.`);
  }
  const q = String(which).trim().toLowerCase().replace(/^#/, '');
  const hit = all.find((c) => c.channelId === q) ?? all.find((c) => c.label.toLowerCase() === q) ?? all.find((c) => c.label.toLowerCase().includes(q));
  if (!hit) throw new Error(`No channel "${which}". DEX can post to: ${all.map((c) => `"${c.label}"`).join(', ')}. The user adds more in Connectors › Discord.`);
  return hit;
}

async function call(method, url, { token, json, form } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const headers = { 'user-agent': 'DEX (https://github.com/Chethan616/Dex, 1)' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (json) headers['content-type'] = 'application/json';
    const res = await fetch(url.startsWith('http') ? url : `${API}${url}`, { method, headers, body: json ? JSON.stringify(json) : form });
    if (res.status === 429) {
      const wait = Number((await res.json().catch(() => ({}))).retry_after ?? 1);
      await new Promise((r) => setTimeout(r, Math.min(wait, 10) * 1000));
      continue;
    }
    if (res.status === 204) return null;
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('The Discord connection expired. Ask the user to reconnect it in Connectors › Discord.');
    if (res.status === 404 && url.includes('/webhooks/')) throw new Error('That channel was removed from DEX (its webhook is gone). Ask the user to add it again in Connectors › Discord.');
    if (!res.ok) throw new Error(`Discord said: ${body.message ?? `HTTP ${res.status}`}`);
    return body;
  }
  throw new Error('Discord is rate-limiting; try again in a minute.');
}

function user() {
  if (!ACCESS_TOKEN) throw new Error('Discord is not connected. Ask the user to connect it: Connectors › Discord.');
  return ACCESS_TOKEN;
}

/** Long text as several posts, split at paragraphs, then lines. */
function chunks(text) {
  const out = [];
  let rest = String(text ?? '').trim();
  while (rest.length > MAX_TEXT && out.length < 9) {
    let cut = rest.lastIndexOf('\n\n', MAX_TEXT);
    if (cut < MAX_TEXT / 2) cut = rest.lastIndexOf('\n', MAX_TEXT);
    if (cut < MAX_TEXT / 2) cut = rest.lastIndexOf(' ', MAX_TEXT);
    if (cut < MAX_TEXT / 2) cut = MAX_TEXT;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest.slice(0, MAX_TEXT));
  return out;
}

const link = (c, messageId) => `https://discord.com/channels/${c.guildId}/${c.channelId}/${messageId}`;

function embedOf(args) {
  if (!args.title && !args.description && !args.fields?.length && !args.image_url) return null;
  const e = {};
  if (args.title) e.title = String(args.title).slice(0, 256);
  if (args.url) e.url = String(args.url);
  if (args.description) e.description = String(args.description).slice(0, 4096);
  if (args.color) {
    const hex = String(args.color).replace(/^#/, '');
    if (/^[0-9a-f]{6}$/i.test(hex)) e.color = parseInt(hex, 16);
  }
  if (Array.isArray(args.fields)) e.fields = args.fields.slice(0, 25).map((f) => ({ name: String(f?.name ?? '').slice(0, 256) || '—', value: String(f?.value ?? '').slice(0, 1024) || '—', inline: Boolean(f?.inline) }));
  if (args.image_url) e.image = { url: String(args.image_url) };
  return e;
}

/* ── Tools ────────────────────────────────────────────────────────────── */

const TOOLS = [
  {
    name: 'discord_me',
    description: 'Who the user is on Discord (username, display name).',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const me = await call('GET', '/users/@me', { token: user() });
      return { username: me.username, display_name: me.global_name ?? me.username, id: me.id };
    },
  },
  {
    name: 'discord_servers',
    description: 'The Discord servers the user is in: name, id, whether they own it, and member counts. (Reading channels or messages isn\'t possible through Discord sign-in.)',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const list = await call('GET', '/users/@me/guilds?with_counts=true', { token: user() });
      return list.map((g) => ({ name: g.name, id: g.id, owner: Boolean(g.owner), members: g.approximate_member_count, online: g.approximate_presence_count }));
    },
  },
  {
    name: 'discord_channels',
    description: 'The Discord channels DEX may post to — the ones the user picked for DEX. Post with discord_post.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const all = channels();
      if (!all.length) return 'None yet. The user adds one in DEX: Connectors › Discord › Add a channel.';
      return all.map((c) => ({ channel: c.label, server_id: c.guildId, channel_id: c.channelId }));
    },
  },
  {
    name: 'discord_post',
    description: 'Post a message to one of the Discord channels the user picked for DEX (see discord_channels). Text is Discord Markdown; long text goes as several posts. Optionally an embed (title, description, url, color "#5865F2", fields [{name, value, inline}], image_url) and files from this PC (paths, ≤10 MB each). Mentions never ping anyone. Post only what the user asked to post.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'The channel, as discord_channels names it. Optional when there is only one.' },
        content: { type: 'string', description: 'The message text (Discord Markdown).' },
        title: { type: 'string' },
        description: { type: 'string' },
        url: { type: 'string' },
        color: { type: 'string' },
        fields: { type: 'array', items: { type: 'object' } },
        image_url: { type: 'string' },
        files: { type: 'array', items: { type: 'string' }, description: 'Absolute paths of files on this PC to attach.' },
        username: { type: 'string', description: 'Name to post as (default: the webhook\'s, DEX).' },
      },
    },
    run: async (args) => {
      const c = pickChannel(args.channel);
      const parts = args.content ? chunks(args.content) : [];
      const embed = embedOf(args);
      const files = [];
      for (const p of args.files ?? []) {
        const data = await fs.readFile(p).catch(() => { throw new Error(`Can't read ${p}`); });
        if (data.byteLength > MAX_FILE_BYTES) throw new Error(`${path.basename(p)} is ${Math.round(data.byteLength / 1e6)} MB; Discord takes 10 MB.`);
        files.push({ name: path.basename(p), data });
      }
      if (!parts.length && !embed && !files.length) throw new Error('Nothing to post: give content, an embed (title/description) or files.');
      const url = `/webhooks/${c.id}/${c.token}?wait=true`;
      const ids = [];
      const base = { allowed_mentions: { parse: [] }, ...(args.username ? { username: String(args.username).slice(0, 80) } : {}) };
      const last = Math.max(parts.length, 1) - 1;
      for (let i = 0; i <= last; i++) {
        const payload = { ...base, content: parts[i] ?? '', ...(i === last && embed ? { embeds: [embed] } : {}) };
        let msg;
        if (i === last && files.length) {
          const form = new FormData();
          form.set('payload_json', JSON.stringify({ ...payload, attachments: files.map((f, n) => ({ id: n, filename: f.name })) }));
          files.forEach((f, n) => form.set(`files[${n}]`, new Blob([f.data]), f.name));
          msg = await call('POST', url, { form });
        } else {
          msg = await call('POST', url, { json: payload });
        }
        ids.push(msg.id);
      }
      return { posted: true, channel: c.label, messages: ids.map((id) => ({ message_id: id, link: link(c, id) })) };
    },
  },
  {
    name: 'discord_edit',
    description: 'Edit a message DEX posted (its message_id from discord_post).',
    inputSchema: { type: 'object', properties: { channel: { type: 'string' }, message_id: { type: 'string' }, content: { type: 'string' } }, required: ['message_id', 'content'] },
    run: async (args) => {
      const c = pickChannel(args.channel);
      const msg = await call('PATCH', `/webhooks/${c.id}/${c.token}/messages/${args.message_id}`, { json: { content: String(args.content).slice(0, MAX_TEXT), allowed_mentions: { parse: [] } } });
      return { edited: true, link: link(c, msg.id) };
    },
  },
  {
    name: 'discord_delete',
    description: 'Delete a message DEX posted (its message_id from discord_post). Only when the user asks.',
    inputSchema: { type: 'object', properties: { channel: { type: 'string' }, message_id: { type: 'string' } }, required: ['message_id'] },
    run: async (args) => {
      const c = pickChannel(args.channel);
      await call('DELETE', `/webhooks/${c.id}/${c.token}/messages/${args.message_id}`);
      return { deleted: true };
    },
  },
];
const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

function checkArgs(tool, input) {
  const props = tool.inputSchema?.properties ?? {};
  const args = { ...(input ?? {}) };
  const unknown = Object.keys(args).filter((k) => !(k in props));
  if (unknown.length) {
    throw new Error(`${tool.name} has no argument ${unknown.map((k) => `"${k}"`).join(', ')} — it takes: ${Object.keys(props).join(', ') || 'nothing'}. Nothing was done; call it again with the right arguments.`);
  }
  for (const [key, schema] of Object.entries(props)) {
    let v = args[key];
    if (v === undefined || v === null) continue;
    if (schema.type === 'array' && typeof v === 'string') {
      const t = v.trim();
      if (t.startsWith('[')) {
        try { v = JSON.parse(t); } catch { throw new Error(`${key} looks like JSON but doesn't parse: ${t.slice(0, 120)}`); }
      } else v = [v];
    } else if (schema.type === 'array' && !Array.isArray(v)) v = [v];
    args[key] = v;
  }
  const missing = (tool.inputSchema?.required ?? []).filter((k) => args[k] === undefined || args[k] === null || args[k] === '');
  if (missing.length) throw new Error(`${tool.name} needs ${missing.join(', ')}.`);
  return args;
}

/* ── JSON-RPC over stdio ──────────────────────────────────────────────── */

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: 'Discord for the account the user connected in DEX: their servers, and posting to the channels they picked for DEX. It can\'t read messages. Prefer discord_post over driving Discord in the browser.',
      });
    case 'ping':
      return isRequest ? reply(id, {}) : undefined;
    case 'tools/list':
      return reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const tool = TOOL_BY_NAME.get(params?.name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        const result = await tool.run(checkArgs(tool, params?.arguments));
        return reply(id, { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] });
      } catch (err) {
        log('tool.failed', params?.name, err?.message);
        return reply(id, { content: [{ type: 'text', text: `Error: ${err?.message ?? String(err)}` }], isError: true });
      }
    }
    default:
      if (method?.startsWith('notifications/')) return undefined;
      return isRequest ? fail(id, -32601, `Method not found: ${method}`) : undefined;
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return fail(null, -32700, 'Parse error');
  }
  Promise.resolve(handle(msg)).catch((err) => {
    log('handler.crashed', err?.message);
    if (msg?.id !== undefined) fail(msg.id, -32603, err?.message ?? 'Internal error');
  });
});
rl.on('close', () => process.exit(0));
log('ready', { tools: TOOLS.length, connected: Boolean(ACCESS_TOKEN), channels: channels().length });
