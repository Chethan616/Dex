/**
 * The Windows tools, as engines see them (docs/desktop-control/PLAN.md §4.1.3).
 *
 * Each maps to one host op. Descriptions are written for the model: they say
 * what's safe, what comes back, and what to do next — the same rules
 * dex-tools/desktop.md teaches at length.
 */

const windowSelector = {
  type: 'object',
  description: 'Which window: {hwnd} from windows_list (best), {process:"Spotify.exe"}, {title:"Calculator", match?:"exact"|"contains"}, or {opened:"L3"} from app_launch. Must match exactly one window.',
  properties: {
    hwnd: { type: 'number' },
    process: { type: 'string' },
    title: { type: 'string' },
    match: { type: 'string', enum: ['exact', 'contains'] },
    opened: { type: 'string' },
  },
};

const target = {
  description: 'An element: a handle like "e17" from window_tree/window_find (best), or a locator {name, role?, automationId?}.',
  anyOf: [
    { type: 'string' },
    { type: 'object', properties: { name: { type: 'string' }, role: { type: 'string' }, automationId: { type: 'string' } } },
  ],
};

export const TOOLS = [
  {
    name: 'windows_list',
    op: 'windows',
    description: "The user's open windows: hwnd, title, process, whether it's in front or on screen, and whether DEX opened it. Start here.",
    inputSchema: { type: 'object', properties: { includeMinimized: { type: 'boolean' } } },
  },
  {
    name: 'window_tree',
    op: 'tree',
    description: 'What a window contains, as accessibility nodes: handle (h), role, name, automation id, value, the patterns it supports (pat: invoke/value/toggle/select/expand/scroll) and state (st). Works on background and off-screen windows; never brings them forward. Handles stay the same across reads. Read again after anything that changes the UI.',
    inputSchema: {
      type: 'object',
      required: ['window'],
      properties: {
        window: windowSelector,
        root: { type: 'string', description: 'Only under this handle.' },
        depth: { type: 'number', description: '1–12, default 6.' },
        max: { type: 'number', description: 'Up to 600 nodes, default 250.' },
        mode: { type: 'string', enum: ['actionable', 'all'], description: "'actionable' (default) skips unnamed containers." },
      },
    },
  },
  {
    name: 'window_find',
    op: 'find',
    description: 'Find elements in a window by name (exact, then prefix, then whole word), role and/or automation id. Cheaper than a full tree. With no match, `near` lists names that do exist.',
    inputSchema: {
      type: 'object',
      required: ['window'],
      properties: {
        window: windowSelector,
        name: { type: 'string' },
        role: { type: 'string', description: 'Button, Edit, ListItem, CheckBox, MenuItem, TabItem, …' },
        automationId: { type: 'string' },
        match: { type: 'string', enum: ['exact', 'prefix', 'contains'] },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'window_capture',
    op: 'capture',
    description: "A picture of one window, even while it's in the background or parked off-screen (never the whole screen). annotate:true labels the last window_tree's handles on it.",
    inputSchema: {
      type: 'object',
      required: ['window'],
      properties: { window: windowSelector, annotate: { type: 'boolean' }, maxWidth: { type: 'number' } },
    },
  },
  {
    name: 'ui_invoke',
    op: 'invoke',
    description: "Press a button, link, menu item or list item through accessibility — no mouse, no focus change. Returns which method worked. If it says needs_input, the control can't be pressed without the real mouse.",
    inputSchema: { type: 'object', required: ['window', 'target'], properties: { window: windowSelector, target } },
  },
  {
    name: 'ui_set_text',
    op: 'set_text',
    description: 'Put text in a field (replaces it, or append:true), and read it back. Refuses password fields: ask the user to type those.',
    inputSchema: {
      type: 'object',
      required: ['window', 'target', 'text'],
      properties: { window: windowSelector, target, text: { type: 'string' }, append: { type: 'boolean' } },
    },
  },
  {
    name: 'ui_toggle',
    op: 'toggle',
    description: 'Set a check box or switch to on or off (reads it first; never flips blindly).',
    inputSchema: {
      type: 'object',
      required: ['window', 'target', 'state'],
      properties: { window: windowSelector, target, state: { type: 'string', enum: ['on', 'off'] } },
    },
  },
  {
    name: 'ui_select',
    op: 'select',
    description: 'Select a list item, tab or radio button.',
    inputSchema: { type: 'object', required: ['window', 'target'], properties: { window: windowSelector, target } },
  },
  {
    name: 'ui_expand',
    op: 'expand',
    description: 'Open or close a drop-down, tree node or menu.',
    inputSchema: {
      type: 'object',
      required: ['window', 'target'],
      properties: { window: windowSelector, target, expanded: { type: 'boolean', description: 'Default true.' } },
    },
  },
  {
    name: 'ui_scroll',
    op: 'scroll',
    description: 'Scroll the container around an element, or bring an element into view (intoView:true).',
    inputSchema: {
      type: 'object',
      required: ['window', 'target'],
      properties: {
        window: windowSelector,
        target,
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
        amount: { type: 'string', enum: ['small', 'large'] },
        intoView: { type: 'boolean' },
      },
    },
  },
  {
    name: 'ui_wait',
    op: 'wait',
    description: 'Wait (up to 30 s) for an element to appear — or to disappear with gone:true — after an action that loads something.',
    inputSchema: {
      type: 'object',
      required: ['window'],
      properties: {
        window: windowSelector,
        name: { type: 'string' },
        role: { type: 'string' },
        automationId: { type: 'string' },
        gone: { type: 'boolean' },
        timeoutMs: { type: 'number' },
      },
    },
  },
  {
    name: 'app_launch',
    op: 'launch',
    description: "Open an app in the background: its window is parked just off-screen (not minimized, so it keeps working) and the user's focus stays where it is. app: an exe path or an app id from system_info apps (startMenu). show:true only when the user wants to see it. Returns a launchId to use as {opened}.",
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string' },
        args: { type: 'string' },
        uri: { type: 'string', description: 'Open a link or protocol (spotify:playlist:…, ms-settings:…) instead.' },
        show: { type: 'boolean' },
      },
    },
  },
  {
    name: 'window_manage',
    op: 'window',
    description: "park/unpark a window DEX opened (unpark puts it on the user's screen without stealing focus); minimize or close a window. Closing a window DEX didn't open counts as destructive.",
    inputSchema: {
      type: 'object',
      required: ['window', 'action'],
      properties: { window: windowSelector, action: { type: 'string', enum: ['park', 'unpark', 'minimize', 'close'] } },
    },
  },
  {
    name: 'media',
    op: 'media',
    description: "Windows' media controls for whatever is playing (Spotify, a browser, any player): status, play, pause, toggle, next, previous, shuffle (value true/false), repeat (value none/track/list). No window needed. Use this for playback; use the app's own UI only to pick what plays.",
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['status', 'play', 'pause', 'toggle', 'next', 'previous', 'shuffle', 'repeat'] },
        value: { description: 'shuffle: true/false; repeat: none/track/list.' },
        app: { type: 'string', description: 'Part of the app id, e.g. "Spotify", when several are playing.' },
      },
    },
  },
  {
    name: 'system_info',
    op: 'sys',
    description: "Read the PC's state without changing anything: network (adapters, IP, DNS, gateway, internet), wifi (signal, band, rates), wlan_events (drops per hour, recent disconnect reasons; hours?), devices (class? e.g. Mouse, Net, HIDClass; without class: devices with problems), driver (instanceId), touchpad (precision touchpad settings and gestures), apps (filter?; installed, store and Start-menu app ids), events (log: system/wlan/ncsi/dhcp/pnp/apperrors; hours?, provider?, limit?).",
    inputSchema: {
      type: 'object',
      required: ['topic'],
      properties: {
        topic: { type: 'string', enum: ['network', 'wifi', 'wlan_events', 'devices', 'driver', 'touchpad', 'apps', 'events'] },
        hours: { type: 'number' },
        class: { type: 'string' },
        instanceId: { type: 'string' },
        filter: { type: 'string' },
        log: { type: 'string' },
        provider: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'system_change',
    op: 'change',
    description: "Change the PC — only these, each typed and checked: dns_flush, wifi_reconnect {profile?}, explorer_restart, gesture_set {key, value} (touchpad gestures; see system_info touchpad), touchpad_set {field, value}, app_uninstall {wingetId}; and, through DEX's admin helper: ip_renew {adapter?}, adapter_restart {name}, dns_set {adapter, servers: ['1.1.1.1'] | 'dhcp'}, device_restart / device_enable / device_disable {instanceId}, service_restart {name}, winsock_reset, ip_stack_reset, restore_point {description?}. Diagnose with system_info first; change the cheapest thing that fixes it; give `reason` in plain words (the user may see it on an approval card). Each change is journaled; `undo` reverses the ones that can be.",
    inputSchema: {
      type: 'object',
      required: ['action', 'reason'],
      properties: {
        action: { type: 'string' },
        args: { type: 'object', description: 'The action’s own fields, e.g. {key:"ThreeFingerSlideEnabled", value:1}.' },
        reason: { type: 'string', description: 'Why, in one sentence the user would understand.' },
      },
    },
  },
  {
    name: 'undo',
    op: 'undo',
    description: "Reverse the last change this task made (or the one with `entry`, from a system_change result) — only changes with a recorded undo: DNS servers, touchpad settings and gestures, turning a device off or on.",
    inputSchema: { type: 'object', properties: { entry: { type: 'string' } } },
  },
  {
    name: 'input_act',
    op: 'borrow',
    description: "Last resort, for a control that only works with the real mouse (ui_invoke said needs_input) or an app with no accessibility. DEX borrows the user's mouse and keyboard for a moment: it waits for a pause in their input, brings the window up, shows a glow round the screen, runs the steps, then puts their window and pointer back. If they move the mouse or type, DEX lets go at once (stopped: user_took_over) — don't fight them; wait or ask. Steps: {click:{target:\"e17\"}} (the element's centre) or {click:{x, y}} (pixels in this window's last window_capture picture), with button:\"right\" or double:true; {type:\"text\"} (refused in password fields); {key:\"Enter\"|\"Ctrl+S\"|\"Alt+F4\"…}; {scroll:{target|x,y, dy}} (dy>0 scrolls down); {wait:ms} (≤5000). Batch every step of one job into one call; check the result with window_find or window_capture.",
    inputSchema: {
      type: 'object',
      required: ['window', 'steps', 'why'],
      properties: {
        window: windowSelector,
        steps: { type: 'array', minItems: 1, maxItems: 40, items: { type: 'object' } },
        why: { type: 'string', description: 'What these steps do, in plain words (the user may see it).' },
        maxWaitMs: { type: 'number', description: 'How long to wait for the user to pause (default 20000, at most 30000).' },
      },
    },
  },
  {
    name: 'open_settings',
    op: 'launch',
    description: "Open a Windows Settings page (an ms-settings id like 'network-wifi', 'mousetouchpad', 'devices-touchpad', 'apps-volume') for the user to SEE. It comes to the front, so use it only when the user asked to see it, or as the very last step. To diagnose, use system_info instead.",
    inputSchema: { type: 'object', required: ['page'], properties: { page: { type: 'string' } } },
  },
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);
export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** The host op and its args for a tool call. */
export function toHostOp(name, args) {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  if (name === 'open_settings') {
    const page = String(args.page ?? '').replace(/^ms-settings:/i, '');
    if (!/^[a-z0-9-]+$/i.test(page)) throw new Error('page is an ms-settings id like "network-wifi".');
    return { op: 'launch', args: { uri: `ms-settings:${page}`, show: true } };
  }
  return { op: tool.op, args };
}
