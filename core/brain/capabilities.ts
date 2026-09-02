/**
 * The single source of truth for what Dex can be asked to do.
 *
 * This file exists because of a real bug. The Brain's prompt advertised
 * `set_volume`, `get_volume`, `list_processes` and `kill_process`; the daemon's
 * dispatch table implemented none of them. Two hand-maintained lists in two
 * languages drifted apart, and the symptom was the Brain confidently planning
 * steps that came back "Unknown action" halfway through a task.
 *
 * So the prompt is now *generated* from this table, and `system_agent.ts`
 * checks it against what the daemon reports through its `describe` action at
 * startup. Adding an action means adding it here and implementing it — there is
 * no third place to forget.
 */

export interface ActionSpec {
  params: string;
  /** One line, shown to the planner. Say when to use it, not just what it is. */
  note?: string;
}

/** Tier 1 — direct OS control through the privileged daemon. No UI involved. */
export const OS_ACTIONS: Record<string, ActionSpec> = {
  set_dns: { params: '{ primary?: string (IPv4), secondary?: string, adapter?: string (omit = all active), dhcp?: boolean }',
    note: 'dhcp: true puts the adapter back on automatic — use it for "reset my dns"' },
  get_dns: { params: '{ adapter?: string }' },
  set_wifi: { params: '{ enabled: boolean }' },
  get_wifi_status: { params: '{}' },
  set_power_plan: { params: '{ plan: "balanced" | "high_performance" | "power_saver" }' },
  get_power_plan: { params: '{}' },
  get_volume: { params: '{}' },
  set_volume: { params: '{ level: number (0-100) }' },
  set_mute: { params: '{ muted: boolean }' },
  list_processes: { params: '{ name?: string, limit?: number }' },
  kill_process: { params: '{ name?: string, pid?: number, all?: boolean }', note: 'Tier 2 — ending a process can lose unsaved work' },
  launch_app: { params: '{ name: string }', note: 'Use this to open ANY app. Never open apps through the GUI tiers' },
  close_app: { params: '{ name: string }', note: 'Asks the window to close; does not force-kill' },
  find_program: {
    params: '{ name: string, version?: boolean }',
    note: 'Is it installed, and where? { found, path, version, source }. Ask before installing and again after — a version string is evidence, an exit code is not. Not-installed is an answer, not an error',
  },
  get_keyboard_backlight: {
    params: '{}',
    note: '{ present, provider, brightness, levels, supportsColor }. Most keyboards have no controllable backlight — ask before offering to change one',
  },
  set_keyboard_backlight: {
    params: '{ brightness?: number, color?: string }',
    note: 'brightness 0..levels-1; color as #RRGGBB or a name. Colour only where supportsColor. Check get_keyboard_backlight first',
  },
  capture_screen: {
    params: '{ path?: string, region?: [x, y, width, height] }',
    // The other screenshot in this catalogue is can_browse_web's, which
    // photographs a web page inside the browser agent. This one photographs the
    // actual desktop, which is what "screenshot that error and send it to me"
    // means. Naming them differently is the point.
    note: 'Photographs the real desktop (all monitors) and returns the PNG path. For a web page use can_browse_web screenshot instead. Pair with send_file to deliver it',
  },
  registry_read: { params: '{ path: string, name: string }' },
  registry_write: { params: '{ path: string, name: string, value: any, type?: number }', note: 'Tier 2 unless the key is Dex-owned. Security/policy keys are refused outright' },
  registry_classify: { params: '{ path: string }', note: 'Ask which band a registry path falls in before planning a write' },
  // `run_shell` is deliberately NOT advertised any more.
  //
  // The daemon still implements it, so saved workflows that use it keep
  // working. But offering the planner two shell actions where one is a strict
  // subset of the other is a trap, and it sprang immediately: asked what was
  // listening on the ports, the model reasoned "netstat is read-only, so
  // run_shell" and hit that action's seven-program allowlist. It was not
  // wrong about netstat; it was choosing between two things that should be
  // one. run_command runs every command run_shell would, silently, and
  // classifies the rest.
  run_command: {
    params: '{ command: string[], cwd?: string, timeout?: number }',
    note: 'Any command, classified before it runs. git, npm, pip, compilers, rg, netstat, Get-FileHash, PowerShell. Reads run silently; changes ask first; destructive ones are refused. Always pass the command as a LIST of arguments',
  },
  classify_command: {
    params: '{ command: string[] }',
    note: 'Ask which band a command falls into before planning it — same idea as registry_classify',
  },
  get_display: { params: '{}', note: 'Current resolution and refresh rate, plus every mode this display accepts' },
  set_display: {
    params: '{ resolution?: string (e.g. "1920x1080"), width?: number, height?: number, refresh_hz?: number }',
    note: 'Sets resolution and refresh rate directly. NEVER click through Settings for this — call get_display first if you need to know what is available. Tier 2',
  },
  get_brightness: { params: '{}' },
  set_brightness: { params: '{ level: number (0-100) }', note: 'Built-in laptop panels only; external monitors report unsupported' },
  get_env: { params: '{ name?: string }', note: 'Omit name for every variable' },
  set_env: {
    params: '{ name: string, value: string | null, scope?: "user" | "machine", append?: boolean }',
    note: 'Persists and notifies Windows, so a new shell sees it. append=true adds to PATH rather than replacing it. value=null removes. Tier 2',
  },
};

