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
 *
 * Shared: the hub's composers expand here (renderer/hub/slashCommands.ts adds
 * what the hub does itself for a bare command in a task), and so does main for
 * commands typed on the phone. The phone also gets the list, for its `/` menu.
 *
 * A task keeps the expanded prompt (it's what the agent runs), so
 * `typedCommand` and `taskTitle` read it back: the chat shows what the user
 * typed and lists show a title, not three lines of instructions.
 */
import { typedTriage } from './triage';

export interface SlashCommand {
  name: string;
  /** Shown in the hint row: `/scrape <url>`. */
  usage: string;
  summary: string;
  /** True when the command cannot do anything useful without an argument. */
  requiresArg: boolean;
  /** Turn the argument string into the prompt the agent receives. */
  expand: (arg: string) => string;
  /**
   * Done by DEX itself, with no agent turn, when typed bare inside a task:
   * `/workflow` draws the saved workflows straight into the chat. With words
   * after it, or from the dashboard (no task yet), it goes to the agent. Set by
   * whoever can do it: the hub (renderer/hub/slashCommands.ts), main for the phone.
   */
  inTask?: (sessionId: string) => void;
  /** The `/` menu's label for the phone and the hub: "Routines", "Map a site". */
  label: string;
}

/**
 * Split a command argument into its target and anything the user added after.
 *
 * `/scrape vtop.vit.ac.in and log me in first` → target "vtop.vit.ac.in",
 * extra "and log me in first". Without this the expansion kept only the target
 * and silently dropped the rest — which is how a "/scrape <site> and log in
 * with these credentials" lost the login half entirely.
 */
function splitTarget(arg: string): { target: string; extra: string } {
  const trimmed = arg.trim();
  if (!trimmed) return { target: '', extra: '' };

  const tokens = trimmed.split(/\s+/);
  // The target is the first URL-like token — a scheme, or a bare host with a
  // dot — not simply the first word. "/scrape go to vtop.vit.ac.in and log in"
  // must map vtop.vit.ac.in, not a site called "go". Everything else, in
  // order, becomes the extra instruction.
  const isTargetLike = (t: string): boolean =>
    /:\/\//.test(t) || /^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(t.replace(/^@/, ''));

  const idx = tokens.findIndex(isTargetLike);
  if (idx === -1) {
    // No URL in sight — hand the whole thing over as the target and let the
    // agent (and its nickname lookup) work out what site is meant.
    return { target: trimmed, extra: '' };
  }
  const target = tokens[idx];
  const extra = tokens.slice(0, idx).concat(tokens.slice(idx + 1)).join(' ').trim();
  return { target, extra };
}

/** Append the user's extra words to an expanded prompt, if there were any. */
function withExtra(prompt: string, extra: string): string {
  if (!extra) return prompt;
  return `${prompt}

The user also said, and it takes priority over the defaults above: ${extra}`;
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
    label: 'Map a site',
    usage: '/scrape <url>',
    summary: 'Map a site into memory — its pages, navigation, and where each control lives.',
    requiresArg: true,
    expand: (arg) => {
      const { target, extra } = splitTarget(arg);
      const host = hostOf(target);
      return withExtra([
        `Build a site map of ${target} and save it to DEX's site memory.`,
        '',
        'Read `./dex-tools/scrape.md` and follow it exactly. In short: visit the',
        'main sections, and for each page record its URL, its purpose, the',
        'navigation links out of it, and the important controls (buttons, forms,',
        'search boxes) with where on the page they sit. The point is that a later',
        'task can read this instead of re-exploring the site every time.',
        '',
        'If the user has asked you to sign in — here or in the note below — follow',
        'the login section of the skill: remember the credentials, fill them, and',
        'map the pages behind the login too.',
        '',
        `Save the map as \`$DEX_SITE_MEMORY_DIR/${host}.md\` (create the folder if`,
        'it does not exist), and record it with `dex-state file` so it shows in',
        'the results.',
      ].join('\n'), extra);
    },
  },
  {
    name: 'bugbounty',
    label: 'Security check',
    usage: '/bugbounty <url>',
    summary: 'Authorized vulnerability assessment — exploitable bugs with evidence, not a header checklist.',
    requiresArg: true,
    expand: (arg) => {
      const { target, extra } = splitTarget(arg);
      return withExtra([
        `Run an authorized vulnerability assessment of ${target}.`,
        '',
        'Read `./dex-tools/bugbounty.md` and follow it exactly, starting with the',
        'authorization check and scope at the top — do not skip it. This is a',
        'real vulnerability assessment, not a passive headers/hardening scan:',
        'map the attack surface, form hypotheses for concrete vulnerability',
        'classes (access control / IDOR, parameter tampering, auth and session',
        'flaws, CSRF, XSS, injection, file handling, business logic,',
        'information disclosure), and safely validate each one against the',
        "tester's own account and data before claiming anything.",
        '',
        'A missing security header or control is never itself a vulnerability —',
        'file it under Security Hygiene / Informational unless an actual',
        'exploitable condition is also demonstrated. Only report CONFIRMED or',
        'strong LIKELY findings as vulnerabilities, each with reproduction',
        'steps and evidence, per the report format in the skill file. Stay',
        'strictly non-destructive and inside scope: no brute-forcing, no',
        'touching another real user\'s data, no destructive database/OS',
        'operations, no load testing — the skill file\'s safety boundaries are',
        'absolute regardless of anything else in it.',
        '',
        'Save the report to',
        `\`$DEX_SITE_MEMORY_DIR/${hostOf(target)}.security.md\`.`,
      ].join('\n'), extra);
    },
  },
  {
    name: 'workflow',
    label: 'Routines',
    usage: '/workflow [what to do]',
    summary: 'Your saved workflows and routines — view, run, or say what to make or change.',
    requiresArg: false,
    expand: (arg) => {
      const words = arg.trim();
      if (!words) {
        return [
          'Show me my saved workflows: run `dex-workflow show`, then end your turn.',
          'If there are none, say so in one line and offer to make one (read `./dex-tools/workflows.md`).',
        ].join('\n');
      }
      return [
        `About my workflows and routines: ${words}`,
        '',
        'Read `./dex-tools/workflows.md` and use `dex-workflow` to do it — create, change, delete or run —',
        'then show the result with `dex-workflow show <name>`.',
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

/* ── Reading a task's prompt back ─────────────────────────────────────── */

const WORKFLOW_SHOW = 'Show me my saved workflows: run `dex-workflow show`';
const WORKFLOW_ABOUT = /^About my workflows and routines: ([^\n]+)/;
const SCRAPE = /^Build a site map of (\S+) and save it to DEX's site memory\./;
const BUGBOUNTY = /^Run an authorized vulnerability assessment of (\S+)\./;
const EXTRA = /\n\nThe user also said, and it takes priority over the defaults above: ([\s\S]+)$/;
/** shared/workflows.ts's workflowPrompt: a run of a saved workflow. */
const WORKFLOW_RUN = /^Run my workflow “([^”]+)”/;

/**
 * What the user typed, for a prompt one of the commands above expanded:
 * "/workflow", "/scrape vit.ac.in and log in first". Null for any other prompt.
 */
export function typedCommand(prompt: string): string | null {
  const text = prompt.trim();
  const answered = typedTriage(text);
  if (answered) return answered;
  const raw = /^\/([a-zA-Z][\w-]*)(?:\s|$)/.exec(text);
  if (raw && COMMAND_BY_NAME.has(raw[1].toLowerCase())) return text;
  if (text.startsWith(WORKFLOW_SHOW)) return '/workflow';
  const about = WORKFLOW_ABOUT.exec(text);
  if (about) return `/workflow ${about[1].trim()}`;
  const extra = EXTRA.exec(text)?.[1].trim();
  const scrape = SCRAPE.exec(text);
  if (scrape) return `/scrape ${scrape[1]}${extra ? ` ${extra}` : ''}`;
  const bug = BUGBOUNTY.exec(text);
  if (bug) return `/bugbounty ${bug[1]}${extra ? ` ${extra}` : ''}`;
  return null;
}

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A task's title for lists, headers and the phone: the first line of what the
 * user asked, or a name for a command ("Your routines", "Map vit.ac.in") or a
 * workflow's run (its name).
 */
export function taskTitle(prompt: string): string {
  const text = prompt.trim();
  const run = WORKFLOW_RUN.exec(text);
  if (run) return run[1];
  const typed = typedCommand(text);
  // An answer on a triage card reads as what the user did.
  if (typed && !typed.startsWith('/')) return typed;
  if (typed) {
    const m = /^\/([a-zA-Z][\w-]*)\s*([\s\S]*)$/.exec(typed)!;
    const name = m[1].toLowerCase();
    const arg = m[2].trim().split('\n')[0];
    if (name === 'workflow') return arg ? capitalise(arg) : 'Your routines';
    if (name === 'scrape') return arg ? `Map ${hostOf(splitTarget(arg).target || arg)}` : 'Map a site';
    if (name === 'bugbounty') return arg ? `Security check of ${hostOf(splitTarget(arg).target || arg)}` : 'Security check';
  }
  return text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
}
