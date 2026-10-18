/**
 * What DEX remembers for the user, at the top of every task — the same for
 * Claude Code, Codex and BrowserCode, because it's DEX's memory, not an
 * engine's. Each engine's own memory (Claude Code's projects folder, Codex's)
 * stays with that engine and that folder, so a task on the other one, or in a
 * new chat, started from nothing: asked to "fetch my attendance", an agent
 * asked which website, a day after the user had given it the portal and the
 * login.
 *
 * Not all of it, every time: that would grow with every fact and cost on
 * every turn. A task gets the core facts (their name, what they do, how they
 * like answers), the few notes, sites and routines its words reach in the
 * index (memory/recall.ts), and one line saying what else there is, which
 * `dex-recall` looks up when it matters.
 *
 * Only what's safe to say: notes (which never hold a secret), the sites the
 * user named and what they call them, whether a login is stored (never the
 * login: dex-fill types it into the page without the agent seeing it), and
 * the saved routines.
 */
import type { MemoryNote } from '../../memory/notes';
import { nodesOf, outline, recall } from '../../memory/recall';
import type { SafeSiteRecord } from '../../memory/siteStore';
import { topicsIn } from '../../../shared/memoryTopics';
import type { Workflow } from '../../../shared/workflows';

const MAX_CORE = 8;
const CORE_BUDGET = 700;
const MAX_RELEVANT = 6;

type Note = Pick<MemoryNote, 'id' | 'text' | 'topic'> & Partial<Pick<MemoryNote, 'core' | 'at'>>;

/** "Reply to my unread mail", "go through my WhatsApp", "answer today's Slack DMs". */
const REPLY_WORDS = /\b(repl(y|ies)|respond|answer|go through|triage|clear|handle|deal with)\b[\s\S]{0,60}\b(mails?|e-?mails?|inbox|messages?|whatsapp|telegram|slack|teams|dms?|chats?|texts?|notifications?)\b/i;

const ROUTINE_WORDS = /\b(routines?|workflows?|automat\w*|schedul\w*|every (day|morning|evening|night|week|weekday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|daily|weekly|remind\w*|trigger\w*)\b/i;

/** The prompt lines for one task (pure: memoryBriefing reads the stores). */
export function briefingLines(
  sites: SafeSiteRecord[],
  workflows: Array<Pick<Workflow, 'name' | 'trigger' | 'enabled'>>,
  notes: Note[] = [],
  prompt = '',
): string[] {
  const lines: string[] = [];
  const nodes = nodesOf(notes.map((n) => ({ by: 'dex', at: 0, ...n })) as MemoryNote[], sites, workflows);
  const core = notes.filter((n) => n.core).slice(0, MAX_CORE);
  const coreIds = new Set(core.map((n) => n.id));
  const relevant = recall(nodes.filter((n) => !coreIds.has(n.id)), prompt, MAX_RELEVANT);

  if (core.length > 0 || relevant.length > 0) {
    lines.push('What DEX remembers about the user — its own memory, shared by every task and engine. Use it; don\'t ask for it again:');
  }
  if (core.length > 0) {
    let budget = CORE_BUDGET;
    const said = core.filter((n) => (budget -= n.text.length + 3) >= 0).map((n) => `${n.text} [${n.id}]`);
    lines.push(`- About them: ${said.join(' · ')}`);
  }
  for (const n of relevant) lines.push(`- ${n.text}${n.kind === 'note' ? ` [${n.id}]` : ''}`);

  const shown = core.length + relevant.length;
  if (nodes.length > shown) {
    lines.push(`DEX also remembers ${outline(nodes)} in all. Before asking the user anything about themselves, a site of theirs or a routine, look it up: \`dex-recall "<words>"\`.`);
  }

  lines.push(
    'When the user tells you something worth keeping — about themselves, how they like things done, what a phrase of theirs means — save it at once: `dex-remember note "<one fact>"` (`--replaces <id>` when it changes, `dex-remember forget-note <id>` when they say to forget). A site they use or a login they give: `dex-remember site` / `dex-remember login` (`./dex-tools/site-memory.md`). Not this task\'s details, and never a password or key in a note. Keep it in DEX\'s memory, not your own memory files: the other engines and DEX\'s Settings never see those.',
  );

  // Answering a batch of messages: one triage card, always — even when none
  // needs a reply, so the user sees what came in and decides. A live run
  // found four automated mails, said "none need a reply" in prose and showed
  // nothing; it hadn't opened ui.md.
  if (REPLY_WORDS.test(prompt)) {
    lines.push(
      'Answering messages: unless the request names one message or person (then draft it and send it), show every message you fetched as ONE `dex-ui triage` card — read the Triage section of `./dex-tools/ui.md` first. Score each for urgency and importance, give each a category (academics, work, personal or other) and draft the replies. ALWAYS show the card, even when every message is automated and nothing needs a reply: the card is how the user sees what came in, and deciding what deserves a reply is theirs, not yours. Those go on it without a draft and sit in Later; one line of prose may say so. Then end your turn: the user answers each message with Yes / No / Specify. Never a list of drafts in prose, and never send without their Yes.',
    );
  }

  const aboutRoutines = ROUTINE_WORDS.test(prompt) || topicsIn(prompt).includes('routines') || relevant.some((n) => n.kind === 'routine');
  if (aboutRoutines) {
    const names = workflows.filter((w) => w.enabled !== false).slice(0, 20).map((w) => `“${w.name}”`);
    lines.push(
      `${names.length ? `Their routines: ${names.join(', ')}. ` : ''}Routines and workflows are DEX's own: make, change and run them with \`dex-workflow\` (\`dex-workflow create "<name>" --when "<schedule>" --step "<step>"\`, or see \`./dex-tools/workflows.md\`). Never Windows Task Scheduler, a cron job, a cloud or remote routine, or a script for the user to run: DEX runs them itself, on schedule while DEX is running, or when the user says the routine's name. A step that changes the PC uses DEX's Windows tools (\`mcp__windows__system_change\`: temp_clean, app_close, startup_disable, …), admin ones through the helper the user set up once; never ask the user to paste a command into an admin PowerShell.`,
    );
  }
  return lines;
}

/** The lines for this task, read fresh from the notes, the site memory and the workflow store. */
export async function memoryBriefing(workflowsFile: string, prompt = ''): Promise<string[]> {
  const [sites, workflows, notes] = await Promise.all([
    import('../../memory/siteStore').then((m) => m.listSites()).catch(() => [] as SafeSiteRecord[]),
    import('../../workflows/store').then((m) => new m.WorkflowStore(workflowsFile).list()).catch(() => [] as Workflow[]),
    import('../../memory/notes').then((m) => m.listNotes()).catch(() => [] as MemoryNote[]),
  ]);
  return briefingLines(sites, workflows, notes, prompt);
}
