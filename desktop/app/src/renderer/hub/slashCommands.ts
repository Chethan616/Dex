/**
 * Slash commands.
 *
 * A command is just a prompt template. When the user opens their message with
 * `/scrape vit.ac.in`, the text is expanded — before it ever reaches the
 * engine — into the full instruction the agent should act on, pointing it at
 * the matching skill file in the harness. The agent contract stays "run this
 * prompt"; there is no second dispatcher, no new event type, nothing for the
 * engine to learn.
 *
 * Anything that is not a recognised command passes through untouched, so a
 * message that merely happens to start with a slash is never mangled.
 */

export interface SlashCommand {
  name: string;
  /** Shown in the hint row: `/scrape <url>`. */
  usage: string;
  summary: string;
  /** True when the command cannot do anything useful without an argument. */
  requiresArg: boolean;
  /** Turn the argument string into the prompt the agent receives. */
  expand: (arg: string) => string;
}

/** Normalise a user-typed target into a bare hostname for naming the memory file. */
function hostOf(raw: string): string {
  const trimmed = raw.trim().replace(/^@/, '');
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    // Not a URL at all — hand back a filesystem-safe token so the prompt is
    // still usable and the agent can decide what to do with it.
    return trimmed.replace(/[^a-zA-Z0-9.-]/g, '_') || 'site';
  }
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'scrape',
    usage: '/scrape <url>',
    summary: 'Map a site into memory — its pages, navigation, and where each control lives.',
    requiresArg: true,
    expand: (arg) => {
      const host = hostOf(arg);
      return [
        `Build a site map of ${arg} and save it to DEX's site memory.`,
        '',
        'Read `./dex-tools/scrape.md` and follow it exactly. In short: visit the',
        'main sections, and for each page record its URL, its purpose, the',
        'navigation links out of it, and the important controls (buttons, forms,',
        'search boxes) with where on the page they sit. The point is that a later',
        'task can read this instead of re-exploring the site every time.',
        '',
        `Save the map as \`$DEX_SITE_MEMORY_DIR/${host}.md\` (create the folder if`,
        'it does not exist), and record it with `dex-state file` so it shows in',
        'the results.',
      ].join('\n');
    },
  },
  {
    name: 'bugbounty',
    usage: '/bugbounty <url>',
    summary: 'Authorized security-posture review of a site you own or may test.',
    requiresArg: true,
    expand: (arg) => {
      return [
        `Run an authorized security-posture review of ${arg}.`,
        '',
        'Read `./dex-tools/bugbounty.md` and follow it exactly, starting with the',
        'authorization check at the top — do not skip it. This review is limited',
        'to what is observable without attacking the target: security headers,',
        'TLS configuration, exposed common paths, out-of-date client libraries,',
        'form and cookie hygiene, and information disclosure. No exploitation, no',
        'authentication bypass, no injection or fuzzing against live systems, no',
        'load testing.',
        '',
        'Produce a findings report — each item with a severity, what was',
        'observed, why it matters, and how to fix it — and save it to',
        `\`$DEX_SITE_MEMORY_DIR/${hostOf(arg)}.security.md\`.`,
      ].join('\n');
    },
  },
];

const COMMAND_BY_NAME = new Map(SLASH_COMMANDS.map((command) => [command.name, command]));

export interface SlashExpansion {
  /** The prompt to actually submit. */
  prompt: string;
  /** The command that matched, when one did. */
  command?: SlashCommand;
  /** Set when a known command was used without its required argument. */
  error?: string;
}

/**
 * Expand a raw input if it opens with a known command.
 *
 * Returns the input unchanged when nothing matches, so ordinary prompts — and
 * unknown slashes, which may be deliberate — are never rewritten.
 */
export function expandSlashCommand(raw: string): SlashExpansion {
  const text = raw.trimStart();
  if (!text.startsWith('/')) return { prompt: raw };

  const match = /^\/([a-zA-Z][\w-]*)\s*([\s\S]*)$/.exec(text);
  if (!match) return { prompt: raw };

  const command = COMMAND_BY_NAME.get(match[1].toLowerCase());
  if (!command) return { prompt: raw };

  const arg = match[2].trim();
  if (command.requiresArg && arg.length === 0) {
    return { prompt: raw, command, error: `${command.usage} — needs a target.` };
  }

  return { prompt: command.expand(arg), command };
}

/** Commands whose name begins with the partial the user has typed after `/`. */
export function matchingCommands(raw: string): SlashCommand[] {
  const text = raw.trimStart();
  if (!text.startsWith('/')) return [];
  // Only while still typing the command word — once there is a space, the
  // command is chosen and the rest is its argument.
  if (/\s/.test(text)) return [];
  const partial = text.slice(1).toLowerCase();
  return SLASH_COMMANDS.filter((command) => command.name.startsWith(partial));
}
