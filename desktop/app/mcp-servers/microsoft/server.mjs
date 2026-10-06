#!/usr/bin/env node
/**
 * DEX's built-in Microsoft 365 MCP server.
 *
 * One "Continue with Microsoft" in Settings gives every engine:
 *   Outlook (mail), Calendar, OneDrive/SharePoint (files),
 *   Teams (chats & channels), Microsoft To Do (tasks).
 *
 * Credentials come through env:
 *   MICROSOFT_CLIENT_ID      the Azure app's client ID
 *   MICROSOFT_CLIENT_SECRET  the Azure app's client secret (optional for public clients)
 *   MICROSOFT_REFRESH_TOKEN  the account's long-lived grant
 *
 * Protocol: MCP over stdio, newline-delimited JSON-RPC 2.0.
 * No external dependencies — runs from inside app.asar with Node's stdlib.
 */

import { createInterface } from 'node:readline';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'dex-microsoft', version: '1.0.0' };

const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET ?? '';
const REFRESH_TOKEN = process.env.MICROSOFT_REFRESH_TOKEN ?? '';

function log(...args) {
  process.stderr.write(`[dex-microsoft] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`);
}

/* ── Auth ─────────────────────────────────────────────────────────────── */

let accessToken = '';
let accessTokenExpiresAt = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < accessTokenExpiresAt - 60_000) return accessToken;
  if (!CLIENT_ID || !REFRESH_TOKEN) {
    throw new Error('Microsoft is not connected. Open DEX Settings → Accounts → Continue with Microsoft.');
  }
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    refresh_token: REFRESH_TOKEN,
    grant_type: 'refresh_token',
    scope: 'https://graph.microsoft.com/.default offline_access',
  });
  if (CLIENT_SECRET) body.set('client_secret', CLIENT_SECRET);
  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    const reason = json.error_description || json.error || `HTTP ${res.status}`;
    if (json.error === 'invalid_grant') {
      throw new Error('The Microsoft connection has expired or was revoked. Reconnect in DEX Settings → Accounts.');
    }
    throw new Error(`Could not refresh Microsoft access: ${reason}`);
  }
  accessToken = json.access_token;
  accessTokenExpiresAt = Date.now() + (Number(json.expires_in) || 3600) * 1000;
  return accessToken;
}

async function graph(method, path_, { query, body, raw } = {}) {
  const token = await getAccessToken();
  const base = path_.startsWith('https://') ? path_ : `https://graph.microsoft.com/v1.0${path_}`;
  const u = new URL(base);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v)) v.forEach((item) => u.searchParams.append(k, String(item)));
      else u.searchParams.set(k, String(v));
    }
  }
  const init = { method, headers: { authorization: `Bearer ${token}` } };
  if (body !== undefined) {
    if (raw) {
      init.body = body;
      // caller sets content-type
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
    const message = typeof payload === 'object'
      ? payload?.error?.message ?? JSON.stringify(payload)
      : payload;
    throw new Error(`${method} ${u.pathname} failed (${res.status}): ${String(message).slice(0, 500)}`);
  }
  return payload;
}

