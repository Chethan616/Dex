/**
 * Every credential Dex looks for, what it powers, and how to get one.
 *
 * This list is the single source of truth. `scripts/dex-cred.ts` reads it so
 * `npm run cred -- list` and the Settings screen can never disagree about what
 * Dex needs, and the Settings UI renders it directly rather than restating it
 * in Dart — a second copy is a second thing to forget to update.
 *
 * The `note` field carries the part people actually get wrong. A link to a
 * console is not useful on its own; "free tier, but 20 requests per DAY, and
 * one GUI task spends about 30" is the sentence that saves someone an
 * afternoon.
 */

export type ProviderGroup = 'brain' | 'vision' | 'workspace' | 'channels';

export interface CredentialSpec {
  /** The name it is stored under. Matches the argument to `npm run cred -- set`. */
  name: string;
  /** What a person calls it. */
  label: string;
  group: ProviderGroup;
  /** What stops working without it. */
  powers: string;
  /** Where to get one. */
  source: string;
  url?: string;
  /** The thing that is not obvious from the link. */
  note?: string;
  /** True when Dex cannot plan at all unless one of the brain keys is present. */
  secret: boolean;
}

export const CREDENTIALS: CredentialSpec[] = [
  {
    name: 'groq_api_key',
    label: 'Groq',
    group: 'brain',
    powers: 'The Brain — every plan Dex makes. This is the default.',
    source: 'console.groq.com',
    url: 'https://console.groq.com/keys',
    note: 'Free tier, and generous enough for real use. What Dex is tuned for.',
    secret: true,
  },
  {
    name: 'anthropic_api_key',
    label: 'Anthropic',
    group: 'brain',
    powers:
      'The Brain (alternative), the browser agent, and the vision agent’s worker loop.',
    source: 'console.anthropic.com',
    url: 'https://console.anthropic.com/settings/keys',
    note: 'Paid. If you have a Claude Pro or Max subscription, use the Claude Code card instead — it costs nothing extra.',
    secret: true,
  },
  {
    name: 'gemini_api_key',
    label: 'Google AI Studio',
    group: 'vision',
    powers: 'Fallback grounding for the vision agent — finding controls on screen.',
    source: 'aistudio.google.com',
    url: 'https://aistudio.google.com/apikey',
    note: 'Free tier is 20 requests per DAY. One GUI task spends about 30, so this runs out on the first task. Treat it as a fallback, not a brain.',
    secret: true,
  },
  {
    name: 'google_oauth_client_id',
    label: 'Google OAuth client id',
    group: 'workspace',
    powers: 'Gmail, Calendar and Drive.',
    source: 'Google Cloud console — create an OAuth desktop client',
    url: 'https://console.cloud.google.com/apis/credentials',
    secret: true,
  },
  {
    name: 'google_oauth_client_secret',
    label: 'Google OAuth client secret',
    group: 'workspace',
    powers: 'Gmail, Calendar and Drive.',
    source: 'The same OAuth client as the id above',
    url: 'https://console.cloud.google.com/apis/credentials',
    secret: true,
  },
  {
    name: 'google_account_email',
    label: 'Google account',
    group: 'workspace',
    powers: 'Which account Dex acts as.',
    source: 'Your own address',
    note: 'Not a secret, but it is kept with them so there is one place to look.',
    secret: false,
  },
  {
    name: 'ms365_client_id',
    label: 'Microsoft 365 client id',
    group: 'workspace',
    powers: 'Outlook, Calendar and OneDrive, instead of Google.',
    source: 'Azure portal — app registration',
    url: 'https://portal.azure.com',
    secret: true,
  },
  {
    name: 'ms365_client_secret',
    label: 'Microsoft 365 client secret',
    group: 'workspace',
    powers: 'Outlook, Calendar and OneDrive.',
    source: 'The same app registration',
    url: 'https://portal.azure.com',
    secret: true,
  },
  {
    name: 'ms365_tenant_id',
    label: 'Microsoft 365 tenant id',
    group: 'workspace',
    powers: 'Which directory the app registration belongs to.',
    source: 'The same app registration',
    secret: true,
  },
  {
    name: 'ms365_account_email',
    label: 'Microsoft account',
    group: 'workspace',
    powers: 'Which account Dex acts as.',
    source: 'Your own address',
    secret: false,
  },
  {
    name: 'telegram_bot_token',
    label: 'Telegram bot',
    group: 'channels',
    powers: 'Talking to Dex from Telegram.',
    source: 'Message @BotFather and use /newbot',
    url: 'https://t.me/BotFather',
    note: 'Also set your own Telegram user id below, or the bot will refuse everyone.',
    secret: true,
  },
  {
    name: 'discord_bot_token',
    label: 'Discord bot',
    group: 'channels',
    powers: 'Talking to Dex from Discord.',
    source: 'Discord developer portal — Bot → Reset Token',
    url: 'https://discord.com/developers/applications',
    note: 'Also set your own Discord user id below.',
    secret: true,
  },
];

export const CREDENTIALS_BY_NAME: Map<string, CredentialSpec> = new Map(
  CREDENTIALS.map((c) => [c.name, c]),
);

/** Which brain providers exist, and what a working configuration looks like. */
export interface BrainProviderSpec {
  id: string;
  label: string;
  /** The credential it needs, or null when it authenticates some other way. */
  credential: string | null;
  defaultModel: string;
  blurb: string;
}

export const BRAIN_PROVIDERS: BrainProviderSpec[] = [
  {
    id: 'groq',
    label: 'Groq',
    credential: 'groq_api_key',
    defaultModel: 'openai/gpt-oss-120b',
    blurb: 'Fast and free. The default, and what Dex is tuned against.',
  },
  {
    id: 'anthropic',
    label: 'Anthropic API',
    credential: 'anthropic_api_key',
    defaultModel: 'claude-sonnet-4-6',
    blurb: 'Strongest planning. Billed per token against an API key.',
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    credential: null,
    defaultModel: 'sonnet',
    blurb:
      'Uses the Claude Code you are already signed in to on this machine. No API key, and nothing extra to pay if you have Claude Pro or Max.',
  },
];