/** Tier 1 — direct user-side filesystem and runtime control. No UI involved. */
export const FILE_ACTIONS: Record<string, ActionSpec> = {
  find_files: {
    params: '{ root?: string, query: string, open_location?: boolean, max_results?: number }',
    note: 'Searches filenames directly; set open_location=true to select a result in File Explorer',
  },
  write_file: {
    params: '{ path: string, content: string }',
    note: 'Writes UTF-8 source inside the bounded Dex workspace; use for code or a document, Tier 3',
  },
  run_program: {
    params: '{ path: string, runtime?: "python" | "node" | "ruby" | "go", args?: string[], background?: boolean, timeout?: number }',
    note: 'Runs a program as the signed-in user; use background=true for a GUI/game, Tier 2',
  },
  read_file: { params: '{ path: string }', note: 'Text files up to 2 MB; for bigger ones search with run_command and rg' },
  list_dir: { params: '{ path: string, pattern?: string }', note: 'path takes a folder name — "downloads", "desktop", "documents" — or a full path' },
  copy_file: { params: '{ from: string, to: string, overwrite?: boolean }' },
  move_file: { params: '{ from: string, to: string, overwrite?: boolean }', note: 'Tier 2' },
  rename_files: {
    params: '{ folder: string, pattern?: string, find?: string, replace?: string, prefix?: string, suffix?: string, apply?: boolean }',
    note: 'Call it FIRST with apply omitted to see exactly what would change, show that to the owner, then call again with apply=true. Tier 2',
  },
  delete_file: {
    params: '{ path: string, permanent?: boolean }',
    note: 'Goes to the Recycle Bin unless permanent=true. Tier 2',
  },
  read_document: {
    params: '{ path: string, max_chars?: number }',
    note: 'The text of a PDF. Use this and never read_file for a PDF, which returns binary noise that looks like content',
  },
  trace_image: {
    params: '{ path: string, detail?: "sketch" | "fine" }',
    note: 'A picture to outline strokes, normalised 0-1. A traced sketch, not a reproduction — say so',
  },
  extract_archive: {
    params: '{ path: string, to?: string }',
    note: 'Unpacks .zip/.tar/.tar.gz. Returns { extractedTo, root }; "root" is the folder holding the files and is what goes on PATH',
  },
  download_file: {
    params: '{ url: string, into?: string, filename?: string, max_bytes?: number }',
    note: 'Fetches a web address to a file on disk — into defaults to Downloads. No login, no JavaScript: if the link needs a session, use can_browse_web. Pair with can_deliver send_file to get it to a phone. Tier 2',
  },
  hash_file: {
    params: '{ path: string, algorithm?: "sha256" | "sha1" | "md5" | "sha512", expected?: string }',
    note: 'Pass expected to check a download against a published checksum',
  },
};