async function graphBytes(path_, query) {
  const token = await getAccessToken();
  const base = path_.startsWith('https://') ? path_ : `https://graph.microsoft.com/v1.0${path_}`;
  const u = new URL(base);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  const res = await fetch(u, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = text;
    try { msg = JSON.parse(text)?.error?.message ?? text; } catch { /* not JSON */ }
    throw new Error(`GET ${u.pathname} failed (${res.status}): ${String(msg).slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

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

function localPath(p) {
  let v = String(p).trim().replace(/^["']|["']$/g, '');
  if (v.startsWith('file://')) v = decodeURIComponent(new URL(v).pathname).replace(/^\/([A-Za-z]:)/, '$1');
  if (v === '~' || v.startsWith('~/') || v.startsWith('~\\')) v = path.join(os.homedir(), v.slice(1));
  if (process.platform === 'win32') {
    const msys = /^\/([a-zA-Z])(?:\/(.*))?$/.exec(v);
    if (msys) v = `${msys[1].toUpperCase()}:\\${(msys[2] ?? '').replace(/\//g, '\\')}`;
  }
  return path.resolve(v);
}

/* ── Schema helpers ───────────────────────────────────────────────────── */

const str = (description) => ({ type: 'string', description });
const bool = (description) => ({ type: 'boolean', description });
const num = (description) => ({ type: 'number', description });
const arr = (description) => ({ type: 'array', items: { type: 'string' }, description });

function S(properties, required = []) {
  return { type: 'object', properties, required };
}

/* ── Tools ────────────────────────────────────────────────────────────── */

const TOOLS = [

  /* ── Outlook: Mail ─────────────────────────────────────────────────── */
  {
    name: 'mail_list',
    description: 'List recent emails from the signed-in Microsoft account. Optionally filter by folder (inbox, sentitems, drafts, deleteditems) and search query.',
    inputSchema: S({
      folder: str('Folder name: inbox, sentitems, drafts, deleteditems (default: inbox)'),
      search: str('OData $search query string, e.g. "subject:invoice"'),
      top: num('Max emails to return (1-50, default 20)'),
    }),
    run: async ({ folder = 'inbox', search, top = 20 }) => {
      const cap = Math.min(50, Math.max(1, Number(top) || 20));
      const q = { $top: cap, $select: 'id,subject,from,receivedDateTime,bodyPreview,hasAttachments,isRead' };
      if (search) q['$search'] = `"${search}"`;
      else q['$orderby'] = 'receivedDateTime desc';
      const data = await graph('GET', `/me/mailFolders/${folder}/messages`, { query: q });
      return (data.value ?? []).map((m) => ({
        id: m.id,
        subject: m.subject,
        from: m.from?.emailAddress?.address,
        fromName: m.from?.emailAddress?.name,
        received: m.receivedDateTime,
        preview: m.bodyPreview,
        hasAttachments: m.hasAttachments,
        isRead: m.isRead,
      }));
    },
  },
  {
    name: 'mail_read',
    description: 'Read the full body of a specific email by its id.',
    inputSchema: S({ message_id: str('Email message id') }, ['message_id']),
    run: async ({ message_id }) => {
      const m = await graph('GET', `/me/messages/${message_id}`, {
        query: { $select: 'id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,hasAttachments' },
      });
      return {
        id: m.id,
        subject: m.subject,
        from: m.from?.emailAddress?.address,
        to: (m.toRecipients ?? []).map((r) => r.emailAddress?.address),
        cc: (m.ccRecipients ?? []).map((r) => r.emailAddress?.address),
        received: m.receivedDateTime,
        body: m.body?.contentType === 'html' ? stripHtml(m.body.content ?? '') : (m.body?.content ?? ''),
        hasAttachments: m.hasAttachments,
      };
    },
  },
  {
    name: 'mail_send',
    description: 'Send an email from the signed-in Microsoft account.',
    inputSchema: S({
      to: arr('Recipient email addresses'),
      cc: arr('CC recipients'),
      bcc: arr('BCC recipients'),
      subject: str('Email subject'),
      body: str('Email body (plain text or HTML)'),
      html: bool('If true, body is treated as HTML'),
    }, ['to', 'subject', 'body']),
    run: async ({ to, cc = [], bcc = [], subject, body, html = false }) => {
      const makeRecipients = (addrs) => [].concat(addrs).map((a) => ({ emailAddress: { address: a } }));
      const message = {
        subject,
        body: { contentType: html ? 'html' : 'text', content: body },
        toRecipients: makeRecipients(to),
        ...(cc.length ? { ccRecipients: makeRecipients(cc) } : {}),
        ...(bcc.length ? { bccRecipients: makeRecipients(bcc) } : {}),
      };
      await graph('POST', '/me/sendMail', { body: { message, saveToSentItems: true } });
      return { sent: true, to: [].concat(to), subject };
    },
  },
  {
    name: 'mail_reply',
    description: 'Reply to an email. Set reply_all to true to reply to all recipients.',
    inputSchema: S({
      message_id: str('Id of the email to reply to'),
      body: str('Reply body text (plain text or HTML)'),
      html: bool('If true, body is treated as HTML'),
      reply_all: bool('If true, reply-all'),
    }, ['message_id', 'body']),
    run: async ({ message_id, body, html = false, reply_all = false }) => {
      const endpoint = reply_all ? `/me/messages/${message_id}/replyAll` : `/me/messages/${message_id}/reply`;
      await graph('POST', endpoint, {
        body: { comment: body, ...(html ? { message: { body: { contentType: 'html', content: body } } } : {}) },
      });
      return { replied: true };
    },
  },
  {
    name: 'mail_forward',
    description: 'Forward an email to one or more recipients.',
    inputSchema: S({
      message_id: str('Id of the email to forward'),
      to: arr('Recipient email addresses'),
      comment: str('Optional comment to prepend'),
    }, ['message_id', 'to']),
    run: async ({ message_id, to, comment = '' }) => {
      await graph('POST', `/me/messages/${message_id}/forward`, {
        body: {
          comment,
          toRecipients: [].concat(to).map((a) => ({ emailAddress: { address: a } })),
        },
      });
      return { forwarded: true, to: [].concat(to) };
    },
  },
  {
    name: 'mail_move',
    description: 'Move an email to another folder (e.g. deleteditems, junk, archive).',
    inputSchema: S({ message_id: str('Email id'), destination_folder: str('Target folder name or id') }, ['message_id', 'destination_folder']),
    run: async ({ message_id, destination_folder }) => {
      const res = await graph('POST', `/me/messages/${message_id}/move`, { body: { destinationId: destination_folder } });
      return { moved: true, newId: res.id };
    },
  },
  {
    name: 'mail_mark_read',
    description: 'Mark an email as read or unread.',
    inputSchema: S({ message_id: str('Email id'), read: bool('true = mark read, false = mark unread') }, ['message_id']),
    run: async ({ message_id, read = true }) => {
      await graph('PATCH', `/me/messages/${message_id}`, { body: { isRead: read } });
      return { ok: true, isRead: read };
    },
  },
  {
    name: 'mail_delete',
    description: 'Delete (trash) an email.',
    inputSchema: S({ message_id: str('Email id') }, ['message_id']),
    run: async ({ message_id }) => {
      await graph('DELETE', `/me/messages/${message_id}`);
      return { deleted: true };
    },
  },

  /* ── Calendar ──────────────────────────────────────────────────────── */
  {
    name: 'calendar_list',
    description: 'List calendar events in a time window. Dates are ISO 8601 (e.g. 2026-10-01T00:00:00).',
    inputSchema: S({
      start: str('Start of range (ISO 8601, default: now)'),
      end: str('End of range (ISO 8601, default: +7 days)'),
      top: num('Max events to return (1-100, default 20)'),
    }),
    run: async ({ start, end, top = 20 }) => {
      const now = new Date();
      const from = start ? new Date(start) : now;
      const to = end ? new Date(end) : new Date(now.getTime() + 7 * 86400_000);
      const data = await graph('GET', '/me/calendarView', {
        query: {
          startDateTime: from.toISOString(),
          endDateTime: to.toISOString(),
          $top: Math.min(100, Math.max(1, Number(top) || 20)),
          $select: 'id,subject,start,end,location,organizer,isAllDay,isCancelled,bodyPreview,onlineMeeting',
          $orderby: 'start/dateTime',
        },
      });
      return (data.value ?? []).map((e) => ({
        id: e.id,
        subject: e.subject,
        start: e.start?.dateTime,
        end: e.end?.dateTime,
        location: e.location?.displayName,
        organizer: e.organizer?.emailAddress?.address,
        isAllDay: e.isAllDay,
        isCancelled: e.isCancelled,
        preview: e.bodyPreview,
        joinUrl: e.onlineMeeting?.joinUrl,
      }));
    },
  },
  {
    name: 'calendar_create',
    description: 'Create a calendar event. Dates are ISO 8601. Invite attendees by email.',
    inputSchema: S({
      subject: str('Event title'),
      start: str('Start time ISO 8601 (e.g. 2026-10-05T14:00:00)'),
      end: str('End time ISO 8601'),
      timezone: str('Timezone (default: UTC)'),
      body: str('Event description'),
      location: str('Location display name'),
      attendees: arr('Attendee email addresses'),
      is_online: bool('Add a Teams meeting link'),
    }, ['subject', 'start', 'end']),
    run: async ({ subject, start, end, timezone = 'UTC', body = '', location, attendees = [], is_online = false }) => {
      const payload = {
        subject,
        start: { dateTime: start, timeZone: timezone },
        end: { dateTime: end, timeZone: timezone },
        body: { contentType: 'text', content: body },
        ...(location ? { location: { displayName: location } } : {}),
        ...(attendees.length ? { attendees: [].concat(attendees).map((a) => ({ emailAddress: { address: a }, type: 'required' })) } : {}),
        ...(is_online ? { isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' } : {}),
      };
      const event = await graph('POST', '/me/events', { body: payload });
      return { id: event.id, subject: event.subject, start: event.start?.dateTime, joinUrl: event.onlineMeeting?.joinUrl };
    },
  },
  {
    name: 'calendar_update',
    description: 'Update an existing calendar event (subject, time, location, attendees).',
    inputSchema: S({
      event_id: str('Calendar event id'),
      subject: str('New title'),
      start: str('New start ISO 8601'),
      end: str('New end ISO 8601'),
      timezone: str('Timezone for the new times (default: UTC)'),
      body: str('New description'),
      location: str('New location'),
    }, ['event_id']),
    run: async ({ event_id, subject, start, end, timezone = 'UTC', body, location }) => {
      const patch = {};
      if (subject) patch.subject = subject;
      if (start) patch.start = { dateTime: start, timeZone: timezone };
      if (end) patch.end = { dateTime: end, timeZone: timezone };
      if (body !== undefined) patch.body = { contentType: 'text', content: body };
      if (location) patch.location = { displayName: location };
      const event = await graph('PATCH', `/me/events/${event_id}`, { body: patch });
      return { id: event.id, subject: event.subject, start: event.start?.dateTime };
    },
  },
  {
    name: 'calendar_cancel',
    description: 'Cancel (delete) a calendar event and optionally send cancellation emails.',
    inputSchema: S({ event_id: str('Calendar event id'), comment: str('Cancellation message for attendees') }, ['event_id']),
    run: async ({ event_id, comment = '' }) => {
      if (comment) {
        await graph('POST', `/me/events/${event_id}/cancel`, { body: { comment } });
      } else {
        await graph('DELETE', `/me/events/${event_id}`);
      }
      return { cancelled: true };
    },
  },
  {
    name: 'calendar_availability',
    description: 'Find free/busy availability for one or more people over a time range.',
    inputSchema: S({
      emails: arr('Email addresses to check'),
      start: str('Start ISO 8601'),
      end: str('End ISO 8601'),
      interval: num('Slot duration in minutes (default 30)'),
    }, ['emails', 'start', 'end']),
    run: async ({ emails, start, end, interval = 30 }) => {
      const data = await graph('POST', '/me/calendar/getSchedule', {
        body: {
          schedules: [].concat(emails),
          startTime: { dateTime: start, timeZone: 'UTC' },
          endTime: { dateTime: end, timeZone: 'UTC' },
          availabilityViewInterval: interval,
        },
      });
      return (data.value ?? []).map((s) => ({
        email: s.scheduleId,
        availabilityView: s.availabilityView,
        busyTimes: (s.scheduleItems ?? []).map((i) => ({ status: i.status, start: i.start?.dateTime, end: i.end?.dateTime })),
      }));
    },
  },

  /* ── OneDrive / SharePoint ─────────────────────────────────────────── */
  {
    name: 'onedrive_search',
    description: 'Search for files in OneDrive/SharePoint by name or content.',
    inputSchema: S({ query: str('Search query'), top: num('Max results (1-50, default 20)') }, ['query']),
    run: async ({ query, top = 20 }) => {
      const data = await graph('GET', '/me/drive/root/search(q=\'' + encodeURIComponent(String(query)) + '\')', {
        query: { $top: Math.min(50, Math.max(1, Number(top) || 20)), $select: 'id,name,size,lastModifiedDateTime,webUrl,folder' },
      });
      return (data.value ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        size: f.size,
        modified: f.lastModifiedDateTime,
        url: f.webUrl,
        isFolder: Boolean(f.folder),
      }));
    },
  },
  {
    name: 'onedrive_list',
    description: 'List files and folders at a OneDrive path or folder id.',
    inputSchema: S({
      path: str('OneDrive path (e.g. /Documents) or folder id'),
      top: num('Max results (default 50)'),
    }),
    run: async ({ path: p, top = 50 }) => {
      const endpoint = p
        ? (p.startsWith('/') ? `/me/drive/root:${p}:/children` : `/me/drive/items/${p}/children`)
        : '/me/drive/root/children';
      const data = await graph('GET', endpoint, {
        query: { $top: Math.min(200, Number(top) || 50), $select: 'id,name,size,lastModifiedDateTime,webUrl,folder,file' },
      });
      return (data.value ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        size: f.size,
        modified: f.lastModifiedDateTime,
        url: f.webUrl,
        isFolder: Boolean(f.folder),
        mimeType: f.file?.mimeType,
      }));
    },
  },
  {
    name: 'onedrive_read',
    description: 'Download and return the text content of a OneDrive file by path or id.',
    inputSchema: S({ path: str('OneDrive path (e.g. /Notes/todo.txt) or file id') }, ['path']),
    run: async ({ path: p }) => {
      const endpoint = p.startsWith('/') ? `/me/drive/root:${p}:/content` : `/me/drive/items/${p}/content`;
      const buf = await graphBytes(endpoint);
      const text = buf.toString('utf-8');
      return { content: text.slice(0, 20_000), truncated: text.length > 20_000 };
    },
  },
  {
    name: 'onedrive_upload',
    description: 'Upload a local file to OneDrive.',
    inputSchema: S({
      local_path: str('Absolute path to the local file'),
      destination: str('OneDrive destination path including filename (e.g. /Documents/report.pdf)'),
    }, ['local_path', 'destination']),
    run: async ({ local_path, destination }) => {
      const target = localPath(local_path);
      let data;
      try { data = await fs.readFile(target); } catch { throw new Error(`Cannot read local file: ${target}`); }
      const safeDest = String(destination).startsWith('/') ? destination : `/${destination}`;
      const item = await graph('PUT', `/me/drive/root:${safeDest}:/content`, {
        body: data,
        raw: true,
      });
      return { id: item.id, name: item.name, url: item.webUrl };
    },
  },
  {
    name: 'onedrive_create_folder',
    description: 'Create a new folder in OneDrive.',
    inputSchema: S({
      name: str('Folder name'),
      parent: str('Parent folder path (e.g. /Documents) or id, default is root'),
    }, ['name']),
    run: async ({ name, parent }) => {
      const endpoint = parent
        ? (parent.startsWith('/') ? `/me/drive/root:${parent}:/children` : `/me/drive/items/${parent}/children`)
        : '/me/drive/root/children';
      const folder = await graph('POST', endpoint, { body: { name, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' } });
      return { id: folder.id, name: folder.name, url: folder.webUrl };
    },
  },
  {
    name: 'onedrive_move',
    description: 'Move or rename a OneDrive file/folder.',
    inputSchema: S({
      item_id: str('File or folder id'),
      new_name: str('New name (optional)'),
      new_parent_id: str('Id of the destination parent folder (optional)'),
    }, ['item_id']),
    run: async ({ item_id, new_name, new_parent_id }) => {
      const patch = {};
      if (new_name) patch.name = new_name;
      if (new_parent_id) patch.parentReference = { id: new_parent_id };
      const item = await graph('PATCH', `/me/drive/items/${item_id}`, { body: patch });
      return { id: item.id, name: item.name, url: item.webUrl };
    },
  },
  {
    name: 'onedrive_share',
    description: 'Create a sharing link for a OneDrive file.',
    inputSchema: S({
      item_id: str('File or folder id'),
      type: str('Link type: view, edit (default: view)'),
      scope: str('Scope: anonymous, organization (default: anonymous)'),
    }, ['item_id']),
    run: async ({ item_id, type = 'view', scope = 'anonymous' }) => {
      const link = await graph('POST', `/me/drive/items/${item_id}/createLink`, {
        body: { type, scope },
      });
      return { url: link.link?.webUrl, type: link.link?.type, scope: link.link?.scope };
    },
  },

  /* ── Microsoft Teams ───────────────────────────────────────────────── */
  {
    name: 'teams_list',
    description: 'List Microsoft Teams the signed-in user is a member of.',
    inputSchema: S({ top: num('Max results (default 20)') }),
    run: async ({ top = 20 }) => {
      const data = await graph('GET', '/me/joinedTeams', { query: { $top: Math.min(50, Number(top) || 20) } });
      return (data.value ?? []).map((t) => ({ id: t.id, name: t.displayName, description: t.description }));
    },
  },
  {
    name: 'teams_channels',
    description: 'List channels in a Microsoft Team.',
    inputSchema: S({ team_id: str('Team id') }, ['team_id']),
    run: async ({ team_id }) => {
      const data = await graph('GET', `/teams/${team_id}/channels`);
      return (data.value ?? []).map((c) => ({ id: c.id, name: c.displayName, description: c.description }));
    },
  },
  {
    name: 'teams_channel_messages',
    description: 'Read recent messages from a Teams channel.',
    inputSchema: S({
      team_id: str('Team id'),
      channel_id: str('Channel id'),
      top: num('Max messages (1-50, default 20)'),
    }, ['team_id', 'channel_id']),
    run: async ({ team_id, channel_id, top = 20 }) => {
      const data = await graph('GET', `/teams/${team_id}/channels/${channel_id}/messages`, {
        query: { $top: Math.min(50, Number(top) || 20) },
      });
      return (data.value ?? []).map((m) => ({
        id: m.id,
        from: m.from?.user?.displayName,
        body: m.body?.contentType === 'html' ? stripHtml(m.body.content ?? '') : (m.body?.content ?? ''),
        created: m.createdDateTime,
      }));
    },
  },
  {
    name: 'teams_send_message',
    description: 'Send a message to a Teams channel.',
    inputSchema: S({
      team_id: str('Team id'),
      channel_id: str('Channel id'),
      content: str('Message text (plain text or HTML)'),
      html: bool('If true, content is treated as HTML'),
    }, ['team_id', 'channel_id', 'content']),
    run: async ({ team_id, channel_id, content, html = false }) => {
      const msg = await graph('POST', `/teams/${team_id}/channels/${channel_id}/messages`, {
        body: { body: { contentType: html ? 'html' : 'text', content } },
      });
      return { id: msg.id, created: msg.createdDateTime };
    },
  },
  {
    name: 'teams_chats',
    description: 'List Teams personal chats (1:1 and group chats) for the signed-in user.',
    inputSchema: S({ top: num('Max chats (default 20)') }),
    run: async ({ top = 20 }) => {
      const data = await graph('GET', '/me/chats', {
        query: { $top: Math.min(50, Number(top) || 20), $expand: 'members', $select: 'id,chatType,topic,lastUpdatedDateTime' },
      });
      return (data.value ?? []).map((c) => ({
        id: c.id,
        type: c.chatType,
        topic: c.topic,
        lastUpdated: c.lastUpdatedDateTime,
        members: (c.members ?? []).map((m) => m.displayName),
      }));
    },
  },
  {
    name: 'teams_chat_messages',
    description: 'Read recent messages from a Teams 1:1 or group chat.',
    inputSchema: S({ chat_id: str('Chat id'), top: num('Max messages (default 20)') }, ['chat_id']),
    run: async ({ chat_id, top = 20 }) => {
      const data = await graph('GET', `/me/chats/${chat_id}/messages`, {
        query: { $top: Math.min(50, Number(top) || 20) },
      });
      return (data.value ?? []).map((m) => ({
        id: m.id,
        from: m.from?.user?.displayName,
        body: m.body?.contentType === 'html' ? stripHtml(m.body.content ?? '') : (m.body?.content ?? ''),
        created: m.createdDateTime,
      }));
    },
  },
  {
    name: 'teams_send_chat_message',
    description: 'Send a message in a Teams 1:1 or group chat.',
    inputSchema: S({
      chat_id: str('Chat id'),
      content: str('Message text'),
      html: bool('If true, content is treated as HTML'),
    }, ['chat_id', 'content']),
    run: async ({ chat_id, content, html = false }) => {
      const msg = await graph('POST', `/me/chats/${chat_id}/messages`, {
        body: { body: { contentType: html ? 'html' : 'text', content } },
      });
      return { id: msg.id, created: msg.createdDateTime };
    },
  },

  /* ── Microsoft To Do / Tasks ───────────────────────────────────────── */
  {
    name: 'todo_lists',
    description: 'List all Microsoft To Do task lists.',
    inputSchema: S({}),
    run: async () => {
      const data = await graph('GET', '/me/todo/lists');
      return (data.value ?? []).map((l) => ({ id: l.id, name: l.displayName, isDefaultList: l.isDefaultList }));
    },
  },
  {
    name: 'todo_tasks',
    description: 'List tasks in a Microsoft To Do list. Omit list_id to use the default list.',
    inputSchema: S({
      list_id: str('To Do list id (omit for default list)'),
      show_completed: bool('Include completed tasks (default false)'),
    }),
    run: async ({ list_id, show_completed = false }) => {
      let lid = list_id;
      if (!lid) {
        const lists = await graph('GET', '/me/todo/lists');
        lid = (lists.value ?? []).find((l) => l.isDefaultList)?.id ?? (lists.value?.[0]?.id);
        if (!lid) throw new Error('No To Do list found.');
      }
      const filter = show_completed ? undefined : "status ne 'completed'";
      const data = await graph('GET', `/me/todo/lists/${lid}/tasks`, {
        query: { ...(filter ? { $filter: filter } : {}), $orderby: 'createdDateTime desc', $top: 100 },
      });
      return (data.value ?? []).map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        importance: t.importance,
        dueDate: t.dueDateTime?.dateTime,
        body: t.body?.content,
        createdAt: t.createdDateTime,
        completedAt: t.completedDateTime?.dateTime,
      }));
    },
  },
  {
    name: 'todo_create',
    description: 'Create a new Microsoft To Do task.',
    inputSchema: S({
      title: str('Task title'),
      body: str('Task notes/description'),
      due: str('Due date ISO 8601 (e.g. 2026-10-10T00:00:00)'),
      importance: str('Importance: low, normal, high'),
      list_id: str('To Do list id (omit for default list)'),
    }, ['title']),
    run: async ({ title, body, due, importance, list_id }) => {
      let lid = list_id;
      if (!lid) {
        const lists = await graph('GET', '/me/todo/lists');
        lid = (lists.value ?? []).find((l) => l.isDefaultList)?.id ?? lists.value?.[0]?.id;
        if (!lid) throw new Error('No To Do list found.');
      }
      const payload = {
        title,
        ...(body ? { body: { contentType: 'text', content: body } } : {}),
        ...(due ? { dueDateTime: { dateTime: due, timeZone: 'UTC' } } : {}),
        ...(importance ? { importance } : {}),
      };
      const task = await graph('POST', `/me/todo/lists/${lid}/tasks`, { body: payload });
      return { id: task.id, title: task.title, status: task.status };
    },
  },
  {
    name: 'todo_update',
    description: 'Update a Microsoft To Do task (title, status, due date, importance).',
    inputSchema: S({
      task_id: str('Task id'),
      list_id: str('To Do list id (omit for default list)'),
      title: str('New title'),
      status: str('New status: notStarted, inProgress, completed'),
      due: str('New due date ISO 8601'),
      importance: str('New importance: low, normal, high'),
    }, ['task_id']),
    run: async ({ task_id, list_id, title, status, due, importance }) => {
      let lid = list_id;
      if (!lid) {
        const lists = await graph('GET', '/me/todo/lists');
        lid = (lists.value ?? []).find((l) => l.isDefaultList)?.id ?? lists.value?.[0]?.id;
        if (!lid) throw new Error('No To Do list found.');
      }
      const patch = {};
      if (title) patch.title = title;
      if (status) patch.status = status;
      if (due) patch.dueDateTime = { dateTime: due, timeZone: 'UTC' };
      if (status === 'completed') patch.completedDateTime = { dateTime: new Date().toISOString(), timeZone: 'UTC' };
      if (importance) patch.importance = importance;
      const task = await graph('PATCH', `/me/todo/lists/${lid}/tasks/${task_id}`, { body: patch });
      return { id: task.id, title: task.title, status: task.status };
    },
  },
  {
    name: 'todo_delete',
    description: 'Delete a Microsoft To Do task.',
    inputSchema: S({ task_id: str('Task id'), list_id: str('To Do list id (omit for default)') }, ['task_id']),
    run: async ({ task_id, list_id }) => {
      let lid = list_id;
      if (!lid) {
        const lists = await graph('GET', '/me/todo/lists');
        lid = (lists.value ?? []).find((l) => l.isDefaultList)?.id ?? lists.value?.[0]?.id;
        if (!lid) throw new Error('No To Do list found.');
      }
      await graph('DELETE', `/me/todo/lists/${lid}/tasks/${task_id}`);
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
        instructions: 'Microsoft 365 for the account the user connected in DEX: Outlook mail, Calendar, OneDrive/SharePoint files, Teams chats & channels, Microsoft To Do. Prefer these tools over driving Microsoft websites in the browser.',
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
