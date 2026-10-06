/**
 * The Marketplace's hosted connectors: services that run their own MCP
 * server, reached with one sign-in in the user's browser.
 *
 * Every OAuth entry here was checked on 2026-10-07 for the MCP authorization
 * spec — protected-resource metadata, an authorization server with dynamic
 * client registration and PKCE — and for accepting DEX's loopback redirect
 * (http://127.0.0.1:<port>/callback), so DEX needs no app registered with
 * each service: it registers itself the first time you connect. "none"
 * entries answer without signing in.
 *
 * Left out because their servers refuse an app like DEX's today: Figma and
 * QuickBooks (registration closed), Calendly (https redirects only), Gamma
 * and PitchBook (loopback redirects refused).
 *
 * The built-in connectors (Google, Microsoft 365, GitHub, Slack, Reddit,
 * Hugging Face, Blender, WhatsApp) live in main/mcp/catalog.ts and
 * main/accounts; the Marketplace lists them alongside these.
 */

export type ConnectorCategory =
  | 'Productivity'
  | 'Meetings & notes'
  | 'Developer tools'
  | 'Design & media'
  | 'Files'
  | 'Sales & support'
  | 'Finance & business'
  | 'Research & health'
  | 'Travel & food'
  | 'Communication';

export type Audience = 'student' | 'work' | 'engineer' | 'doctor' | 'creator' | 'business';

export interface ConnectorMark {
  /** One or two letters, drawn on the brand colour. */
  text: string;
  bg: string;
  fg?: string;
}

export interface HostedConnector {
  id: string;
  name: string;
  blurb: string;
  category: ConnectorCategory;
  audiences: Audience[];
  /** The service's MCP endpoint. A path ending in /sse is the older SSE transport. */
  url: string;
  auth: 'oauth' | 'none';
  mark: ConnectorMark;
  featured?: boolean;
  /** Only useful with a paid plan of the service. */
  needsPlan?: boolean;
}

const m = (text: string, bg: string, fg = '#fff'): ConnectorMark => ({ text, bg, fg });

