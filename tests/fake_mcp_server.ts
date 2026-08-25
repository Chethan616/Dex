/**
 * A stand-in MCP server, spoken to over real stdio by the real client.
 *
 * The point is not to simulate Gmail. It is to prove that McpPool actually
 * completes an MCP handshake, that tool discovery and argument binding work
 * against tool names DEX has never seen, and that the read-back path finds a
 * created resource. None of that is testable against Google without an account,
 * and all of it is exactly where this integration breaks.
 *
 * Tool names here are deliberately NOT the ones DEX prefers — `mail_lookup`
 * rather than `search_gmail_messages` — so the test exercises scoring rather
 * than the exact-name shortcut.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

interface StoredMessage {
  id: string;
  to: string;
  subject: string;
  body: string;
}

const sent = new Map<string, StoredMessage>();

const TOOLS = [
  {
    name: 'mail_lookup',
    description: 'Search the mailbox for messages matching a query',
    inputSchema: {
      type: 'object' as const,
      properties: {
        q: { type: 'string', description: 'search query' },
        maxResults: { type: 'number' },
        user_google_email: { type: 'string' },
      },
      required: ['q', 'user_google_email'],
    },
  },
  {
    name: 'mail_fetch_one',
    description: 'Get the full content of one mail message by id',
    inputSchema: {
      type: 'object' as const,
      properties: {
        messageId: { type: 'string' },
        user_google_email: { type: 'string' },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'mail_dispatch',
    description: 'Send an email message to one or more recipients',
    inputSchema: {
      type: 'object' as const,
      properties: {
        toRecipients: { type: 'string' },
        title: { type: 'string' },
        htmlBody: { type: 'string' },
        user_google_email: { type: 'string' },
      },
      required: ['toRecipients', 'title', 'htmlBody'],
    },
  },
  {
    name: 'labels_enumerate',
    description: 'List mailbox labels. Mentions send and search but does neither.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
];

const server = new Server(
  { name: 'fake-workspace', version: '0.0.1' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;

  if (name === 'mail_dispatch') {
    const id = `msg_${sent.size + 1}_abcdef`;
    sent.set(id, {
      id,
      to: String(args.toRecipients ?? ''),
      subject: String(args.title ?? ''),
      body: String(args.htmlBody ?? ''),
    });
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: true, messageId: id }) }],
    };
  }

  if (name === 'mail_fetch_one') {
    const message = sent.get(String(args.messageId ?? ''));
    if (!message) {
      return { content: [{ type: 'text', text: 'not found' }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify(message) }] };
  }

  if (name === 'mail_lookup') {
    const query = String(args.q ?? '');
    const hits = [...sent.values()].filter(
      (m) => m.id.includes(query) || m.subject.includes(query),
    );
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query,
            max: args.maxResults ?? null,
            actingAs: args.user_google_email ?? null,
            hits,
          }),
        },
      ],
    };
  }

  if (name === 'labels_enumerate') {
    return { content: [{ type: 'text', text: JSON.stringify(['INBOX', 'SENT']) }] };
  }

  return { content: [{ type: 'text', text: `no such tool ${name}` }], isError: true };
});

void server.connect(new StdioServerTransport());