/** Tier 2 — drive an application through UI Automation. Deterministic, no vision. */
export const APP_ACTIONS: Record<string, ActionSpec> = {
  list_elements: { params: '{ window: string, control_type?: string }', note: 'Discover what a window offers before acting on it' },
  click_element: { params: '{ window: string, name: string, control_type?: string }' },
  set_text: { params: '{ window: string, name: string, text: string }', note: 'Sets the field directly; never types keystrokes' },
  read_element: { params: '{ window: string, name: string }' },
  toggle: { params: '{ window: string, name: string, on: boolean }' },
  set_value: {
    params: '{ window: string, name: string, value: number }',
    note: 'Sliders and spinners. Clamps to the control\u2019s own range and reads back, so one that snaps back fails rather than passing silently',
  },
  select_menu: { params: '{ window: string, path: string[] }  e.g. ["File","Save As"]' },
  wait_for: {
    params: '{ window: string, name: string, timeout?: number }',
    note: 'Wait for a named control; use window_state when only the window needs to be ready',
  },
  window_state: { params: '{ window: string }' },
  draw_strokes: {
    params: '{ window: string, strokes: <from trace_image> }',
    note: 'Draws the strokes onto the app’s canvas with the real mouse, a batch at a time so Stop works. Refuses unless that window is in front. Tier 2 — it takes over the pointer for minutes',
  },
};

/**
 * The web — a real agent that was invisible to the planner.
 *
 * These actions have existed and worked since slice 4. `planner.ts` allowed a
 * step to name `can_browse_web`, but `capabilityCatalogue()` documented no such
 * capability, so the model was told the name was legal and never told what it
 * could do with it. The result was that "open chrome and log on to X" planned a
 * `launch_app` and then GUI steps, instead of one browser task — the exact
 * drift this file's header warns about, one level up.
 */
export const WEB_ACTIONS: Record<string, ActionSpec> = {
  navigate: {
    params: '{ url: string, browser?: string }',
    note: 'Opens a real browser and goes there. Set browser only when the owner named one ("vivaldi", "chrome")',
  },
  read_page: { params: '{}', note: 'The current page as text — use before deciding what to click' },
  extract: { params: '{ selector: string }', note: 'Text of elements matching a CSS selector' },
  click: { params: '{ selector?: string, text?: string }' },
  type_text: { params: '{ selector: string, text: string }', note: 'Refuses password fields; Dex hands those to the owner' },
  screenshot: { params: '{ path?: string, full_page?: boolean }', note: 'Saves a PNG and returns where it went' },
  map_page: {
    params: '{ query?: string, include_hidden?: boolean, browser?: string }',
    note: 'Every link, button and field with its real label, selector and href — including collapsed menu items read_page cannot see. For a page with no heading for what you want. query ranks, it does not filter',
  },
  session_status: {
    params: '{ url: string, browser?: string }',
    note: 'Is this site still signed in? Ask FIRST for anything behind a login',
  },
  sign_in: {
    params: '{ url: string, browser?: string }',
    note: 'Fills the credential the owner stored for that exact site, then hands the CAPTCHA to them. The session is kept, so this is once per day, not per task',
  },
  download_current: {
    params: '{ name?: string, browser?: string }',
    note: 'Saves what the signed-in page offered. Use for anything behind a login: download_file has no session and fetches the login page',
  },
  learn_route: {
    params: '{ url: string, goal: string }',
    note: 'Watch the owner click their way to something once and remember it. Only when they ask Dex to learn or remember where something is',
  },
  run_task: {
    params: '{ task: string, url?: string, browser?: string }',
    note: 'Autonomous multi-step browsing, for anything needing judgement across pages. Dex keeps its own signed-in profile. Set start_url so a remembered route can be found',
  },
};

/** Email, calendar and files through MCP. Also missing from the catalogue. */
export const WORKSPACE_ACTIONS: Record<string, ActionSpec> = {
  search_email: { params: '{ query: string, limit?: number }' },
  read_email: { params: '{ id: string }' },
  send_email: { params: '{ to: string, subject: string, body: string }', note: 'Tier 2 — always confirm before sending to a person' },
  list_calendar_events: { params: '{ start?: string, end?: string }' },
  create_calendar_event: { params: '{ title: string, start: string, end: string, attendees?: string[] }', note: 'Tier 2' },
  search_drive: { params: '{ query: string }' },
  read_drive_file: { params: '{ id: string }' },
};

