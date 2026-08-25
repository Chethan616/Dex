/**
 * Maps DEX's fixed vocabulary onto whatever an MCP server happens to call
 * things.
 *
 * The Brain plans against a stable action set — `send_email`, `search_drive` —
 * because a plan that names `search_gmail_messages` breaks the day the owner
 * switches from Gmail to Outlook, and because tool names drift between
 * releases of the same server. So nothing here hardcodes a tool name as truth:
 * a server is asked what it can do, and DEX matches against that.
 *
 * Everything in this file is pure. It takes a tool list and some parameters and
 * returns a decision — no I/O, no spawning, no network — which is what makes it
 * testable without a Google account.
 */

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
}

export interface ActionSpec {
  /** Exact tool names to take without scoring, best first. */
  prefer: string[];
  /** Every group must match for a tool to be a candidate at all. */
  require: RegExp[];
  /** Tools matching any of these are disqualified outright. */
  exclude?: RegExp[];
}

/**
 * `require` groups are deliberately loose alternations: they filter the tool
 * list down to plausible candidates, and `score` picks between them. Being too
 * strict here is how you end up matching nothing on a server that spells it
 * `gmail_search_messages`.
 */
export const ACTION_SPECS: Record<string, ActionSpec> = {
  search_email: {
    prefer: ['search_gmail_messages', 'search_messages', 'search_emails', 'list_mail_messages'],
    require: [/search|query|list|find/, /mail|message|email/],
    exclude: [/send|draft|delete|trash|attachment|label/],
  },
  read_email: {
    prefer: ['get_gmail_message_content', 'get_message', 'read_email', 'get_mail_message'],
    require: [/get|read|fetch|content/, /mail|message|email/],
    exclude: [/send|draft|delete|list|search/],
  },
  send_email: {
    prefer: ['send_gmail_message', 'send_email', 'send_mail', 'send_message'],
    require: [/send/, /mail|message|email/],
    exclude: [/draft|schedule/],
  },
  list_calendar_events: {
    prefer: ['get_events', 'list_events', 'list_calendar_events', 'search_events'],
    require: [/list|get|search|query/, /event|calendar/],
    exclude: [/create|update|delete|insert|modify/],
  },
  create_calendar_event: {
    prefer: ['create_event', 'create_calendar_event', 'add_event', 'insert_event'],
    require: [/create|add|insert|new|schedule/, /event|calendar|meeting/],
    exclude: [/delete|list|search|update/],
  },
  search_drive: {
    prefer: ['search_drive_files', 'search_files', 'list_drive_files', 'drive_search'],
    require: [/search|list|find|query/, /drive|file|document|onedrive/],
    exclude: [/delete|upload|create|content|download/],
  },
  read_drive_file: {
    prefer: ['get_drive_file_content', 'read_file', 'get_file_content', 'download_file'],
    require: [/get|read|content|download|fetch/, /drive|file|document/],
    exclude: [/list|search|delete|upload|create/],
  },
};

