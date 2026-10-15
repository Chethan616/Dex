/**
 * What DEX remembers for the user, at the top of every task — the same for
 * Claude Code, Codex and BrowserCode, because it's DEX's memory, not an
 * engine's. Each engine's own memory (Claude Code's projects folder, Codex's)
 * stays with that engine and that folder, so a task on the other one, or in a
 * new chat, started from nothing: asked to "fetch my attendance", an agent
 * asked which website, a day after the user had given it the portal and the
 * login.
 *
 * Only what's safe to say: the sites the user named and what they call them,
 * whether a login is stored (never the login: dex-fill types it into the page
 * without the agent seeing it), and the saved routines.
 */
import type { SafeSiteRecord } from '../../memory/siteStore';
import { triggerText, type Workflow } from '../../../shared/workflows';

const MAX_SITES = 25;
const MAX_ROUTINES = 20;

/** The prompt lines, from what's remembered (pure: memoryBriefing reads the stores). */
export function briefingLines(sites: SafeSiteRecord[], workflows: Array<Pick<Workflow, 'name' | 'trigger' | 'enabled'>>): string[] {
  const lines: string[] = [];
  if (sites.length > 0) {
    lines.push(
      'What the user has told DEX before — DEX\'s own memory, shared by every task and every engine. Use it; don\'t ask for it again:',
      ...sites.slice(0, MAX_SITES).map((s) => {
        const called = s.aliases.length ? ` — they call it ${s.aliases.slice(0, 5).map((a) => `“${a}”`).join(', ')}` : '';
        const login = s.hasPassword ? '; login saved (sign in with `dex-fill`, never ask for it)' : s.hasUsername ? '; username saved' : '';
        return `- ${s.url ?? s.host}${called}${login}`;
      }),
      'A request that points at one of these by what it\'s for ("my attendance", "my timetable" → their university portal) goes there.',
    );
  }
  lines.push(
    'When the user tells you a site they use, or gives you a login, record it straight away with `dex-remember` (`./dex-tools/site-memory.md`) — that is how the next task, on any engine, knows it. Look a nickname up with `dex-recall`.',
  );
  const routines = workflows.filter((w) => w.enabled !== false).slice(0, MAX_ROUTINES);
  if (routines.length > 0) {
    lines.push(
      `Their saved routines (run one with \`dex-workflow run "<name>"\` when they ask for it by name): ${routines.map((w) => `“${w.name}” (${triggerText(w.trigger).toLowerCase()})`).join('; ')}.`,
    );
  }
  lines.push(
    'Routines and workflows are DEX\'s own: make, change and run them with `dex-workflow` (`./dex-tools/workflows.md`). Never Windows Task Scheduler, a cron job, a cloud or remote routine, or a script for the user to run: DEX runs them itself, on their schedule while DEX is running, or when the user says the routine\'s name. A step that changes the PC uses DEX\'s Windows tools (`mcp__windows__system_change`: temp_clean, app_close, startup_disable, …), admin ones through the helper the user set up once; never ask the user to paste a command into an admin PowerShell.',
  );
  return lines;
}

/** The lines for this task, read fresh from the site memory and the workflow store. */
export async function memoryBriefing(workflowsFile: string): Promise<string[]> {
  const [sites, workflows] = await Promise.all([
    import('../../memory/siteStore').then((m) => m.listSites()).catch(() => [] as SafeSiteRecord[]),
    import('../../workflows/store').then((m) => new m.WorkflowStore(workflowsFile).list()).catch(() => [] as Workflow[]),
  ]);
  return briefingLines(sites, workflows);
}