/**
 * Sending something back to the person who asked.
 *
 * The half of "download that zip and send it to my phone" that happens after
 * the download. It exists so the owner can retrieve things from this machine
 * while away from it — the file lands here, and Dex puts it in the
 * conversation they asked from.
 *
 * The target is never chosen by the plan. It is the chat the request arrived
 * in, looked up by request id, so "send it to me" cannot be talked into
 * meaning a different conversation.
 */
export const DELIVERY_ACTIONS: Record<string, ActionSpec> = {
  send_file: {
    params: '{ path: string, caption?: string }',
    note: 'Sends a file to the chat this request came from — WhatsApp, Telegram or Discord. If the request came from the desktop app there is nowhere to send it, and Dex reports where the file is instead. Tier 2',
  },
  send_message: {
    params: '{ text: string }',
    note: 'A message back to the same chat, for progress worth saying out loud',
  },
};

/** Tier 3 — vision. Last resort. */
export const GUI_ACTIONS: Record<string, ActionSpec> = {
  run_task: {
    params:
      '{ task: string, verify_file?: string, verify_text_in_file?: { path: string, text: string } }',
    note: 'Only for UI that exposes no accessible controls',
  },
};

function render(actions: Record<string, ActionSpec>): string {
  const width = Math.max(...Object.keys(actions).map((a) => a.length));
  return Object.entries(actions)
    .map(([name, spec]) => {
      const line = `  - ${name.padEnd(width)}  params: ${spec.params}`;
      return spec.note ? `${line}\n    ${' '.repeat(width)}  ${spec.note}` : line;
    })
    .join('\n');
}

export const OS_ACTION_NAMES = Object.keys(OS_ACTIONS);

export interface WorkflowSummary {
  name: string;
  description: string;
  params: string[];
  /** What the owner originally said — the best clue to what this is for. */
  triggerText: string;
  steps: number;
}

/**
 * Saved workflows, described so the planner can pick one from any phrasing.
 *
 * This is the half that string matching cannot do. "sound increase", "make it
 * louder" and "bump the volume" are the same request as "set volume to 30" and
 * share none of its words. Understanding that is exactly what the model is for
 * — so it chooses the workflow and supplies the arguments, while the steps
 * themselves still come from what was already verified working.
 */
export function workflowCatalogue(workflows: WorkflowSummary[]): string {
  if (workflows.length === 0) return '';

  const lines = workflows.map((w) => {
    const params = w.params.length
      ? `params: { ${w.params.map((p) => `${p}: string | number`).join(', ')} }`
      : 'params: {}';
    return (
      `  - ${w.name}  ${params}\n` +
      `      ${w.description}\n` +
      `      first saved from: "${w.triggerText}"  (${w.steps} step${w.steps === 1 ? '' : 's'})`
    );
  });

  return `

CAPABILITY: can_run_workflow   [PREFER THIS when one of these fits]
  Tasks the owner has already done and saved. Running one replays steps that
  are known to work, so it is faster and more reliable than planning the same
  thing again. Set "action" to the workflow name.

  Match on INTENT, not wording. "make it louder", "sound up" and "volume 60"
  should all reach a volume workflow. If a saved workflow does what the owner
  is asking, use it — even when they said it completely differently.

  Supply every parameter it lists. If the owner did not give a value and you
  cannot infer a sensible one, plan the task normally instead.
${lines.join('\n')}`;
}

