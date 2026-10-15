/**
 * transcript — folds a session's raw HlEvent stream into chat blocks.
 *
 * The logs window used to show the xterm rendering of these events. The chat
 * view keeps every detail (each tool call with its full arguments, result
 * preview, duration and outcome; files; skills; usage) but groups them the way
 * a chat app does: the user's messages, the agent's prose, and tool cards.
 *
 * `appendEvent` is incremental and structurally shared: it returns a new array
 * whose untouched blocks are the same objects as before, so memoised block
 * components skip re-rendering while text streams into the last block. Engines
 * emit prose as many small `thinking` deltas (Claude Code sends one per
 * token), which is why consecutive text is merged rather than one block each.
 */
import { typedCommand } from '../../shared/slashCommands';
import type { OrbState } from 'thinking-orbs';
import { parseWidget, type Widget } from '../../shared/widgets';
import { HOSTED_CONNECTORS, remoteConnectionId } from '../../shared/connectorCatalog';
import { deskWords } from '../../shared/deskWords';

export type ToolKind = 'search' | 'browse' | 'mcp' | 'read' | 'write' | 'run' | 'desktop' | 'agent' | 'other';

export interface ToolMeta {
  kind: ToolKind;
  /** Past-tense verb for a finished call ("Searched the web"). */
  done: string;
  /** Present-tense verb for a running call ("Searching the web"). */
  active: string;
  orb: OrbState;
  /** For MCP tools: "server · tool". */
  display?: string;
}

const KIND_META: Record<ToolKind, Omit<ToolMeta, 'kind' | 'display'>> = {
  search:  { done: 'Searched the web',  active: 'Searching the web', orb: 'searching' },
  browse:  { done: 'Used the browser',  active: 'Browsing',          orb: 'weaving' },
  mcp:     { done: 'Called',            active: 'Calling',           orb: 'connecting' },
  read:    { done: 'Read',              active: 'Reading',           orb: 'solving' },
  write:   { done: 'Edited',            active: 'Editing',           orb: 'composing' },
  run:     { done: 'Ran',               active: 'Running',           orb: 'working' },
  desktop: { done: 'Used the desktop',  active: 'Using the desktop', orb: 'shaping' },
  agent:   { done: 'Delegated',         active: 'Delegating',        orb: 'listening' },
  other:   { done: 'Used',              active: 'Using',             orb: 'working' },
};

const RULES: Array<[RegExp, ToolKind]> = [
  [/^mcp__|(^|_)mcp(_|$)/i, 'mcp'],
  [/web_?search|search_?web|google|bing|tavily|exa_|brave/i, 'search'],
  [/web_?fetch|fetch_?url|navigate|goto|open_?url|browser|page|click|scroll|type_?text|playwright|cdp|tab_/i, 'browse'],
  [/screenshot|computer|desktop|uia|mouse|keyboard|window|app_?launch/i, 'desktop'],
  [/^(task|agent|subagent|delegate)|todo/i, 'agent'],
  [/edit|write|patch|str_?replace|create_?file|apply|notebook/i, 'write'],
  [/bash|shell|exec|powershell|cmd|terminal|command|^run/i, 'run'],
  [/read|cat|view|glob|grep|find|list|ls$|search_?files|^fs|file/i, 'read'],
];

/** DEX's own MCP servers, by the id their tools carry (mcp__<id>__<tool>). */
const BUILT_IN_SERVERS: Record<string, string> = {
  google: 'Google', microsoft: 'Microsoft 365', github: 'GitHub', slack: 'Slack', reddit: 'Reddit',
  huggingface: 'Hugging Face', blender: 'Blender', windows: 'Windows',
};
const HOSTED_NAMES = new Map(HOSTED_CONNECTORS.map((c) => [remoteConnectionId(c.id), c.name]));

/** "remote_kiwi" → "Kiwi.com flights": the name the user knows from the Marketplace. */
export function serverName(id: string): string {
  return BUILT_IN_SERVERS[id] ?? HOSTED_NAMES.get(id) ?? id;
}

const WINDOWS_TOOL = /^mcp__windows__([a-z_]+)$/;

/** The element a Windows tool acted on, from its result (`"element":{"name":…}`). */
function elementOf(preview: string): { name?: string; role?: string } | null {
  const m = /"element":\{"name":"((?:[^"\\]|\\.)*)"(?:,"role":"([A-Za-z]+)")?/.exec(preview);
  if (!m) return null;
  try { return { name: JSON.parse(`"${m[1]}"`) as string, role: m[2] }; } catch { return { name: m[1], role: m[2] }; }
}

