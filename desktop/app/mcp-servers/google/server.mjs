#!/usr/bin/env node
/**
 * DEX's built-in Google MCP server.
 *
 * One "Connect with Google" in Settings gives every engine Gmail, Calendar,
 * Meet, Drive, Docs, Sheets, Contacts and Tasks — no credential files, no
 * paths, no Cloud Console JSON. DEX runs this script with Electron's bundled
 * Node (ELECTRON_RUN_AS_NODE=1) and passes the account through env:
 *
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET  the OAuth client DEX signed in with
 *   GOOGLE_REFRESH_TOKEN                     the account's long-lived grant
 *
 * The protocol is MCP over stdio: newline-delimited JSON-RPC 2.0. It's small
 * enough to speak directly, which keeps this file dependency-free — it has to
 * run from inside app.asar with nothing but Node's standard library.
 *
 * Nothing here writes to stdout except protocol messages; logs go to stderr.
 */

import { createInterface } from 'node:readline';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'dex-google', version: '1.0.0' };

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN ?? '';

function log(...args) {
  process.stderr.write(`[dex-google] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`);
}

/* ── Auth ─────────────────────────────────────────────────────────────── */

let accessToken = '';
let accessTokenExpiresAt = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < accessTokenExpiresAt - 60_000) return accessToken;
  if (!CLIENT_ID || !REFRESH_TOKEN) {
    throw new Error('Google is not connected. Open DEX Settings → Accounts → Continue with Google.');
  }
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    refresh_token: REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  if (CLIENT_SECRET) body.set('client_secret', CLIENT_SECRET);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    const reason = json.error_description || json.error || `HTTP ${res.status}`;
    if (json.error === 'invalid_grant') {
      throw new Error('The Google connection has expired or was revoked. Reconnect in DEX Settings → Accounts.');
    }
    throw new Error(`Could not refresh Google access: ${reason}`);
  }
  accessToken = json.access_token;
  accessTokenExpiresAt = Date.now() + (Number(json.expires_in) || 3600) * 1000;
  return accessToken;
}

async function google(method, url, { query, body, raw, headers } = {}) {
  const token = await getAccessToken();
  const u = new URL(url);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v)) v.forEach((item) => u.searchParams.append(k, String(item)));
      else u.searchParams.set(k, String(v));
    }
  }
  const init = { method, headers: { authorization: `Bearer ${token}`, ...(headers ?? {}) } };
  if (body !== undefined) {
    if (raw) {
      init.body = body;
    } else {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }
  const res = await fetch(u, init);
  if (res.status === 204) return {};
  const type = res.headers.get('content-type') ?? '';
  const payload = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const message = typeof payload === 'object' ? payload?.error?.message ?? JSON.stringify(payload) : payload;
    throw new Error(`${method} ${u.pathname} failed (${res.status}): ${String(message).slice(0, 500)}`);
  }
  return payload;
}

/** Like google(), for file bytes (Drive downloads and exports). */
async function googleBytes(url, query) {
  const token = await getAccessToken();
  const u = new URL(url);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  }
  const res = await fetch(u, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = text;
    try { message = JSON.parse(text)?.error?.message ?? text; } catch { /* not JSON */ }
    throw new Error(`GET ${u.pathname} failed (${res.status}): ${String(message).slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

function b64urlEncode(text) {
  return Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(data) {
  return Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function header(headers, name) {
  const h = (headers ?? []).find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? '';
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function messageBody(payload) {
  let plain = '';
  let html = '';
  const walk = (part) => {
    if (!part) return;
    if (part.mimeType === 'text/plain' && part.body?.data && !plain) plain = b64urlDecode(part.body.data);
    else if (part.mimeType === 'text/html' && part.body?.data && !html) html = b64urlDecode(part.body.data);
    (part.parts ?? []).forEach(walk);
  };
  walk(payload);
  return plain || (html ? stripHtml(html) : '');
}

function attachmentsOf(payload) {
  const out = [];
  const walk = (part) => {
    if (!part) return;
    if (part.filename && part.body?.attachmentId) out.push({ filename: part.filename, mimeType: part.mimeType, size: part.body.size });
    (part.parts ?? []).forEach(walk);
  };
  walk(payload);
  return out;
}

/** base64 in 76-character lines, as MIME wants it. */
function base64Lines(buf) {
  return buf.toString('base64').replace(/.{1,76}/g, '$&\r\n').trimEnd();
}

/** A header-safe filename, plus the RFC 2231 form for anything non-ASCII. */
function filenameParams(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return /^[\x20-\x7e]*$/.test(name) ? `filename="${ascii}"` : `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function mimeMessage({ to, cc, bcc, subject, body, html, inReplyTo, references, attachments = [] }) {
  const lines = [];
  if (to) lines.push(`To: ${[].concat(to).join(', ')}`);
  if (cc) lines.push(`Cc: ${[].concat(cc).join(', ')}`);
  if (bcc) lines.push(`Bcc: ${[].concat(bcc).join(', ')}`);
  lines.push(`Subject: =?UTF-8?B?${Buffer.from(subject ?? '', 'utf8').toString('base64')}?=`);
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push('MIME-Version: 1.0');
  const textType = `Content-Type: ${html ? 'text/html' : 'text/plain'}; charset="UTF-8"`;
  if (attachments.length === 0) {
    lines.push(textType);
    lines.push('Content-Transfer-Encoding: 8bit');
    lines.push('');
    lines.push(body ?? '');
    return lines.join('\r\n');
  }
  const boundary = `dex-mixed-${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  lines.push('');
  lines.push(`--${boundary}`);
  lines.push(textType);
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');
  lines.push(base64Lines(Buffer.from(body ?? '', 'utf8')));
  for (const a of attachments) {
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: ${a.mimeType}; name="${a.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}"`);
    lines.push(`Content-Disposition: attachment; ${filenameParams(a.filename)}`);
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(base64Lines(a.data));
  }
  lines.push(`--${boundary}--`);
  return lines.join('\r\n');
}