export function capabilityCatalogue(): string {
  return `CAPABILITY: can_control_os   [TIER 1 — always prefer this]
  Direct Windows control through the privileged daemon. No window is opened, no
  UI is touched. Fastest, most reliable, and verifiable by reading state back.
${render(OS_ACTIONS)}

CAPABILITY: can_control_files   [TIER 1 — files, anywhere in the owner's profile]
  Finds, reads, writes, copies, renames, hashes and deletes files without
  screenshots, terminals, or File Explorer typing. Works anywhere under the
  owner's user profile — Documents, Downloads, Desktop, projects — and is
  refused in Windows, Program Files, and Dex's own credential store. A bare
  relative path means the Dex workspace; say "Downloads/x.txt" or a full path
  to work elsewhere.
${render(FILE_ACTIONS)}

CAPABILITY: can_control_app   [TIER 2 — for controlling applications]
  Drives an application through Windows UI Automation: finds a control by its
  NAME and invokes it. No screenshots, no coordinates, nothing that can miss by
  a few pixels. Works for Notepad, File Explorer, Settings, Office, and any
  standard WinUI / WPF / WinForms application.
${render(APP_ACTIONS)}

CAPABILITY: can_browse_web   [TIER 2 — anything on the internet]
  Drives a real browser directly. This is how Dex uses the web — never by
  launching a browser and clicking through it. navigate/read_page/extract for
  something specific; run_task when the job needs judgement across several
  pages, such as searching or sending a message.

  When the owner names a browser, pass browser:"vivaldi" — never launch_app it
  and drive the window. Any Chromium browser works; Firefox is refused by name.
  Dex keeps its own profile, so a site signed into once stays signed in.
${render(WEB_ACTIONS)}

CAPABILITY: can_access_email / can_access_calendar / can_access_drive   [TIER 2]
  Mail, calendar and files through a connected account. Plan against these
  names; Dex resolves them to whatever the live server offers, so a plan
  written for Gmail still works on Outlook. Needs the account connected in
  Settings — if it is not, the step reports that rather than failing obscurely.
${render(WORKSPACE_ACTIONS)}

CAPABILITY: can_deliver   [TIER 2 — send something back to this conversation]
  For requests that arrive from a phone. Fetch or produce a file on this PC,
  then send it to the chat that asked — which is how the owner retrieves
  something while away from the machine. Pair it with can_control_files:
    "download <url> and send it to me"  ->  download_file  then  send_file
    "send me that screenshot"           ->  screenshot     then  send_file
${render(DELIVERY_ACTIONS)}

CAPABILITY: can_control_gui   [TIER 3 — last resort, slow and fallible]
  Takes a screenshot, asks a vision model where things are, moves the mouse.
  Costs tokens, needs a GPU, and can click the wrong thing.
${render(GUI_ACTIONS)}`;
}

/**
 * Which capabilities exist, derived from the catalogue above.
 *
 * The planner's schema enum is generated from this rather than written beside
 * it. The two were maintained by hand and drifted: the enum offered
 * `can_browse_web`, `can_access_email`, `can_access_calendar` and
 * `can_access_drive` while the catalogue described none of them, so the model
 * was allowed to name four capabilities it had never been shown the actions
 * for. `tests/smoke_capabilities.ts` asserts the two agree.
 */
export const CAPABILITY_NAMES = [
  'can_control_os',
  'can_control_files',
  'can_control_app',
  'can_browse_web',
  'can_access_email',
  'can_access_calendar',
  'can_access_drive',
  'can_deliver',
  'can_run_workflow',
  'can_control_gui',
] as const;

/** Every action name, by capability — for the drift check and the tests. */
export const ACTIONS_BY_CAPABILITY: Record<string, string[]> = {
  can_control_os: Object.keys(OS_ACTIONS),
  can_control_files: Object.keys(FILE_ACTIONS),
  can_control_app: Object.keys(APP_ACTIONS),
  can_browse_web: Object.keys(WEB_ACTIONS),
  can_access_email: ['search_email', 'read_email', 'send_email'],
  can_access_calendar: ['list_calendar_events', 'create_calendar_event'],
  can_access_drive: ['search_drive', 'read_drive_file'],
  can_deliver: Object.keys(DELIVERY_ACTIONS),
  can_control_gui: Object.keys(GUI_ACTIONS),
};

/**
 * The routing ladder. Stated as a decision procedure rather than advice,
 * because "prefer X" gets ignored under pressure while "if A then B" does not.
 */