/** The window a Windows tool worked in, from its result (`"window":{"hwnd":…,"title":…,"process":…}`). */
function windowOf(preview: string): { title?: string; process?: string } | null {
  const m = /"window":\{"hwnd":\d+,"title":"((?:[^"\\]|\\.)*)","process":"((?:[^"\\]|\\.)*)"/.exec(preview);
  if (!m) return null;
  const unquote = (s: string): string => { try { return JSON.parse(`"${s}"`) as string; } catch { return s; } };
  return { title: unquote(m[1]), process: unquote(m[2]) };
}

/**
 * The Windows tools in plain words (shared/deskWords.ts): "Pressed “Shuffle”
 * in Spotify" says it all, so there's no separate target beside it.
 */
function windowsMeta(tool: string, args: unknown, element: { name?: string; role?: string } | null = null, window: { title?: string; process?: string } | null = null): ToolMeta {
  const a = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
  const words = deskWords(tool, a, window, element);
  return { kind: 'desktop', active: words.active, done: words.done, orb: KIND_META.desktop.orb, display: '' };
}

/* ── Steps in plain words ──────────────────────────────────────────────
 * A shell step used to read "Ran browser-harness-js <<'EOF'" and a look at a
 * screenshot "Read /tmp/vtop-menu.png" — in the chat and on the phone's live
 * update alike. These say what the step does: the agent's own words for it
 * (the comment that opens its browser code, or the shell call's
 * description) put into the present and past tense, else what the code
 * does ("Opening vtop.vit.ac.in"). */

/** A step's first word → its present and past form: "Click on Academics" → "Clicking on Academics". */
const VERBS: Record<string, [string, string]> = {
  click: ['Clicking', 'Clicked'], tap: ['Tapping', 'Tapped'], open: ['Opening', 'Opened'], go: ['Going', 'Went'],
  navigate: ['Going', 'Went'], visit: ['Visiting', 'Visited'], fill: ['Filling', 'Filled'], type: ['Typing', 'Typed'],
  enter: ['Entering', 'Entered'], select: ['Selecting', 'Selected'], choose: ['Choosing', 'Chose'], pick: ['Picking', 'Picked'],
  check: ['Checking', 'Checked'], find: ['Finding', 'Found'], look: ['Looking', 'Looked'], read: ['Reading', 'Read'],
  get: ['Getting', 'Got'], extract: ['Extracting', 'Extracted'], scroll: ['Scrolling', 'Scrolled'], wait: ['Waiting', 'Waited'],
  close: ['Closing', 'Closed'], submit: ['Submitting', 'Submitted'], search: ['Searching', 'Searched'], press: ['Pressing', 'Pressed'],
  log: ['Logging', 'Logged'], login: ['Logging in', 'Logged in'], sign: ['Signing', 'Signed'], refresh: ['Refreshing', 'Refreshed'],
  reload: ['Reloading', 'Reloaded'], clear: ['Clearing', 'Cleared'], set: ['Setting', 'Set'], switch: ['Switching', 'Switched'],
  take: ['Taking', 'Took'], capture: ['Capturing', 'Captured'], connect: ['Connecting', 'Connected'], save: ['Saving', 'Saved'],
  download: ['Downloading', 'Downloaded'], list: ['Listing', 'Listed'], show: ['Showing', 'Showed'], run: ['Running', 'Ran'],
  install: ['Installing', 'Installed'], create: ['Creating', 'Created'], make: ['Making', 'Made'], write: ['Writing', 'Wrote'],
  copy: ['Copying', 'Copied'], move: ['Moving', 'Moved'], delete: ['Deleting', 'Deleted'], remove: ['Removing', 'Removed'],
  update: ['Updating', 'Updated'], start: ['Starting', 'Started'], stop: ['Stopping', 'Stopped'], test: ['Testing', 'Tested'],
  verify: ['Verifying', 'Verified'], try: ['Trying', 'Tried'], retry: ['Retrying', 'Retried'], use: ['Using', 'Used'],
  add: ['Adding', 'Added'], focus: ['Focusing', 'Focused'], hover: ['Hovering', 'Hovered'], inspect: ['Inspecting', 'Inspected'],
  count: ['Counting', 'Counted'], compare: ['Comparing', 'Compared'], collect: ['Collecting', 'Collected'], fetch: ['Fetching', 'Fetched'],
  query: ['Querying', 'Queried'], print: ['Printing', 'Printed'], dismiss: ['Dismissing', 'Dismissed'], accept: ['Accepting', 'Accepted'],
  expand: ['Expanding', 'Expanded'], return: ['Returning', 'Returned'], build: ['Building', 'Built'], render: ['Rendering', 'Rendered'],
  convert: ['Converting', 'Converted'], send: ['Sending', 'Sent'], upload: ['Uploading', 'Uploaded'], view: ['Viewing', 'Viewed'],
  parse: ['Parsing', 'Parsed'], decode: ['Decoding', 'Decoded'], encode: ['Encoding', 'Encoded'],
  generate: ['Generating', 'Generated'], analyze: ['Analysing', 'Analysed'], analyse: ['Analysing', 'Analysed'],
  summarize: ['Summarising', 'Summarised'], summarise: ['Summarising', 'Summarised'], calculate: ['Calculating', 'Calculated'],
  format: ['Formatting', 'Formatted'], resize: ['Resizing', 'Resized'], crop: ['Cropping', 'Cropped'], export: ['Exporting', 'Exported'],
  import: ['Importing', 'Imported'], merge: ['Merging', 'Merged'], split: ['Splitting', 'Split'], sort: ['Sorting', 'Sorted'],
  filter: ['Filtering', 'Filtered'], schedule: ['Scheduling', 'Scheduled'], launch: ['Launching', 'Launched'],
  kill: ['Closing', 'Closed'], restart: ['Restarting', 'Restarted'], enable: ['Turning on', 'Turned on'], disable: ['Turning off', 'Turned off'],
  toggle: ['Toggling', 'Toggled'], play: ['Playing', 'Played'], pause: ['Pausing', 'Paused'], record: ['Recording', 'Recorded'],
  edit: ['Editing', 'Edited'], fix: ['Fixing', 'Fixed'], change: ['Changing', 'Changed'], rename: ['Renaming', 'Renamed'],
  replace: ['Replacing', 'Replaced'], review: ['Reviewing', 'Reviewed'], prepare: ['Preparing', 'Prepared'], draft: ['Drafting', 'Drafted'],
  reply: ['Replying', 'Replied'], book: ['Booking', 'Booked'], order: ['Ordering', 'Ordered'], share: ['Sharing', 'Shared'],
  sync: ['Syncing', 'Synced'], confirm: ['Confirming', 'Confirmed'], detect: ['Detecting', 'Detected'],
  measure: ['Measuring', 'Measured'], match: ['Matching', 'Matched'], map: ['Mapping', 'Mapped'], mark: ['Marking', 'Marked'],
  note: ['Noting', 'Noted'], post: ['Posting', 'Posted'], reset: ['Resetting', 'Reset'], resume: ['Resuming', 'Resumed'],
  load: ['Loading', 'Loaded'], explore: ['Exploring', 'Explored'], 
};
// "Navigate main tab to example.com": not "Went main tab to…".
VERBS.navigate = ['Navigating', 'Navigated'];

/** "Go to VTOP and take a screenshot" → "…and took a screenshot": the verbs after and/then/, too. */
function tenseRest(rest: string, which: 0 | 1): string {
  return rest.replace(/((?:,\s*)?\b(?:and|then)\s+|,\s+)([A-Za-z]+)\b/g, (whole, joint: string, word: string) => {
    const v = VERBS[word.toLowerCase()];
    if (!v) return whole;
    return joint + v[which].charAt(0).toLowerCase() + v[which].slice(1);
  });
}

/** "Click on Academics menu" → { active: "Clicking on Academics menu", done: "Clicked on Academics menu" }. */
export function stepPhrase(text: string): { active: string; done: string } | null {
  const t = text.trim().replace(/^[-*•\s]+/, '').replace(/[.:;,\s]+$/, '').slice(0, 90);
  if (!t || !/[a-z]/i.test(t)) return null;
  const m = /^([A-Za-z]+)([\s\S]*)$/.exec(t);
  const verb = m ? VERBS[m[1].toLowerCase()] : undefined;
  if (!m || !verb) {
    const same = t.charAt(0).toUpperCase() + t.slice(1);
    return { active: same, done: same };
  }
  return { active: verb[0] + tenseRest(m[2], 0), done: verb[1] + tenseRest(m[2], 1) };
}

const hostIn = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};

/** DEX's own command-line tools, by name. */
const DEX_CLI: Record<string, [string, string]> = {
  'dex-ui': ['Asking you', 'Asked you'], 'dex-workflow': ['Updating your routines', 'Updated your routines'],
  'dex-canvas': ['Writing it up', 'Wrote it up'], 'dex-open': ['Opening a file', 'Opened a file'],
  'dex-find': ['Searching your files', 'Searched your files'], 'dex-websearch': ['Searching the web', 'Searched the web'],
  'dex-send': ['Sending it to you', 'Sent it to you'], 'dex-tab': ['Using a browser tab', 'Used a browser tab'],
  'dex-remember': ['Remembering it', 'Remembered it'], 'dex-recall': ['Recalling what it knows', 'Recalled what it knows'],
  'dex-state': ['Updating its plan', 'Updated its plan'], 'dex-react': ['Reacting', 'Reacted'],
  'dex-3d': ['Making a 3D model', 'Made a 3D model'], 'dex-blender': ['Working in Blender', 'Worked in Blender'],
  'dex-fill': ['Filling a form', 'Filled a form'], 'dex-registry': ['Checking Windows settings', 'Checked Windows settings'],
};

/**
 * The command inside a shell wrapper. Codex runs every command as
 * `"…\powershell.exe" -Command "<script>"` on Windows (`bash -lc '<script>'`
 * elsewhere), which is all a step showed: the script is what it does.
 */
export function unwrapShell(command: string): string {
  let c = command.trim();
  // Layer by layer: PowerShell's or bash's -c, then DEX's own `dex-sh <shell> "<script>" [seconds]`.
  for (let layer = 0; layer < 3; layer += 1) {
    const shell = /^(?:"[^"]*(?:powershell|pwsh)(?:\.exe)?"|\S*(?:powershell|pwsh)(?:\.exe)?)\s+(?:-(?:NoProfile|NonInteractive|NoLogo|ExecutionPolicy\s+\S+)\s+)*-Command\s+([\s\S]+)$/i.exec(c)
      ?? /^(?:\/(?:usr\/)?bin\/)?(?:ba|z)?sh\s+-l?c\s+([\s\S]+)$/.exec(c);
    if (shell) {
      c = shell[1].trim();
      if (c.length >= 2 && ((c.startsWith('"') && c.endsWith('"')) || (c.startsWith("'") && c.endsWith("'")))) c = c.slice(1, -1);
      continue;
    }
    const dexSh = /^['"]?dex-sh\s+(?:bash|sh|powershell|pwsh|cmd)\s+([\s\S]+)$/i.exec(c);
    if (dexSh) {
      c = dexSh[1].trim().replace(/\s+\d+\s*$/, '').replace(/^[\\"']+|[\\"']+$/g, '').trim();
      continue;
    }
    break;
  }
  return c;
}

const fileName = (p: string): string => p.replace(/^['"]|['"]$/g, '').split(/[\\/]/).pop() || p;

/** Everyday commands, in words — for an engine that doesn't describe its calls (Codex). */
function everydayCommand(command: string): { active: string; done: string; kind: ToolKind } | null {
  const c = command.trim();
  const say = (active: string, done: string, kind: ToolKind = 'run') => ({ active, done, kind });
  if (/\bAGENTS\.md\b|\bSKILL\.md\b|dex-tools[\\/][\w.-]+\.md|domain-skills|interaction-skills/i.test(c)) return say('Reading its instructions', 'Read its instructions', 'read');
  if (/DEX_SITE_MEMORY_DIR|site-memory/i.test(c)) {
    const site = /([a-z0-9-]+(?:\.[a-z0-9-]+)+)\.md\b/i.exec(c)?.[1];
    return say(site ? `Checking its notes on ${site}` : 'Checking its notes', site ? `Checked its notes on ${site}` : 'Checked its notes', 'read');
  }
  const url = /\b(?:curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b[^\n]*?(https?:\/\/[^\s'"`]+)/i.exec(c)?.[1];
  if (url) return say(`Fetching ${hostIn(url) || 'a page'}`, `Fetched ${hostIn(url) || 'a page'}`, 'search');
  const read = /^(?:Get-Content|gc|cat|type|more|head|tail|less)\b(?:\s+-\w+(?:\s+\d+)?)*\s+(['"]?[^'"\s|;]+['"]?)/i.exec(c)?.[1];
  if (read) return say(`Reading ${fileName(read)}`, `Read ${fileName(read)}`, 'read');
  if (/^(?:Get-ChildItem|gci|ls|dir|tree)\b|^find\s/i.test(c)) return say('Looking through files', 'Looked through files', 'read');
  if (/^(?:rg|grep|Select-String|sls|findstr)\b/i.test(c)) return say('Searching files', 'Searched files', 'read');
  if (/\b(?:npm|yarn|pnpm|bun|pip3?|winget|choco|scoop)\s+(?:install|add|i)\b/i.test(c)) return say('Installing what it needs', 'Installed what it needs');
  if (/^(?:python3?|py|node|bun|deno|npx|tsx)\b/i.test(c)) return say('Running a script', 'Ran a script');
  if (/^git\b/i.test(c)) return say('Using git', 'Used git');
  if (/^(?:Copy-Item|cp|copy|robocopy)\b/i.test(c)) return say('Copying files', 'Copied files', 'write');
  if (/^(?:Move-Item|mv|move|Rename-Item|ren)\b/i.test(c)) return say('Moving files', 'Moved files', 'write');
  if (/^(?:Remove-Item|rm|del|rmdir|rd)\b/i.test(c)) return say('Deleting files', 'Deleted files', 'write');
  if (/^(?:mkdir|md|New-Item)\b/i.test(c)) return say('Making files', 'Made files', 'write');
  if (/^(?:Start-Process|start)\s+['"]?ms-settings:/i.test(c)) return say('Opening Settings', 'Opened Settings', 'desktop');
  if (/^(?:Start-Process|start)\b/i.test(c)) return say('Opening an app', 'Opened an app', 'desktop');
  if (/^(?:Get-PnpDevice|pnputil|Get-CimInstance\s+Win32_PnP)/i.test(c)) return say('Checking devices', 'Checked devices', 'desktop');
  if (/^(?:Get-NetAdapter|netsh|ipconfig|Test-NetConnection|ping|Get-NetIPAddress)\b/i.test(c)) return say('Checking the network', 'Checked the network', 'desktop');
  if (/^(?:Get-Service|sc\s+query)\b/i.test(c)) return say('Checking services', 'Checked services', 'desktop');
  if (/^(?:Get-ItemProperty|reg\s+query)\b/i.test(c)) return say('Checking Windows settings', 'Checked Windows settings', 'desktop');
  if (/^(?:Get-Process|tasklist|ps)\b/i.test(c)) return say('Checking what’s running', 'Checked what’s running', 'desktop');
  return null;
}

/** A shell call in plain words, or null to keep the default ("Ran …"). */
function shellMeta(args: unknown): ToolMeta | null {
  if (!args || typeof args !== 'object') return null;
  const a = args as Record<string, unknown>;
  const raw = a.command ?? a.cmd;
  const command = unwrapShell(Array.isArray(raw) ? raw.map(String).join(' ') : typeof raw === 'string' ? raw : '');
  const description = typeof a.description === 'string' ? a.description : '';
  const browse = (active: string, done: string): ToolMeta => ({ kind: 'browse', active, done, orb: KIND_META.browse.orb, display: '' });
  const plain = (p: { active: string; done: string }, kind: ToolKind): ToolMeta => ({ kind, ...p, orb: KIND_META[kind].orb, display: '' });

  if (/browser-harness-js/.test(command)) {
    const comment = /^\s*\/\/\s*(.+)$/m.exec(command)?.[1];
    const said = (comment && stepPhrase(comment)) || (description && stepPhrase(description));
    if (said) return plain(said, 'browse');
    const url = /navigate\(\s*\{\s*url:\s*['"`]([^'"`]+)['"`]/.exec(command)?.[1];
    if (url) return browse(`Opening ${hostIn(url) || 'a page'}`, `Opened ${hostIn(url) || 'a page'}`);
    if (/dispatchMouseEvent|\.click\(/.test(command)) return browse('Clicking on the page', 'Clicked on the page');
    if (/insertText|dispatchKeyEvent/.test(command)) return browse('Typing on the page', 'Typed on the page');
    if (/captureScreenshot/.test(command)) return browse('Looking at the page', 'Looked at the page');
    if (/connectToAssignedTarget/.test(command)) return browse('Opening its browser tab', 'Opened its browser tab');
    return browse('Reading the page', 'Read the page');
  }
  const cli = /(?:^|[\s;&|(])((?:dex-[a-z0-9]+))(?=\s|$)/.exec(command)?.[1];
  if (cli && DEX_CLI[cli]) return plain({ active: DEX_CLI[cli][0], done: DEX_CLI[cli][1] }, 'run');
  const said = description && stepPhrase(description);
  if (said) return plain(said, 'run');
  const everyday = everydayCommand(command);
  if (everyday) return plain(everyday, everyday.kind);
  // Never a raw command line on its own: the row opens to show it.
  return command ? plain({ active: 'Running a command', done: 'Ran a command' }, 'run') : null;
}

/** A Read of a screenshot the agent took: it's looking at the page, not reading a file. */
function readMeta(args: unknown): ToolMeta | null {
  const p = args && typeof args === 'object' ? (args as Record<string, unknown>).file_path ?? (args as Record<string, unknown>).path : undefined;
  if (typeof p !== 'string' || !/\.(png|jpe?g|webp|gif)$/i.test(p)) return null;
  const shot = /[\\/](tmp|temp)[\\/]|screenshot|screen[-_]?shot|capture/i.test(p);
  const name = p.split(/[\\/]/).pop() ?? p;
  return shot
    ? { kind: 'browse', active: 'Looking at the page', done: 'Looked at the page', orb: KIND_META.browse.orb, display: '' }
    : { kind: 'read', active: `Looking at ${name}`, done: `Looked at ${name}`, orb: KIND_META.read.orb, display: '' };
}

export function classifyTool(name: string, args?: unknown): ToolMeta {
  const win = WINDOWS_TOOL.exec(name);
  if (win) return windowsMeta(win[1], args);
  if (/^(bash|shell|exec_command|local_shell)$/i.test(name)) {
    const meta = shellMeta(args);
    if (meta) return meta;
  }
  // A Codex connector call from before its server and tool were recorded.
  if (name === 'MCP') return { kind: 'mcp', active: 'Using a connector', done: 'Used a connector', orb: KIND_META.mcp.orb, display: '' };
  // Claude Code's Read, and Codex's view_image, of a picture.
  if (name === 'Read' || /^view_?image$/i.test(name)) {
    const meta = readMeta(args);
    if (meta) return meta;
  }
  // Claude Code loading deferred tools: housekeeping, not a step worth naming.
  if (name === 'ToolSearch') return { kind: 'other', done: 'Loaded its tools', active: 'Loading its tools', orb: KIND_META.other.orb, display: '' };
  let kind: ToolKind = 'other';
  for (const [re, k] of RULES) {
    if (re.test(name)) { kind = k; break; }
  }
  const meta: ToolMeta = { kind, ...KIND_META[kind] };
  if (kind === 'mcp') {
    const parts = name.replace(/^mcp__/, '').split('__');
    const server = serverName(parts[0]);
    meta.display = parts.length > 1 ? `${server} · ${parts.slice(1).join(' ').replace(/[-_]+/g, ' ')}` : server;
  }
  return meta;
}

export interface ToolResult {
  ok: boolean;
  preview: string;
  ms: number;
}

/**
 * When a block happened (`at`, stamped by SessionManager.appendOutput) and
 * when it last changed (`endAt`: a streamed reply's last delta, a tool's
 * result). Absent on sessions recorded before events carried times.
 */
export interface BlockTimes {
  at?: number;
  endAt?: number;
}

export type Block = (
  | { kind: 'user'; id: number; text: string; attachments?: Array<{ name: string; mime: string; size: number }> }
  | { kind: 'text'; id: number; text: string }
  | { kind: 'tool'; id: number; name: string; meta: ToolMeta; summary: string; args: unknown; iteration: number; result?: ToolResult }
  /**
   * `echo`: the summary only repeats the reply just above it (Codex reports
   * its last message as the summary). Shown as a compact "Done" footer then,
   * not the whole answer a second time.
   */
  | { kind: 'done'; id: number; summary: string; iterations: number; echo?: boolean }
  | { kind: 'error'; id: number; message: string }
  | { kind: 'notice'; id: number; level: 'info' | 'blocking' | 'skill' | 'harness' | 'confirm'; title: string; detail?: string }
  | { kind: 'file'; id: number; name: string; path: string; size: number; mime: string }
  | { kind: 'image'; id: number; path: string; caption?: string }
  | { kind: 'canvas'; id: number; title: string; markdown: string }
  | { kind: 'artifact'; id: number; title: string; note?: string; count: number; items: Array<{ label: string; detail?: string }> }
  /** From the agent's UI kit (shared/widgets.ts): `wid` is the widget's own id. */
  | { kind: 'widget'; id: number; wid: string; widget: Widget }
  /**
   * A change DEX made to the PC (the Windows tools' undo journal). `undone`
   * once a later change undid it; `undoes` on the change that did.
   */
  | { kind: 'change'; id: number; entry: string; title: string; reason?: string; undoable: boolean; undone: boolean; undoes?: string; restartNeeded?: boolean }
) & BlockTimes;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
  model?: string;
  turns: number;
}

export interface Transcript {
  blocks: Block[];
  usage: Usage;
  nextId: number;
}

export const EMPTY_TRANSCRIPT: Transcript = {
  blocks: [],
  usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0, turns: 0 },
  nextId: 0,
};

type RawEvent = { type?: string } & Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/** One-line summary of a call's arguments: the adapter's `preview` if it gave one. */
function summarizeArgs(args: unknown): string {
  if (args && typeof args === 'object') {
    const a = args as Record<string, unknown>;
    for (const key of ['preview', 'query', 'command', 'url', 'file_path', 'path', 'pattern', 'description', 'prompt']) {
      if (typeof a[key] === 'string' && a[key]) return (a[key] as string).split('\n')[0];
    }
    try { return JSON.stringify(a).slice(0, 160); } catch { return ''; }
  }
  return str(args).split('\n')[0];
}

// Whitespace and Markdown markers dropped: streamed deltas sometimes lose a
// space ("114users"), and the summary may be the plain-text version.
const norm = (s: string) => s.replace(/[\s*_`#>|~]+/g, '').toLowerCase();

/** Does `summary` just repeat the agent's last reply in this turn? */
function echoesLastReply(t: Transcript, summary: string): boolean {
  const s = norm(summary);
  if (!s) return false;
  for (let i = t.blocks.length - 1; i >= 0; i -= 1) {
    const b = t.blocks[i];
    if (b.kind === 'user') return false;
    if (b.kind !== 'text') continue;
    const last = norm(b.text);
    if (!last) return false;
    const [shorter, longer] = s.length <= last.length ? [s, last] : [last, s];
    return longer.includes(shorter) && shorter.length >= longer.length * 0.6;
  }
  return false;
}

function push(t: Transcript, block: Block): Transcript {
  return { ...t, blocks: [...t.blocks, block], nextId: t.nextId + 1 };
}

function replaceLast(t: Transcript, block: Block): Transcript {
  const blocks = t.blocks.slice();
  blocks[blocks.length - 1] = block;
  return { ...t, blocks };
}

export function appendEvent(t: Transcript, raw: RawEvent): Transcript {
  const at = typeof raw.at === 'number' ? raw.at : undefined;
  const next = fold(t, raw, at);
  // A new block starts (and, so far, ends) when its event happened.
  if (at === undefined || next.blocks.length <= t.blocks.length) return next;
  const blocks = next.blocks.slice();
  blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], at, endAt: at };
  return { ...next, blocks };
}

function fold(t: Transcript, raw: RawEvent, at: number | undefined): Transcript {
  const id = t.nextId;
  switch (raw.type) {
    case 'user_input': {
      const text = str(raw.text).trim();
      return text ? push(t, { kind: 'user', id, text }) : t;
    }
    case 'thinking': {
      const text = str(raw.text);
      if (!text) return t;
      const last = t.blocks[t.blocks.length - 1];
      if (last?.kind === 'text') return replaceLast(t, { ...last, text: last.text + text, endAt: at ?? last.endAt });
      return text.trim() ? push(t, { kind: 'text', id, text: text.replace(/^\s+/, '') }) : t;
    }
    case 'tool_call': {
      const name = str(raw.name) || 'tool';
      return push(t, {
        kind: 'tool',
        id,
        name,
        meta: classifyTool(name, raw.args),
        summary: summarizeArgs(raw.args),
        args: raw.args,
        iteration: Number(raw.iteration ?? 0),
      });
    }
    case 'tool_result': {
      const name = str(raw.name);
      const result: ToolResult = { ok: raw.ok !== false, preview: str(raw.preview), ms: Number(raw.ms ?? 0) };
      // Pair with the most recent call of that name still waiting — calls can
      // interleave with prose, so look back a little rather than at the tail.
      for (let i = t.blocks.length - 1, seen = 0; i >= 0 && seen < 80; i -= 1, seen += 1) {
        const b = t.blocks[i];
        if (b.kind === 'tool' && !b.result && (b.name === name || !name)) {
          const blocks = t.blocks.slice();
          // A Windows tool says what it pressed: "Pressed “Shuffle” in Spotify", not "a button".
          const win = WINDOWS_TOOL.exec(b.name);
          const element = win && result.ok ? elementOf(result.preview) : null;
          const window = win && result.ok ? windowOf(result.preview) : null;
          const meta = win && (element || window) ? windowsMeta(win[1], b.args, element, window) : null;
          blocks[i] = { ...b, ...(meta ? { meta } : {}), result, endAt: at ?? b.endAt };
          return { ...t, blocks };
        }
      }
      return t;
    }
    case 'user_attachments': {
      const items = Array.isArray(raw.items) ? (raw.items as Array<{ name: string; mime: string; size: number }>) : [];
      if (items.length === 0) return t;
      for (let i = t.blocks.length - 1; i >= 0; i -= 1) {
        const b = t.blocks[i];
        if (b.kind === 'user') {
          const blocks = t.blocks.slice();
          blocks[i] = { ...b, attachments: [...(b.attachments ?? []), ...items] };
          return { ...t, blocks };
        }
      }
      return push(t, { kind: 'user', id, text: '', attachments: items });
    }
    case 'done': {
      const summary = str(raw.summary) || 'Task completed';
      return push(t, { kind: 'done', id, summary, iterations: Number(raw.iterations ?? 0), echo: echoesLastReply(t, summary) });
    }
    case 'error':
      return push(t, { kind: 'error', id, message: str(raw.message) || 'Something went wrong' });
    case 'notify':
      return push(t, { kind: 'notice', id, level: raw.level === 'blocking' ? 'blocking' : 'info', title: str(raw.message) });
    case 'skill_written':
      return push(t, { kind: 'notice', id, level: 'skill', title: `${raw.action === 'patch' ? 'Updated' : 'Learned'} a skill: ${str(raw.topic)}`, detail: str(raw.path) });
    case 'skill_used':
      return push(t, { kind: 'notice', id, level: 'skill', title: `Used skill: ${str(raw.topic)}`, detail: str(raw.path) });
    case 'harness_edited': {
      const changed = [
        ...((raw.added as string[] | undefined) ?? []).map((n) => `+${n}`),
        ...((raw.changed as string[] | undefined) ?? []).map((n) => `~${n}`),
        ...((raw.removed as string[] | undefined) ?? []).map((n) => `-${n}`),
      ].join(' ');
      return push(t, { kind: 'notice', id, level: 'harness', title: `Edited its ${str(raw.target)}`, detail: changed || str(raw.path) });
    }
    case 'confirmation':
      return push(t, { kind: 'notice', id, level: 'confirm', title: `${raw.status === 'approved' ? 'Approved' : raw.status === 'denied' ? 'Denied' : 'Asked for approval'}: ${str(raw.title)}`, detail: str(raw.detail) });
    case 'file_output':
      return push(t, { kind: 'file', id, name: str(raw.name), path: str(raw.path), size: Number(raw.size ?? 0), mime: str(raw.mime) });
    case 'screenshot':
      return push(t, { kind: 'image', id, path: str(raw.path), caption: raw.caption ? str(raw.caption) : undefined });
    case 'canvas':
      return push(t, { kind: 'canvas', id, title: str(raw.title), markdown: str(raw.markdown) });
    case 'desk_change': {
      const entry = str(raw.entry);
      if (!entry) return t;
      const undoes = raw.undoes ? str(raw.undoes) : undefined;
      let next = t;
      if (undoes) {
        const i = t.blocks.findIndex((b) => b.kind === 'change' && b.entry === undoes);
        if (i >= 0) {
          const blocks = t.blocks.slice();
          blocks[i] = { ...(blocks[i] as Extract<Block, { kind: 'change' }>), undone: true };
          next = { ...t, blocks };
        }
      }
      return push(next, {
        kind: 'change', id, entry, title: str(raw.title), reason: raw.reason ? str(raw.reason) : undefined,
        undoable: raw.undoable === true, undone: raw.undone === true, undoes, restartNeeded: raw.restartNeeded === true || undefined,
      });
    }
    case 'widget': {
      const parsed = parseWidget(raw.widget);
      return parsed.widget ? push(t, { kind: 'widget', id, wid: str(raw.id), widget: parsed.widget }) : t;
    }
    case 'artifact': {
      const items = Array.isArray(raw.items) ? (raw.items as Array<{ label?: unknown; detail?: unknown }>) : [];
      return push(t, {
        kind: 'artifact',
        id,
        title: str(raw.title),
        note: raw.note ? str(raw.note) : undefined,
        count: Number(raw.total ?? items.length),
        items: items.slice(0, 8).map((it) => ({ label: str(it.label), detail: it.detail ? str(it.detail) : undefined })),
      });
    }
    case 'turn_usage': {
      const u = t.usage;
      return {
        ...t,
        usage: {
          inputTokens: u.inputTokens + Number(raw.inputTokens ?? 0),
          outputTokens: u.outputTokens + Number(raw.outputTokens ?? 0),
          cachedInputTokens: u.cachedInputTokens + Number(raw.cachedInputTokens ?? 0),
          costUsd: u.costUsd + Number(raw.costUsd ?? 0),
          model: raw.model ? str(raw.model) : u.model,
          turns: u.turns + 1,
        },
      };
    }
    default:
      // task_state lives in the hub's preview deck; anything unknown is still
      // in the Raw view.
      return t;
  }
}

export function buildTranscript(prompt: string | undefined, events: RawEvent[]): Transcript {
  let t = EMPTY_TRANSCRIPT;
  // A command's task keeps the expanded instructions as its prompt; the chat
  // shows what the user typed ("/workflow"), not those instructions.
  if (prompt?.trim()) t = push(t, { kind: 'user', id: 0, text: typedCommand(prompt) ?? prompt.trim() });
  const first = prompt?.trim();
  for (const ev of events) {
    // Some engines echo the opening prompt as a user_input; it's already shown.
    if (first && t.blocks.length === 1 && ev.type === 'user_input' && str(ev.text).trim() === first) continue;
    t = appendEvent(t, ev);
  }
  return t;
}