export const HOSTED_CONNECTORS: HostedConnector[] = [
  // Productivity
  { id: 'notion', name: 'Notion', blurb: 'Search, read and write pages and databases in your workspace.', category: 'Productivity', audiences: ['student', 'work', 'engineer', 'creator', 'business'], url: 'https://mcp.notion.com/mcp', auth: 'oauth', mark: m('N', '#191919'), featured: true },
  { id: 'todoist', name: 'Todoist', blurb: 'Your tasks and projects: add, schedule, finish.', category: 'Productivity', audiences: ['student', 'work'], url: 'https://ai.todoist.net/mcp', auth: 'oauth', mark: m('T', '#e44332'), featured: true },
  { id: 'clickup', name: 'ClickUp', blurb: 'Tasks, docs and goals across your spaces.', category: 'Productivity', audiences: ['work', 'business'], url: 'https://mcp.clickup.com/mcp', auth: 'oauth', mark: m('C', '#7b68ee') },
  { id: 'monday', name: 'monday.com', blurb: 'Boards, items and updates for your team’s work.', category: 'Productivity', audiences: ['work', 'business'], url: 'https://mcp.monday.com/mcp', auth: 'oauth', mark: m('m', '#ff3d57') },
  { id: 'asana', name: 'Asana', blurb: 'Projects, tasks and who’s on what.', category: 'Productivity', audiences: ['work', 'business'], url: 'https://mcp.asana.com/sse', auth: 'oauth', mark: m('A', '#f06a6a') },
  { id: 'airtable', name: 'Airtable', blurb: 'Read and update the bases you run things on.', category: 'Productivity', audiences: ['work', 'business', 'engineer'], url: 'https://mcp.airtable.com/mcp', auth: 'oauth', mark: m('A', '#18bfff') },
  { id: 'zapier', name: 'Zapier', blurb: 'Reach thousands of apps through your Zapier actions.', category: 'Productivity', audiences: ['work', 'business'], url: 'https://mcp.zapier.com/api/mcp/mcp', auth: 'oauth', mark: m('Z', '#ff4f00'), featured: true },

  // Meetings & notes
  { id: 'granola', name: 'Granola', blurb: 'Your meeting notes and transcripts.', category: 'Meetings & notes', audiences: ['work', 'business'], url: 'https://mcp.granola.ai/mcp', auth: 'oauth', mark: m('G', '#c8d94a', '#1b1b1b') },
  { id: 'fireflies', name: 'Fireflies', blurb: 'Meeting transcripts, summaries and action items.', category: 'Meetings & notes', audiences: ['work', 'business'], url: 'https://api.fireflies.ai/mcp', auth: 'oauth', mark: m('F', '#5a33e8') },

  // Developer tools
  { id: 'linear', name: 'Linear', blurb: 'Issues, projects and cycles.', category: 'Developer tools', audiences: ['engineer', 'work'], url: 'https://mcp.linear.app/mcp', auth: 'oauth', mark: m('L', '#5e6ad2'), featured: true },
  { id: 'atlassian', name: 'Jira & Confluence', blurb: 'Atlassian issues and pages: search, create, update.', category: 'Developer tools', audiences: ['engineer', 'work', 'business'], url: 'https://mcp.atlassian.com/v1/mcp', auth: 'oauth', mark: m('A', '#0052cc'), featured: true },
  { id: 'gitlab', name: 'GitLab', blurb: 'Projects, merge requests, issues and pipelines.', category: 'Developer tools', audiences: ['engineer'], url: 'https://gitlab.com/api/v4/mcp', auth: 'oauth', mark: m('G', '#fc6d26') },
  { id: 'sentry', name: 'Sentry', blurb: 'Errors and performance issues, with their stack traces.', category: 'Developer tools', audiences: ['engineer'], url: 'https://mcp.sentry.dev/mcp', auth: 'oauth', mark: m('S', '#362d59') },
  { id: 'vercel', name: 'Vercel', blurb: 'Projects, deployments and their logs.', category: 'Developer tools', audiences: ['engineer'], url: 'https://mcp.vercel.com', auth: 'oauth', mark: m('▲', '#000000') },
  { id: 'netlify', name: 'Netlify', blurb: 'Sites, deploys and settings.', category: 'Developer tools', audiences: ['engineer'], url: 'https://netlify-mcp.netlify.app/mcp', auth: 'oauth', mark: m('N', '#00ad9f') },
  { id: 'supabase', name: 'Supabase', blurb: 'Your databases, tables, functions and logs.', category: 'Developer tools', audiences: ['engineer'], url: 'https://mcp.supabase.com/mcp', auth: 'oauth', mark: m('S', '#3ecf8e', '#0b2a1c') },
  { id: 'neon', name: 'Neon', blurb: 'Serverless Postgres: branches, queries, migrations.', category: 'Developer tools', audiences: ['engineer'], url: 'https://mcp.neon.tech/mcp', auth: 'oauth', mark: m('N', '#00e599', '#0b2a1c') },
  { id: 'prisma', name: 'Prisma Postgres', blurb: 'Databases and schema changes.', category: 'Developer tools', audiences: ['engineer'], url: 'https://mcp.prisma.io/mcp', auth: 'oauth', mark: m('P', '#2d3748') },
  { id: 'cloudflare', name: 'Cloudflare', blurb: 'Workers, KV, R2 and D1 in your account.', category: 'Developer tools', audiences: ['engineer'], url: 'https://bindings.mcp.cloudflare.com/mcp', auth: 'oauth', mark: m('C', '#f38020') },
  { id: 'postman', name: 'Postman', blurb: 'Your API collections, requests and environments.', category: 'Developer tools', audiences: ['engineer'], url: 'https://mcp.postman.com/mcp', auth: 'oauth', mark: m('P', '#ff6c37') },
  { id: 'semgrep', name: 'Semgrep', blurb: 'Scan code for security issues.', category: 'Developer tools', audiences: ['engineer'], url: 'https://mcp.semgrep.ai/mcp', auth: 'oauth', mark: m('S', '#2c3e50') },
  { id: 'jam', name: 'Jam', blurb: 'Bug reports with recordings, console and network logs.', category: 'Developer tools', audiences: ['engineer'], url: 'https://mcp.jam.dev/mcp', auth: 'oauth', mark: m('J', '#ff5c35') },
  { id: 'context7', name: 'Context7', blurb: 'Up-to-date docs and code examples for any library. No sign-in.', category: 'Developer tools', audiences: ['engineer', 'student'], url: 'https://mcp.context7.com/mcp', auth: 'none', mark: m('C7', '#059669') },
  { id: 'deepwiki', name: 'DeepWiki', blurb: 'Ask questions about any public GitHub repository. No sign-in.', category: 'Developer tools', audiences: ['engineer', 'student'], url: 'https://mcp.deepwiki.com/mcp', auth: 'none', mark: m('DW', '#1f6feb') },
  { id: 'cloudflare-docs', name: 'Cloudflare Docs', blurb: 'Search Cloudflare’s documentation. No sign-in.', category: 'Developer tools', audiences: ['engineer'], url: 'https://docs.mcp.cloudflare.com/mcp', auth: 'none', mark: m('CD', '#f38020') },

  // Design & media
  { id: 'canva', name: 'Canva', blurb: 'Find, make and edit your designs.', category: 'Design & media', audiences: ['student', 'creator', 'work', 'business'], url: 'https://mcp.canva.com/mcp', auth: 'oauth', mark: m('C', '#00c4cc'), featured: true },
  { id: 'miro', name: 'Miro', blurb: 'Boards, sticky notes and diagrams.', category: 'Design & media', audiences: ['work', 'student', 'creator'], url: 'https://mcp.miro.com/', auth: 'oauth', mark: m('M', '#ffd02f', '#050038') },
  { id: 'excalidraw', name: 'Excalidraw', blurb: 'Hand-drawn style diagrams. No sign-in.', category: 'Design & media', audiences: ['student', 'engineer', 'creator'], url: 'https://mcp.excalidraw.com/mcp', auth: 'none', mark: m('E', '#6965db') },
  { id: 'mermaid', name: 'Mermaid Chart', blurb: 'Flowcharts and diagrams from text.', category: 'Design & media', audiences: ['engineer', 'student'], url: 'https://mcp.mermaidchart.com/mcp', auth: 'oauth', mark: m('M', '#ff3670') },
  { id: 'webflow', name: 'Webflow', blurb: 'Sites, pages and CMS collections.', category: 'Design & media', audiences: ['creator', 'business'], url: 'https://mcp.webflow.com/mcp', auth: 'oauth', mark: m('W', '#146ef5') },
  { id: 'wix', name: 'Wix', blurb: 'Your Wix sites, stores and bookings.', category: 'Design & media', audiences: ['creator', 'business'], url: 'https://mcp.wix.com/mcp', auth: 'oauth', mark: m('W', '#0c6efc') },
  { id: 'cloudinary', name: 'Cloudinary', blurb: 'Images and videos in your media library.', category: 'Design & media', audiences: ['creator', 'engineer'], url: 'https://asset-management.mcp.cloudinary.com/mcp', auth: 'oauth', mark: m('C', '#3448c5') },
  { id: 'invideo', name: 'invideo AI', blurb: 'Make videos from a script or an idea.', category: 'Design & media', audiences: ['creator'], url: 'https://mcp.invideo.io/sse', auth: 'oauth', mark: m('i', '#5b2be0') },

  // Files
  { id: 'dropbox', name: 'Dropbox', blurb: 'Find, read and organise your files.', category: 'Files', audiences: ['student', 'work', 'business'], url: 'https://mcp.dropbox.com/mcp', auth: 'oauth', mark: m('D', '#0061fe'), featured: true },
  { id: 'egnyte', name: 'Egnyte', blurb: 'Your company’s files and folders.', category: 'Files', audiences: ['work', 'business'], url: 'https://mcp-server.egnyte.com/mcp', auth: 'oauth', mark: m('E', '#00a4a6'), needsPlan: true },

  // Sales & support
  { id: 'intercom', name: 'Intercom', blurb: 'Conversations, contacts and help articles.', category: 'Sales & support', audiences: ['business'], url: 'https://mcp.intercom.com/mcp', auth: 'oauth', mark: m('I', '#1f8ded') },
  { id: 'close', name: 'Close', blurb: 'Leads, opportunities and calls in your CRM.', category: 'Sales & support', audiences: ['business'], url: 'https://mcp.close.com/mcp', auth: 'oauth', mark: m('C', '#2a73eb') },
  { id: 'attio', name: 'Attio', blurb: 'Records, lists and notes in your CRM.', category: 'Sales & support', audiences: ['business'], url: 'https://mcp.attio.com/mcp', auth: 'oauth', mark: m('A', '#1a1a1a') },

  // Finance & business
  { id: 'stripe', name: 'Stripe', blurb: 'Payments, customers, invoices and subscriptions.', category: 'Finance & business', audiences: ['business', 'engineer'], url: 'https://mcp.stripe.com', auth: 'oauth', mark: m('S', '#635bff'), featured: true },
  { id: 'paypal', name: 'PayPal', blurb: 'Invoices, orders and transactions.', category: 'Finance & business', audiences: ['business'], url: 'https://mcp.paypal.com/mcp', auth: 'oauth', mark: m('P', '#003087') },
  { id: 'square', name: 'Square', blurb: 'Your shop: orders, items, customers, payments.', category: 'Finance & business', audiences: ['business'], url: 'https://mcp.squareup.com/sse', auth: 'oauth', mark: m('□', '#000000') },
  { id: 'ramp', name: 'Ramp', blurb: 'Company cards, spend and bills.', category: 'Finance & business', audiences: ['business'], url: 'https://ramp-mcp-remote.ramp.com/mcp', auth: 'oauth', mark: m('R', '#e4f222', '#1b1b1b'), needsPlan: true },
  { id: 'plaid', name: 'Plaid', blurb: 'Your Plaid developer dashboard and integrations.', category: 'Finance & business', audiences: ['engineer', 'business'], url: 'https://api.dashboard.plaid.com/mcp/sse', auth: 'oauth', mark: m('P', '#111111') },
  { id: 'morningstar', name: 'Morningstar', blurb: 'Fund and stock research, for subscribers.', category: 'Finance & business', audiences: ['business'], url: 'https://mcp.morningstar.com/mcp', auth: 'oauth', mark: m('M', '#e5212c'), needsPlan: true },

  // Research & health
  { id: 'pubmed', name: 'PubMed', blurb: 'Search biomedical literature and read abstracts. No sign-in.', category: 'Research & health', audiences: ['doctor', 'student'], url: 'https://pubmed.mcp.claude.com/mcp', auth: 'none', mark: m('Pm', '#20558a'), featured: true },
  { id: 'scholar-gateway', name: 'Scholar Gateway', blurb: 'Peer-reviewed research, with citations.', category: 'Research & health', audiences: ['student', 'doctor', 'engineer'], url: 'https://connector.scholargateway.ai/mcp', auth: 'oauth', mark: m('SG', '#7b1f3a') },
  { id: 'biorender', name: 'BioRender', blurb: 'Scientific figures and icons.', category: 'Research & health', audiences: ['doctor', 'student'], url: 'https://mcp.services.biorender.com/mcp', auth: 'oauth', mark: m('B', '#0e9f6e') },
  { id: 'huggingface-hub', name: 'Hugging Face Hub', blurb: 'Search models, datasets, papers and Spaces. No sign-in.', category: 'Research & health', audiences: ['engineer', 'student'], url: 'https://huggingface.co/mcp', auth: 'none', mark: m('🤗', '#ffd21e', '#1b1b1b') },
  { id: 'exa', name: 'Exa', blurb: 'Web search built for AI: fresh pages and code. No sign-in.', category: 'Research & health', audiences: ['student', 'engineer', 'work'], url: 'https://mcp.exa.ai/mcp', auth: 'none', mark: m('E', '#1f40ed') },

  // Travel & food
  { id: 'kiwi', name: 'Kiwi.com flights', blurb: 'Search flights between any two places, with booking links. No sign-in.', category: 'Travel & food', audiences: ['student', 'work', 'business'], url: 'https://mcp.kiwi.com', auth: 'none', mark: m('K', '#00a991'), featured: true },
];

export const AUDIENCES: Array<{ id: Audience; label: string }> = [
  { id: 'student', label: 'Students' },
  { id: 'work', label: 'Work' },
  { id: 'engineer', label: 'Engineers' },
  { id: 'doctor', label: 'Doctors & science' },
  { id: 'creator', label: 'Creators' },
  { id: 'business', label: 'Business' },
];

export function hostedConnector(id: string): HostedConnector | undefined {
  return HOSTED_CONNECTORS.find((c) => c.id === id);
}

/**
 * The MCP connection id a hosted connector is stored under. Underscores, not
 * hyphens: engines name its tools mcp__<id>__<tool>.
 */
export function remoteConnectionId(id: string): string {
  return `remote_${id.replace(/[^A-Za-z0-9]/g, '_')}`;
}