/** Read-back tools, used to confirm a write actually landed. */
export const READBACK_FOR: Record<string, string> = {
  send_email: 'read_email',
  create_calendar_event: 'list_calendar_events',
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

/**
 * Picks the tool that best fits an action, or explains why none did.
 *
 * Deliberately returns a reason rather than throwing: "this server advertises
 * 31 tools and none of them send mail" is something the owner should read on
 * the bar, not a stack trace in a log file.
 */
export function resolveTool(
  action: string,
  tools: McpTool[],
): { tool: McpTool } | { error: string } {
  const spec = ACTION_SPECS[action];
  if (!spec) return { error: `No tool mapping defined for action "${action}"` };

  for (const wanted of spec.prefer) {
    const exact = tools.find((t) => t.name.toLowerCase() === wanted.toLowerCase());
    if (exact) return { tool: exact };
  }

  const candidates = tools.filter((tool) => {
    const haystack = `${normalize(tool.name)} ${normalize(tool.description ?? '')}`;
    if (spec.exclude?.some((re) => re.test(normalize(tool.name)))) return false;
    return spec.require.every((re) => re.test(haystack));
  });

  if (candidates.length === 0) {
    return {
      error:
        `No tool on this server matches "${action}". It offers: ` +
        `${tools.map((t) => t.name).slice(0, 12).join(', ')}${tools.length > 12 ? '…' : ''}`,
    };
  }

  // Name matches beat description matches: a tool called `send_email` is a
  // better bet than one called `list_labels` whose docs mention sending.
  const ranked = candidates
    .map((tool) => ({ tool, score: score(tool, spec) }))
    .sort((a, b) => b.score - a.score);

  return { tool: ranked[0].tool };
}

function score(tool: McpTool, spec: ActionSpec): number {
  const name = normalize(tool.name);
  let points = 0;
  for (const re of spec.require) {
    if (re.test(name)) points += 10;
  }
  // Shorter names are usually the general-purpose tool rather than a narrow
  // variant (`send_email` over `send_email_with_attachments_and_cc`).
  points -= Math.min(name.length / 10, 5);
  return points;
}

/**
 * DEX's canonical parameter names, and everything the wild has called them.
 * Compared with punctuation and case stripped, so `maxResults`, `max_results`
 * and `MAX-RESULTS` are one thing.
 */
const SYNONYMS: Record<string, string[]> = {
  query: ['query', 'q', 'search', 'searchquery', 'keyword', 'keywords', 'filter', 'searchterm'],
  max: ['max', 'maxresults', 'limit', 'count', 'pagesize', 'top', 'n', 'numresults'],
  id: [
    'id', 'messageid', 'mailid', 'emailid', 'eventid', 'fileid', 'documentid',
    'itemid', 'resourceid',
  ],
  to: ['to', 'recipient', 'recipients', 'torecipients', 'toaddresses', 'sendto'],
  cc: ['cc', 'ccrecipients'],
  subject: ['subject', 'title', 'summary'],
  body: ['body', 'message', 'content', 'text', 'bodytext', 'htmlbody', 'messagebody', 'description'],
  start: ['start', 'starttime', 'startdatetime', 'from', 'timemin', 'begin', 'startdate'],
  end: ['end', 'endtime', 'enddatetime', 'until', 'timemax', 'enddate'],
  attendees: ['attendees', 'participants', 'guests', 'invitees'],
  calendar: ['calendarid', 'calendar', 'calendarname'],
};

/** Schema properties that mean "which account am I acting as". */
const IDENTITY_PROP = /^(user_?google_?email|user_?email|account_?email|mailbox|user_?id|principal)$/i;

export interface BindResult {
  args: Record<string, unknown>;
  /** Required schema properties nothing could fill. */
  missing: string[];
}

/**
 * Fills a tool's advertised input schema from DEX's canonical parameters.
 *
 * Only properties the schema declares are ever sent. An MCP server that
 * validates strictly will reject extras, and a server that does not would
 * silently ignore them — either way, guessing at undeclared arguments only
 * produces confusing failures.
 */
export function bindArgs(
  tool: McpTool,
  params: Record<string, unknown>,
  identity?: string,
): BindResult {
  const schema = tool.inputSchema;
  const properties = schema?.properties ?? {};
  const required = schema?.required ?? [];
  const args: Record<string, unknown> = {};

  const canon = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

  for (const prop of Object.keys(properties)) {
    const key = canon(prop);

    if (IDENTITY_PROP.test(prop)) {
      if (identity) args[prop] = identity;
      continue;
    }

    // An exact canonical-name hit wins over a synonym from another parameter.
    const direct = Object.keys(params).find((p) => canon(p) === key);
    if (direct !== undefined && params[direct] !== undefined) {
      args[prop] = params[direct];
      continue;
    }

    for (const [canonical, aliases] of Object.entries(SYNONYMS)) {
      if (params[canonical] === undefined) continue;
      if (aliases.includes(key)) {
        args[prop] = params[canonical];
        break;
      }
    }
  }

  const missing = required.filter(
    (prop) => args[prop] === undefined && !IDENTITY_PROP.test(prop),
  );

  return { args, missing };
}

/**
 * Digs an identifier out of an MCP result so a write can be read back.
 * Returns undefined when there is nothing to check — which the caller must
 * treat as "unverified", never as "fine".
 */
export function extractId(payload: unknown, depth = 0): string | undefined {
  if (depth > 4 || payload == null) return undefined;

  if (typeof payload === 'string') {
    const match = payload.match(
      /\b(?:message|event|file|item)?[ _-]?id["' :=]+([A-Za-z0-9_\-@.]{6,})/i,
    );
    return match?.[1];
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = extractId(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }

  if (typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of ['id', 'messageId', 'message_id', 'eventId', 'event_id', 'fileId']) {
      const value = record[key];
      if (typeof value === 'string' && value.length >= 4) return value;
    }
    for (const value of Object.values(record)) {
      const found = extractId(value, depth + 1);
      if (found) return found;
    }
  }

  return undefined;
}
