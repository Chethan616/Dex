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
  registry_read: { params: '{ path: string, name: string }' },
  registry_write: { params: '{ path: string, name: string, value: any, type?: number }', note: 'Tier 2 unless the key is Dex-owned. Security/policy keys are refused outright' },
  registry_classify: { params: '{ path: string }', note: 'Ask which band a registry path falls in before planning a write' },
  run_shell: { params: '{ command: string[] }', note: 'Read-only commands only: ipconfig, netsh, powercfg, tasklist, systeminfo, whoami, hostname' },
};

/** Tier 2 — drive an application through UI Automation. Deterministic, no vision. */
export const APP_ACTIONS: Record<string, ActionSpec> = {
  list_elements: { params: '{ window: string, control_type?: string }', note: 'Discover what a window offers before acting on it' },
  click_element: { params: '{ window: string, name: string, control_type?: string }' },
  set_text: { params: '{ window: string, name: string, text: string }', note: 'Sets the field directly; never types keystrokes' },
  read_element: { params: '{ window: string, name: string }' },
  toggle: { params: '{ window: string, name: string, on: boolean }' },
  select_menu: { params: '{ window: string, path: string[] }  e.g. ["File","Save As"]' },
  wait_for: { params: '{ window: string, name: string, timeout?: number }', note: 'Use instead of assuming a window is ready' },
  window_state: { params: '{ window: string }' },
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

CAPABILITY: can_control_app   [TIER 2 — for controlling applications]
  Drives an application through Windows UI Automation: finds a control by its
  NAME and invokes it. No screenshots, no coordinates, nothing that can miss by
  a few pixels. Works for Notepad, File Explorer, Settings, Office, and any
  standard WinUI / WPF / WinForms application.
${render(APP_ACTIONS)}

CAPABILITY: can_control_gui   [TIER 3 — last resort, slow and fallible]
  Takes a screenshot, asks a vision model where things are, moves the mouse.
  Costs tokens, needs a GPU, and can click the wrong thing.
${render(GUI_ACTIONS)}`;
}

/**
 * The routing ladder. Stated as a decision procedure rather than advice,
 * because "prefer X" gets ignored under pressure while "if A then B" does not.
 */
export const ROUTING_RULES = `HOW TO CHOOSE A CAPABILITY — work down this ladder and stop at the first match:

  1. Is there a can_control_os action for it?  -> use TIER 1.
     Volume, DNS, wifi, power plans, processes, services, registry, and opening
     or closing an application are ALL Tier 1. Never open an app by driving the
     Start menu, and never change a setting by clicking through Settings if an
     action exists for it.

  2. Does it mean operating a normal Windows application?  -> use TIER 2.
     Notepad, File Explorer, Settings, Word, Excel, any standard desktop app.
     Clicking buttons, filling fields, choosing menu items. Prefer
     click_element / set_text / select_menu over anything visual.

  3. Only if the target draws its own interface  -> use TIER 3.
     Games, canvases, image editors, video timelines — UI where there are no
     real controls to name. If you are unsure, choose TIER 2: it reports back
     when it cannot see the controls, and Dex escalates automatically.

  NEVER automate a terminal, console or PowerShell window through Tier 2 or 3.
  System work goes through Tier 1.

  A typical desktop task is a Tier 1 launch followed by Tier 2 steps. For
  example "open Notepad, type hello, save as test.txt" is:
    launch_app -> wait_for -> set_text -> select_menu -> set_text -> click_element
  with no vision anywhere.`;