/* ── Files: Drive and this PC ─────────────────────────────────────────── */

const GMAIL_LIMIT_BYTES = 25 * 1024 * 1024;

const EXT_MIME = {
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', html: 'text/html', json: 'application/json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  mp4: 'video/mp4', mp3: 'audio/mpeg', zip: 'application/zip',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function mimeForName(name) {
  return EXT_MIME[path.extname(name).slice(1).toLowerCase()] ?? 'application/octet-stream';
}

/** Google Docs/Sheets/Slides/Drawings have no bytes of their own: they're exported. */
const EXPORT_FILE = {
  'application/vnd.google-apps.document': { default: 'pdf', formats: ['pdf', 'docx', 'txt', 'html', 'md'] },
  'application/vnd.google-apps.spreadsheet': { default: 'xlsx', formats: ['xlsx', 'pdf', 'csv'] },
  'application/vnd.google-apps.presentation': { default: 'pdf', formats: ['pdf', 'pptx', 'txt'] },
  'application/vnd.google-apps.drawing': { default: 'pdf', formats: ['pdf', 'png', 'svg', 'jpg'] },
};
const EXPORT_MIME = { ...EXT_MIME, md: 'text/markdown' };

/** Agents hand over Windows paths, Git-Bash paths (/c/Users/…), ~, and file:// URLs alike. */
function localPath(p) {
  let v = String(p).trim().replace(/^["']|["']$/g, '');
  if (v.startsWith('file://')) v = decodeURIComponent(new URL(v).pathname).replace(/^\/([A-Za-z]:)/, '$1');
  if (v === '~' || v.startsWith('~/') || v.startsWith('~\\')) v = path.join(process.env.DEX_HOME_DIR || os.homedir(), v.slice(1));
  if (process.platform === 'win32') {
    const msys = /^\/([a-zA-Z])(?:\/(.*))?$/.exec(v);
    if (msys) v = `${msys[1].toUpperCase()}:\\${(msys[2] ?? '').replace(/\//g, '\\')}`;
  }
  return path.resolve(v);
}

/** A Drive id from an id, or from any drive.google.com / docs.google.com link. */
function driveIdFrom(value) {
  const v = String(value).trim();
  const m = /\/d\/([A-Za-z0-9_-]{10,})/.exec(v) ?? /[?&]id=([A-Za-z0-9_-]{10,})/.exec(v);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{15,}$/.test(v) ? v : null;
}

/** A Drive file's bytes, exporting Google-native files (PDF by default). */
async function driveFile(fileId, format) {
  const meta = await google('GET', `https://www.googleapis.com/drive/v3/files/${fileId}`, {
    query: { fields: 'id,name,mimeType,size', supportsAllDrives: true },
  });
  if (meta.mimeType === 'application/vnd.google-apps.folder') throw new Error(`"${meta.name}" is a folder, not a file.`);
  const exp = EXPORT_FILE[meta.mimeType];
  if (exp) {
    const fmt = String(format || exp.default).toLowerCase().replace(/^\./, '');
    if (!exp.formats.includes(fmt)) throw new Error(`"${meta.name}" can be exported as ${exp.formats.join(', ')} — not ${fmt}.`);
    const mimeType = EXPORT_MIME[fmt];
    const data = await googleBytes(`https://www.googleapis.com/drive/v3/files/${fileId}/export`, { mimeType });
    const filename = meta.name.toLowerCase().endsWith(`.${fmt}`) ? meta.name : `${meta.name}.${fmt}`;
    return { filename, mimeType, data, source: 'drive', id: meta.id };
  }
  if (String(meta.mimeType).startsWith('application/vnd.google-apps.')) {
    throw new Error(`"${meta.name}" (${meta.mimeType}) is a Google item that can't be downloaded as a file.`);
  }
  const data = await googleBytes(`https://www.googleapis.com/drive/v3/files/${fileId}`, { alt: 'media', supportsAllDrives: true });
  // Drive names often lack the extension ("vit_id" for a PDF); mail clients need it.
  const ext = Object.entries(EXT_MIME).find(([, m]) => m === meta.mimeType)?.[0];
  const filename = ext && !path.extname(meta.name) ? `${meta.name}.${ext}` : meta.name;
  return { filename, mimeType: meta.mimeType || mimeForName(filename), data, source: 'drive', id: meta.id };
}

async function localFile(p) {
  const target = localPath(p);
  let st;
  try { st = await fs.stat(target); } catch { throw new Error(`No such file on this PC: ${target}`); }
  if (!st.isFile()) throw new Error(`Not a file: ${target}`);
  const filename = path.basename(target);
  return { filename, mimeType: mimeForName(filename), data: await fs.readFile(target), source: 'local', path: target };
}

/**
 * Whatever an agent passes as an attachment: a local path, a Drive id or
 * link, or an object naming one of those (plus an optional name/format).
 * Anything it can't resolve is an error — never silently dropped.
 */
async function resolveAttachment(item) {
  if (typeof item === 'string') {
    const v = item.trim();
    if (/^https?:\/\//.test(v)) {
      const id = driveIdFrom(v);
      if (!id) throw new Error(`Only Google Drive links can be attached, not ${v}. Download it first, then attach the local file.`);
      return driveFile(id);
    }
    const looksLocal = /[\\/]/.test(v) || /^[A-Za-z]:/.test(v) || v.startsWith('~') || /\.[A-Za-z0-9]{1,5}$/.test(v);
    if (looksLocal) return localFile(v);
    const id = driveIdFrom(v);
    if (id) return driveFile(id);
    throw new Error(`Can't tell what attachment "${v}" is: give a full local path or a Drive file id.`);
  }
  if (item && typeof item === 'object') {
    const local = item.path ?? item.file_path ?? item.local_path;
    const drive = item.drive_file_id ?? item.file_id ?? item.fileId ?? item.id ?? item.url ?? item.link;
    let file;
    if (local) file = await localFile(local);
    else if (drive) {
      const id = driveIdFrom(drive);
      if (!id) throw new Error(`Not a Drive file id or link: ${drive}`);
      file = await driveFile(id, item.format);
    } else throw new Error(`Attachment ${JSON.stringify(item)} names no file — use {"path": "C:\\…"} or {"drive_file_id": "…"}.`);
    const rename = item.name ?? item.filename;
    if (rename) file.filename = path.extname(rename) ? rename : `${rename}${path.extname(file.filename)}`;
    return file;
  }
  throw new Error(`Unsupported attachment: ${JSON.stringify(item)}`);
}

async function resolveAttachments(list) {
  const items = list == null ? [] : [].concat(list);
  const files = [];
  for (const item of items) files.push(await resolveAttachment(item));
  const total = files.reduce((n, f) => n + f.data.length, 0);
  if (total > GMAIL_LIMIT_BYTES) {
    const mb = (total / 1048576).toFixed(1);
    throw new Error(`The attachments total ${mb} MB — over Gmail's 25 MB limit, so nothing was sent. Share it as a Drive link instead: drive_upload a local file (Drive files are already there), drive_share it with the recipients, and put the link in the body.`);
  }
  return files;
}

/** Gmail's upload endpoint: takes messages up to 35 MB (the plain one tops out far lower). */
async function gmailUpload(endpoint, metadata, mime) {
  const boundary = `dex-upload-${Date.now().toString(36)}`;
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: message/rfc822',
    '',
    mime,
    `--${boundary}--`,
  ].join('\r\n');
  return google('POST', `https://gmail.googleapis.com/upload/gmail/v1/users/me/${endpoint}`, {
    query: { uploadType: 'multipart' },
    body,
    raw: true,
    headers: { 'content-type': `multipart/related; boundary=${boundary}` },
  });
}

const describeFiles = (files) => files.map((f) => ({ name: f.filename, size: f.data.length, mimeType: f.mimeType, from: f.source === 'local' ? f.path : `drive:${f.id}` }));

function downloadsDir() {
  return process.env.DEX_DOWNLOADS_DIR || path.join(process.env.DEX_HOME_DIR || os.homedir(), 'Downloads');
}

/** report.pdf → report (1).pdf → report (2).pdf … never overwrite. */
async function freePath(dir, name) {
  const safe = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'download';
  const ext = path.extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  for (let i = 0; ; i += 1) {
    const candidate = path.join(dir, i === 0 ? safe : `${stem} (${i})${ext}`);
    try { await fs.access(candidate); } catch { return candidate; }
  }
}

/** "2026-09-30" is an all-day date; anything with a time is a dateTime. */
function eventTime(value, timeZone) {
  if (!value) return undefined;
  const v = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { date: v };
  return timeZone ? { dateTime: v, timeZone } : { dateTime: v };
}

function formatEvent(e) {
  return {
    id: e.id,
    summary: e.summary ?? '(no title)',
    start: e.start?.dateTime ?? e.start?.date,
    end: e.end?.dateTime ?? e.end?.date,
    location: e.location,
    meetLink: e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri,
    attendees: (e.attendees ?? []).map((a) => `${a.email}${a.responseStatus ? ` (${a.responseStatus})` : ''}`),
    organizer: e.organizer?.email,
    link: e.htmlLink,
    description: e.description ? String(e.description).slice(0, 800) : undefined,
  };
}

const GOOGLE_EXPORT = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
  'application/vnd.google-apps.drawing': 'image/svg+xml',
};

function looksLikeDriveQuery(q) {
  return /\b(name|fullText|mimeType|modifiedTime|trashed|starred|parents|owners)\b\s*(contains|=|!=|<|>|in)/.test(q);
}

/* ── Tools ────────────────────────────────────────────────────────────── */

const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const bool = (description) => ({ type: 'boolean', description });
const strList = (description) => ({ type: 'array', items: { type: 'string' }, description });
const attachmentList = {
  type: 'array',
  description: 'Files to attach, from Google Drive and/or this PC, mixed freely. Each item is a local path ("C:\\Users\\me\\Documents\\cv.pdf"), a Drive file id or link, or {"path": "…"} / {"drive_file_id": "…", "format": "pdf|docx|xlsx|pptx|csv"} with an optional "name". Google Docs/Sheets/Slides are attached as PDF/xlsx/pdf unless format says otherwise. No need to download Drive files first. 25 MB total.',
  items: {
    anyOf: [
      { type: 'string' },
      {
        type: 'object',
        properties: {
          path: str('A file on this PC'),
          drive_file_id: str('A Google Drive file id (from drive_search) or link'),
          format: str('Export format for Google Docs/Sheets/Slides'),
          name: str('Filename to show the recipient'),
        },
      },
    ],
  },
};

const TOOLS = [
  /* Account */
  {
    name: 'google_whoami',
    description: 'The Google account DEX is connected to (email and name). Use it instead of guessing the user\'s address.',
    inputSchema: S({}),
    run: async () => google('GET', 'https://openidconnect.googleapis.com/v1/userinfo'),
  },

  /* Gmail */
  {
    name: 'gmail_search',
    description: 'Search Gmail with Gmail query syntax (e.g. "from:alice is:unread newer_than:7d"). Returns id, thread, from, subject, date and a snippet per message.',
    inputSchema: S({ query: str('Gmail search query. Empty lists the inbox.'), max_results: num('1–50, default 10') }),
    run: async ({ query = '', max_results = 10 }) => {
      const list = await google('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages', {
        query: { q: query || 'in:inbox', maxResults: Math.min(50, Math.max(1, max_results)) },
      });
      const ids = (list.messages ?? []).map((m) => m.id);
      const messages = await Promise.all(ids.map((id) => google('GET', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`, {
        query: { format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Date'] },
      })));
      return messages.map((m) => ({
        id: m.id,
        threadId: m.threadId,
        from: header(m.payload?.headers, 'From'),
        to: header(m.payload?.headers, 'To'),
        subject: header(m.payload?.headers, 'Subject'),
        date: header(m.payload?.headers, 'Date'),
        unread: (m.labelIds ?? []).includes('UNREAD'),
        snippet: m.snippet,
      }));
    },
  },
  {
    name: 'gmail_read',
    description: 'Read one email in full: headers, plain-text body and attachment names.',
    inputSchema: S({ message_id: str('Message id from gmail_search') }, ['message_id']),
    run: async ({ message_id }) => {
      const m = await google('GET', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message_id}`, { query: { format: 'full' } });
      const h = m.payload?.headers;
      return {
        id: m.id,
        threadId: m.threadId,
        from: header(h, 'From'),
        to: header(h, 'To'),
        cc: header(h, 'Cc'),
        subject: header(h, 'Subject'),
        date: header(h, 'Date'),
        messageIdHeader: header(h, 'Message-ID'),
        labels: m.labelIds,
        body: messageBody(m.payload).slice(0, 20_000),
        attachments: attachmentsOf(m.payload),
      };
    },
  },
  {
    name: 'gmail_send',
    description: 'Send an email from the connected account, optionally with attachments from Google Drive and/or this PC (pass them in attachments — Drive files are fetched for you). To reply in a thread pass reply_to_message_id. The result lists exactly what was attached.',
    inputSchema: S({
      to: strList('Recipients'),
      subject: str('Subject'),
      body: str('Body (plain text unless html is true)'),
      cc: strList('Cc'),
      bcc: strList('Bcc'),
      html: bool('Body is HTML'),
      reply_to_message_id: str('Gmail message id being replied to'),
      attachments: attachmentList,
    }, ['to', 'subject', 'body']),
    run: async (args) => {
      // Fetch every attachment before anything is sent: one that can't be
      // read fails the whole call, rather than going out without it.
      const files = await resolveAttachments(args.attachments);
      let threadId;
      let inReplyTo;
      let references;
      if (args.reply_to_message_id) {
        const orig = await google('GET', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${args.reply_to_message_id}`, {
          query: { format: 'metadata', metadataHeaders: ['Message-ID', 'References'] },
        });
        threadId = orig.threadId;
        inReplyTo = header(orig.payload?.headers, 'Message-ID');
        references = [header(orig.payload?.headers, 'References'), inReplyTo].filter(Boolean).join(' ');
      }
      const mime = mimeMessage({ ...args, inReplyTo, references, attachments: files });
      const sent = files.length > 0
        ? await gmailUpload('messages/send', { threadId }, mime)
        : await google('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { body: { raw: b64urlEncode(mime), threadId } });
      return { sent: true, id: sent.id, threadId: sent.threadId, attachments: describeFiles(files) };
    },
  },
  {
    name: 'gmail_create_draft',
    description: 'Save an email as a draft without sending it — with attachments from Drive and/or this PC if given.',
    inputSchema: S({ to: strList('Recipients'), subject: str('Subject'), body: str('Body'), cc: strList('Cc'), html: bool('Body is HTML'), attachments: attachmentList }, ['subject', 'body']),
    run: async (args) => {
      const files = await resolveAttachments(args.attachments);
      const mime = mimeMessage({ ...args, attachments: files });
      const draft = files.length > 0
        ? await gmailUpload('drafts', { message: {} }, mime)
        : await google('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/drafts', { body: { message: { raw: b64urlEncode(mime) } } });
      return { drafted: true, id: draft.id, attachments: describeFiles(files) };
    },
  },
  {
    name: 'gmail_modify',
    description: 'Change a message\'s labels. Archive = remove INBOX; mark read = remove UNREAD; star = add STARRED; trash = add TRASH.',
    inputSchema: S({ message_id: str('Message id'), add_labels: strList('Label ids to add'), remove_labels: strList('Label ids to remove') }, ['message_id']),
    run: async ({ message_id, add_labels = [], remove_labels = [] }) => {
      const m = await google('POST', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message_id}/modify`, {
        body: { addLabelIds: add_labels, removeLabelIds: remove_labels },
      });
      return { id: m.id, labels: m.labelIds };
    },
  },

  /* Calendar */
  {
    name: 'calendar_list_events',
    description: 'List calendar events in a window (default: now to 7 days ahead). Times are ISO 8601.',
    inputSchema: S({
      time_min: str('Start of window, ISO 8601 (default now)'),
      time_max: str('End of window, ISO 8601 (default +7 days)'),
      query: str('Free-text filter'),
      max_results: num('Default 25'),
      calendar_id: str('Default "primary"'),
    }),
    run: async ({ time_min, time_max, query, max_results = 25, calendar_id = 'primary' }) => {
      const now = new Date();
      const res = await google('GET', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar_id)}/events`, {
        query: {
          timeMin: time_min ?? now.toISOString(),
          timeMax: time_max ?? new Date(now.getTime() + 7 * 86_400_000).toISOString(),
          q: query,
          maxResults: Math.min(250, max_results),
          singleEvents: true,
          orderBy: 'startTime',
        },
      });
      return { timeZone: res.timeZone, events: (res.items ?? []).map(formatEvent) };
    },
  },
  {
    name: 'calendar_create_event',
    description: 'Create a calendar event. Use a date ("2026-10-01") for all-day, or ISO date-times. Set add_meet_link to attach a Google Meet.',
    inputSchema: S({
      summary: str('Title'),
      start: str('ISO date-time or date'),
      end: str('ISO date-time or date'),
      description: str('Notes'),
      location: str('Location'),
      attendees: strList('Attendee emails (they get invites)'),
      add_meet_link: bool('Attach a Google Meet video link'),
      time_zone: str('IANA zone, e.g. Asia/Kolkata, when start/end have no offset'),
      calendar_id: str('Default "primary"'),
    }, ['summary', 'start', 'end']),
    run: async (a) => {
      const body = {
        summary: a.summary,
        description: a.description,
        location: a.location,
        start: eventTime(a.start, a.time_zone),
        end: eventTime(a.end, a.time_zone),
        attendees: (a.attendees ?? []).map((email) => ({ email })),
      };
      if (a.add_meet_link) {
        body.conferenceData = { createRequest: { requestId: `dex-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } };
      }
      const e = await google('POST', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(a.calendar_id ?? 'primary')}/events`, {
        query: { conferenceDataVersion: a.add_meet_link ? 1 : undefined, sendUpdates: (a.attendees ?? []).length ? 'all' : undefined },
        body,
      });
      return formatEvent(e);
    },
  },
  {
    name: 'calendar_update_event',
    description: 'Change an event (only the fields given are updated).',
    inputSchema: S({
      event_id: str('Event id'),
      summary: str('Title'),
      start: str('ISO date-time or date'),
      end: str('ISO date-time or date'),
      description: str('Notes'),
      location: str('Location'),
      attendees: strList('Replaces the attendee list'),
      time_zone: str('IANA zone'),
      calendar_id: str('Default "primary"'),
    }, ['event_id']),
    run: async (a) => {
      const body = {};
      if (a.summary !== undefined) body.summary = a.summary;
      if (a.description !== undefined) body.description = a.description;
      if (a.location !== undefined) body.location = a.location;
      if (a.start) body.start = eventTime(a.start, a.time_zone);
      if (a.end) body.end = eventTime(a.end, a.time_zone);
      if (a.attendees) body.attendees = a.attendees.map((email) => ({ email }));
      const e = await google('PATCH', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(a.calendar_id ?? 'primary')}/events/${a.event_id}`, {
        query: { sendUpdates: 'all' },
        body,
      });
      return formatEvent(e);
    },
  },
  {
    name: 'calendar_delete_event',
    description: 'Delete (cancel) a calendar event.',
    inputSchema: S({ event_id: str('Event id'), calendar_id: str('Default "primary"') }, ['event_id']),
    run: async ({ event_id, calendar_id = 'primary' }) => {
      await google('DELETE', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar_id)}/events/${event_id}`, { query: { sendUpdates: 'all' } });
      return { deleted: true, id: event_id };
    },
  },
  {
    name: 'calendar_freebusy',
    description: 'When the user is busy in a window — use before proposing a meeting time.',
    inputSchema: S({ time_min: str('ISO start'), time_max: str('ISO end') }, ['time_min', 'time_max']),
    run: async ({ time_min, time_max }) => {
      const res = await google('POST', 'https://www.googleapis.com/calendar/v3/freeBusy', {
        body: { timeMin: time_min, timeMax: time_max, items: [{ id: 'primary' }] },
      });
      return { busy: res.calendars?.primary?.busy ?? [] };
    },
  },

  /* Meet */
  {
    name: 'meet_create',
    description: 'Create a Google Meet link, as a calendar event (starting now for 30 minutes unless given). Invites attendees if listed.',
    inputSchema: S({
      summary: str('Title, default "Meeting"'),
      start: str('ISO date-time, default now'),
      duration_minutes: num('Default 30'),
      attendees: strList('Emails to invite'),
      time_zone: str('IANA zone'),
    }),
    run: async ({ summary = 'Meeting', start, duration_minutes = 30, attendees = [], time_zone }) => {
      const s = start ? new Date(start) : new Date();
      const e = new Date(s.getTime() + duration_minutes * 60_000);
      const ev = await google('POST', 'https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        query: { conferenceDataVersion: 1, sendUpdates: attendees.length ? 'all' : undefined },
        body: {
          summary,
          start: eventTime(start ?? s.toISOString(), time_zone),
          end: eventTime(e.toISOString(), time_zone),
          attendees: attendees.map((email) => ({ email })),
          conferenceData: { createRequest: { requestId: `dex-meet-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
        },
      });
      return formatEvent(ev);
    },
  },

  /* Drive */
  {
    name: 'drive_search',
    description: 'Search Google Drive by name and content. Plain words search both; Drive query syntax (name contains \'x\') is passed through.',
    inputSchema: S({ query: str('Words, or a Drive query'), max_results: num('Default 15') }, ['query']),
    run: async ({ query, max_results = 15 }) => {
      const escaped = String(query).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const q = looksLikeDriveQuery(query) ? query : `(name contains '${escaped}' or fullText contains '${escaped}') and trashed = false`;
      const res = await google('GET', 'https://www.googleapis.com/drive/v3/files', {
        query: {
          q,
          pageSize: Math.min(100, max_results),
          fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink,owners(emailAddress))',
          orderBy: looksLikeDriveQuery(query) ? 'modifiedTime desc' : undefined,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        },
      });
      return (res.files ?? []).map((f) => ({
        id: f.id, name: f.name, mimeType: f.mimeType, modified: f.modifiedTime, size: f.size, link: f.webViewLink, owner: f.owners?.[0]?.emailAddress,
      }));
    },
  },
  {
    name: 'drive_read',
    description: 'Read a Drive file\'s contents: Docs and Slides as text, Sheets as CSV, text files as-is. Binary files return their metadata and link.',
    inputSchema: S({ file_id: str('File id from drive_search') }, ['file_id']),
    run: async ({ file_id }) => {
      const meta = await google('GET', `https://www.googleapis.com/drive/v3/files/${file_id}`, {
        query: { fields: 'id,name,mimeType,size,webViewLink,modifiedTime', supportsAllDrives: true },
      });
      const exportAs = GOOGLE_EXPORT[meta.mimeType];
      let content;
      if (exportAs) {
        content = await google('GET', `https://www.googleapis.com/drive/v3/files/${file_id}/export`, { query: { mimeType: exportAs } });
      } else if (/^text\/|json|xml|csv|javascript|markdown/.test(meta.mimeType ?? '')) {
        content = await google('GET', `https://www.googleapis.com/drive/v3/files/${file_id}`, { query: { alt: 'media', supportsAllDrives: true } });
      }
      return { ...meta, content: typeof content === 'string' ? content.slice(0, 60_000) : content === undefined ? undefined : JSON.stringify(content).slice(0, 60_000) };
    },
  },
  {
    name: 'drive_download',
    description: 'Download a Drive file to this PC (Downloads by default) and return its local path. Google Docs/Sheets/Slides are exported — PDF/xlsx/PDF by default, or pass format. To email a Drive file you do NOT need this: give its id to gmail_send attachments.',
    inputSchema: S({
      file_id: str('File id (from drive_search) or a Drive link'),
      format: str('For Google Docs/Sheets/Slides: pdf, docx, xlsx, pptx, csv, txt, md'),
      save_dir: str('Folder on this PC; default Downloads'),
    }, ['file_id']),
    run: async ({ file_id, format, save_dir }) => {
      const id = driveIdFrom(file_id);
      if (!id) throw new Error(`Not a Drive file id or link: ${file_id}`);
      const file = await driveFile(id, format);
      const dir = save_dir ? localPath(save_dir) : downloadsDir();
      await fs.mkdir(dir, { recursive: true });
      const target = await freePath(dir, file.filename);
      await fs.writeFile(target, file.data);
      return { path: target, name: path.basename(target), size: file.data.length, mimeType: file.mimeType };
    },
  },
  {
    name: 'drive_upload',
    description: 'Upload a file from this PC to Google Drive (any type, keeps its bytes). Returns the Drive id and link — pair with drive_share to send someone a file too big to attach.',
    inputSchema: S({
      path: str('The file on this PC'),
      name: str('Name in Drive; default the file\'s own'),
      folder_id: str('Parent folder id'),
    }, ['path']),
    run: async ({ path: filePath, name, folder_id }) => {
      const file = await localFile(filePath);
      const boundary = `dex-drive-${Date.now().toString(36)}`;
      const metadata = { name: name || file.filename, parents: folder_id ? [folder_id] : undefined };
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${file.mimeType}\r\n\r\n`),
        file.data,
        Buffer.from(`\r\n--${boundary}--`),
      ]);
      return google('POST', 'https://www.googleapis.com/upload/drive/v3/files', {
        query: { uploadType: 'multipart', fields: 'id,name,mimeType,size,webViewLink', supportsAllDrives: true },
        body,
        raw: true,
        headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      });
    },
  },
  {
    name: 'drive_share',
    description: 'Share a Drive file: with specific people (emails), or with anyone who has the link. Returns the link to send.',
    inputSchema: S({
      file_id: str('File id or Drive link'),
      emails: strList('People to share with'),
      role: str('reader (default), commenter or writer'),
      anyone_with_link: bool('Anyone with the link can open it'),
      notify: bool('Email the people a Drive notification (default false — you are probably emailing them yourself)'),
    }, ['file_id']),
    run: async ({ file_id, emails = [], role = 'reader', anyone_with_link = false, notify = false }) => {
      const id = driveIdFrom(file_id);
      if (!id) throw new Error(`Not a Drive file id or link: ${file_id}`);
      if (!emails.length && !anyone_with_link) throw new Error('Give emails to share with, or set anyone_with_link.');
      for (const email of emails) {
        await google('POST', `https://www.googleapis.com/drive/v3/files/${id}/permissions`, {
          query: { sendNotificationEmail: notify, supportsAllDrives: true },
          body: { type: 'user', role, emailAddress: email },
        });
      }
      if (anyone_with_link) {
        await google('POST', `https://www.googleapis.com/drive/v3/files/${id}/permissions`, {
          query: { supportsAllDrives: true },
          body: { type: 'anyone', role: 'reader' },
        });
      }
      const meta = await google('GET', `https://www.googleapis.com/drive/v3/files/${id}`, { query: { fields: 'id,name,webViewLink', supportsAllDrives: true } });
      return { shared: true, with: anyone_with_link ? [...emails, 'anyone with the link'] : emails, role, link: meta.webViewLink, name: meta.name };
    },
  },
  {
    name: 'drive_create_file',
    description: 'Create a file in Drive from text. Set as_google_doc to convert it into an editable Google Doc (or Sheet, when mime_type is text/csv).',
    inputSchema: S({
      name: str('File name'),
      content: str('File contents'),
      mime_type: str('Default text/plain'),
      folder_id: str('Parent folder id'),
      as_google_doc: bool('Convert to a Google Doc/Sheet'),
    }, ['name', 'content']),
    run: async ({ name, content, mime_type = 'text/plain', folder_id, as_google_doc }) => {
      const boundary = `dex${Date.now()}`;
      const target = as_google_doc
        ? (mime_type === 'text/csv' ? 'application/vnd.google-apps.spreadsheet' : 'application/vnd.google-apps.document')
        : mime_type;
      const metadata = { name, mimeType: target, parents: folder_id ? [folder_id] : undefined };
      const body = [
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        JSON.stringify(metadata),
        `--${boundary}`,
        `Content-Type: ${mime_type}; charset=UTF-8`,
        '',
        content,
        `--${boundary}--`,
      ].join('\r\n');
      const f = await google('POST', 'https://www.googleapis.com/upload/drive/v3/files', {
        query: { uploadType: 'multipart', fields: 'id,name,mimeType,webViewLink', supportsAllDrives: true },
        body,
        raw: true,
        headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      });
      return f;
    },
  },

  /* Docs */
  {
    name: 'docs_create',
    description: 'Create a Google Doc with the given text and return its link.',
    inputSchema: S({ title: str('Document title'), content: str('Body text') }, ['title']),
    run: async ({ title, content = '' }) => {
      const doc = await google('POST', 'https://docs.googleapis.com/v1/documents', { body: { title } });
      if (content) {
        await google('POST', `https://docs.googleapis.com/v1/documents/${doc.documentId}:batchUpdate`, {
          body: { requests: [{ insertText: { location: { index: 1 }, text: content } }] },
        });
      }
      return { id: doc.documentId, title: doc.title, link: `https://docs.google.com/document/d/${doc.documentId}/edit` };
    },
  },
  {
    name: 'docs_append',
    description: 'Append text to the end of a Google Doc.',
    inputSchema: S({ document_id: str('Doc id'), text: str('Text to append') }, ['document_id', 'text']),
    run: async ({ document_id, text }) => {
      await google('POST', `https://docs.googleapis.com/v1/documents/${document_id}:batchUpdate`, {
        body: { requests: [{ insertText: { endOfSegmentLocation: {}, text: `\n${text}` } }] },
      });
      return { appended: true, link: `https://docs.google.com/document/d/${document_id}/edit` };
    },
  },

  /* Sheets */
  {
    name: 'sheets_read',
    description: 'Read cells from a Google Sheet (A1 range, e.g. "Sheet1!A1:D50").',
    inputSchema: S({ spreadsheet_id: str('Spreadsheet id'), range: str('A1 range, default first sheet') }, ['spreadsheet_id']),
    run: async ({ spreadsheet_id, range }) => {
      if (!range) {
        const meta = await google('GET', `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}`, { query: { fields: 'sheets.properties.title' } });
        range = meta.sheets?.[0]?.properties?.title ?? 'Sheet1';
      }
      const res = await google('GET', `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}/values/${encodeURIComponent(range)}`);
      return { range: res.range, values: res.values ?? [] };
    },
  },
  {
    name: 'sheets_append',
    description: 'Append rows to a Google Sheet.',
    inputSchema: S({
      spreadsheet_id: str('Spreadsheet id'),
      range: str('Target, e.g. "Sheet1!A1"'),
      rows: { type: 'array', items: { type: 'array', items: {} }, description: 'Rows of cell values' },
    }, ['spreadsheet_id', 'range', 'rows']),
    run: async ({ spreadsheet_id, range, rows }) => {
      const res = await google('POST', `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}/values/${encodeURIComponent(range)}:append`, {
        query: { valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' },
        body: { values: rows },
      });
      return { updatedRange: res.updates?.updatedRange, updatedRows: res.updates?.updatedRows };
    },
  },
  {
    name: 'sheets_create',
    description: 'Create a new Google Sheet, optionally with a header row.',
    inputSchema: S({ title: str('Title'), header: strList('Header row') }, ['title']),
    run: async ({ title, header: head }) => {
      const s = await google('POST', 'https://sheets.googleapis.com/v4/spreadsheets', { body: { properties: { title } } });
      if (head?.length) {
        await google('POST', `https://sheets.googleapis.com/v4/spreadsheets/${s.spreadsheetId}/values/A1:append`, {
          query: { valueInputOption: 'USER_ENTERED' },
          body: { values: [head] },
        });
      }
      return { id: s.spreadsheetId, link: s.spreadsheetUrl };
    },
  },

  /* Contacts */
  {
    name: 'contacts_search',
    description: 'Find a person\'s email or phone in the user\'s Google Contacts by name.',
    inputSchema: S({ query: str('Name, email or phone fragment') }, ['query']),
    run: async ({ query }) => {
      // The People API wants one warm-up call before search returns results.
      await google('GET', 'https://people.googleapis.com/v1/people:searchContacts', { query: { query: '', readMask: 'names' } }).catch(() => {});
      const res = await google('GET', 'https://people.googleapis.com/v1/people:searchContacts', {
        query: { query, readMask: 'names,emailAddresses,phoneNumbers,organizations', pageSize: 10 },
      });
      return (res.results ?? []).map((r) => ({
        name: r.person?.names?.[0]?.displayName,
        emails: (r.person?.emailAddresses ?? []).map((e) => e.value),
        phones: (r.person?.phoneNumbers ?? []).map((p) => p.value),
        organization: r.person?.organizations?.[0]?.name,
      }));
    },
  },

  /* Tasks */
  {
    name: 'tasks_list',
    description: 'List open Google Tasks from the default list.',
    inputSchema: S({ show_completed: bool('Include completed tasks') }),
    run: async ({ show_completed = false }) => {
      const res = await google('GET', 'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks', {
        query: { showCompleted: show_completed, maxResults: 100 },
      });
      return (res.items ?? []).map((t) => ({ id: t.id, title: t.title, notes: t.notes, due: t.due, status: t.status }));
    },
  },
  {
    name: 'tasks_create',
    description: 'Add a Google Task (optionally with notes and a due date, RFC 3339).',
    inputSchema: S({ title: str('Task'), notes: str('Details'), due: str('Due date, e.g. 2026-10-01T00:00:00Z') }, ['title']),
    run: async ({ title, notes, due }) => {
      const t = await google('POST', 'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks', { body: { title, notes, due } });
      return { id: t.id, title: t.title, due: t.due };
    },
  },
  {
    name: 'tasks_complete',
    description: 'Mark a Google Task done.',
    inputSchema: S({ task_id: str('Task id') }, ['task_id']),
    run: async ({ task_id }) => {
      const t = await google('PATCH', `https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${task_id}`, { body: { status: 'completed' } });
      return { id: t.id, status: t.status };
    },
  },
];

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/**
 * Check and tidy a call's arguments before running it. An argument the tool
 * doesn't know is an error, never ignored: gmail_send once got
 * `attachments` before it supported them, dropped it, sent the mail bare and
 * reported success — so the agent told the user the PDF was attached.
 * Also forgives the usual shapes models send: a JSON string for an array,
 * a single string for a list, a number as a string.
 */
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
    else if (schema.type === 'number' && typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) v = Number(v);
    else if (schema.type === 'boolean' && typeof v === 'string') v = v === 'true';
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
        instructions: 'Google Workspace for the account the user connected in DEX: Gmail, Calendar, Meet, Drive, Docs, Sheets, Contacts, Tasks. Prefer these tools over driving Google websites in the browser.',
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
log('ready', { tools: TOOLS.length, connected: Boolean(REFRESH_TOKEN) });