export const ROUTING_RULES = `HOW TO CHOOSE A CAPABILITY — work down this ladder and stop at the first match:

  1. Is there a can_control_os or can_control_files action for it?  -> use TIER 1.
     Volume, DNS, wifi, power plans, processes, services, registry, filename
     search, file writing, program execution, and opening or closing an
     application are direct mechanisms. Never open an app by driving the Start
     menu, never search files through screenshots, and never change a setting
     by clicking through Settings if an action exists for it.

  2. Is it on the internet — a website, a login, a search, a download page?
     -> use can_browse_web. ALWAYS. Never launch_app a browser and then drive
     it with can_control_app or can_control_gui: Dex has a real browser it
     controls directly, and clicking through a browser window is slower, less
     reliable, and cannot read the page it landed on.
       "log in to example.com"        -> can_browse_web run_task
       "what does this page say"      -> can_browse_web read_page
       "screenshot that site"         -> can_browse_web screenshot
     The only reason to launch_app a browser is if the owner asked for the
     browser itself to be open, with nothing to do in it.

  3. Before reaching for TIER 2, ask: could a command do this instead?
     If yes, use run_command. This is the single most common planning mistake,
     and it looks like this:

       WRONG  open Settings -> wait -> click Display -> click Resolution ->
              click "1920 x 1080" -> click Keep changes           (8 steps)
       RIGHT  set_display({resolution: "1920x1080"})               (1 step)

     Eight steps is eight chances to fail on a label Microsoft renamed, and
     that plan really did fail — on "1920 x 1080" versus the "1920 × 1080"
     Settings actually shows. The API does not care what the dropdown is
     called this year.

     **The Settings app is a front end for APIs Dex can already call.** Almost
     nothing in it is a job for TIER 2. Before planning a click into Settings,
     look for a can_control_os action; if there is one, that is the answer.
     If there is no action and no command, only then use TIER 2.

  4. Does it mean operating a normal Windows application?  -> use TIER 2.
     Notepad, File Explorer, Word, Excel, any standard desktop app — software
     that genuinely offers no other way in. Clicking buttons, filling fields,
     choosing menu items. Prefer click_element / set_text / select_menu over
     anything visual.

     When you must click a named item you have not seen, call list_elements
     first and use a name from what it returns. Do not invent a label — a
     guessed "(Recommended)" or "x" instead of "×" fails against a control that
     is sitting right there.

  5. Only if the target draws its own interface  -> use TIER 3.
     Use this only to interact with an already-running game, canvas, image
     editor, or video timeline where there are no real controls to name. If the
     owner asks to create, write, or run source code — including a game — use
     can_control_files first. If you are unsure, choose TIER 2: it reports back
     when it cannot see the controls, and Dex escalates automatically.

  NEVER automate a terminal, console or PowerShell window through Tier 2 or 3.
  System work goes through Tier 1. For local files, use can_control_files:
  find_files; for code, use write_file followed by run_program. These use the
  Dex workspace, never a terminal window. A file-location task should normally be:
    find_files(open_location=true)
  and a code task should normally be:
    write_file -> run_program

  A typical desktop task is a Tier 1 launch followed by Tier 2 steps. For
  example "open Notepad, type hello, save as test.txt" is:
    launch_app -> window_state -> set_text -> select_menu -> set_text -> click_element
  with no vision anywhere. Use wait_for only when the plan knows the NAME of
  the specific control that must appear; window_state is the readiness check
  when the window itself is the target.

USING WHAT AN EARLIER STEP FOUND

  A step can use a value another step produced. Write the reference in that
  step's params and list the step it needs in dependsOn:

    {{step_1.output}}                  everything step_1 returned
    {{step_1.output.best_primary}}     one field
    {{step_1.output.adapters.Wi-Fi}}   nested, dots all the way down
    {{step_1.output.modes[0].width}}   an item in a list

  A value that is exactly one reference keeps its type — a number arrives as a
  number. A reference inside a longer string is substituted as text, which is
  what a command line needs.

    "test several DNS servers and switch to the fastest"
      step_1  run_command   measure them and print the winner as JSON
      step_2  set_dns       primary: "{{step_1.output.best_primary}}"
                            dependsOn: ["step_1"]

  Only refer to a step you have listed in dependsOn, and only to a field that
  step will really return. A reference to something that does not exist stops
  the task — it is not passed through as text, because a placeholder reaching a
  real action is how "Invalid IP: {{step_1.output.best_primary}}" happens.

  If a command must produce a value for a later step, have it print JSON on
  stdout, and point straight at its fields — the parsing is done for you:

      step_1  run_command   ... | ConvertTo-Json -Compress
      step_2  set_dns       primary: "{{step_1.output.best_primary}}"

  A field of a JSON object is something you can point at; a line of prose is
  not. If a command prints a table, nothing can be extracted from it.

  Set run_command's "timeout" to what the command will really need, in seconds.
  Pinging four servers ten times each is forty round trips and will not finish
  in the default thirty; a benchmark that measures too much simply times out
  and the value is never produced. Measure less, or ask for longer.

INSTALLING AND SETTING UP A TOOL

  "set up a C compiler", "install ffmpeg", "get rust working" are all the same
  plan with different nouns:

    1. find_program(name)          already there? Say the version and STOP.
                                   Reinstalling something that works wastes
                                   the owner's time and bandwidth.
    2. install it:
         run_command ["winget","install","--id","<id>","-e",
                      "--accept-package-agreements",
                      "--accept-source-agreements"]
       winget is first because it puts the tool on PATH itself, so steps 3 and
       4 usually become unnecessary. If winget has no package for it:
         download_file  ->  extract_archive
    3. set_env(name:"PATH", value:"{{step_N.output.root}}", append:true)
       ONLY on the download route. Use the "root" the extraction reported, not
       a path you guessed. set_env broadcasts the change, so a new shell sees
       it without a logout.
    4. find_program(name) AGAIN. The version it prints is the proof; the
       installer's exit code is not.
    5. PROVE IT WORKS. Installed is not set up:
         write_file  a tiny source file that uses the tool
         run_program compile or run it
         and check the OUTPUT, not just the exit code
       For a compiler that means a hello-world compiled and then executed. A
       compiler that installs and cannot compile has not been set up, and the
       only way to know is to try.

  Say the version. "Installed gcc" is not an answer; "gcc 14.2.0 is on PATH and
  compiled and ran a test program" is.

EDITING AN IMAGE

  Resize, crop to numbers, rotate, convert, compress?
    -> write_file a short Pillow script, then run_program it. Deterministic and
       no window opens. PREFER THIS.

  Asked for the Photos app by name, or for something only its UI does?
    -> launch_app "Photos" -> window_state -> click_element "Edit"
       -> set_value on the sliders (Brightness, Contrast, Saturation...)
       -> click_element "Save a copy"
    Never "Save": an edit Dex cannot undo is not one to make in place.

ANYTHING BEHIND A LOGIN — a university portal, a bank, a dashboard

  Dex keeps its own profile, so a site signed into once stays signed in. A
  portal plan is almost always:

    1. session_status(url)     is it still signed in? Ask FIRST.
    2. sign_in(url)            ONLY if it is not. Fills the stored credential
                               and hands the CAPTCHA to the owner.
    3. run_task(...)           the actual job, with start_url set to the portal
    4. download_current(...)   for a file. NEVER download_file behind a login.
    5. read_document(path)     say what is in it, not just where it went

  Set start_url on run_task whenever the site is one Dex may have been shown
  before — that is what lets a remembered route be found and followed.

  When a page has no heading for what you want, map_page(query) before
  guessing: it reads the document, so it sees collapsed menu items and links
  whose href says more than their text. read_page sees neither.

  learn_route is only for when the owner asks Dex to LEARN or REMEMBER where
  something is: they click through once and Dex notes the names. It needs them
  sitting there, so never plan it otherwise.

DRAWING A PICTURE

  "draw this in Paint", "sketch that photo":
    1. trace_image(path)   turns the reference into outline strokes
    2. launch_app "Paint" -> window_state
    3. draw_strokes(window, strokes: {{step_1.output.strokes}})
  It draws a line sketch, stroke by stroke, with the real mouse. Say that is
  what it will be — a traced outline, not a reproduction of the photo.`;
