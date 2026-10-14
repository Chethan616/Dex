/**
 * The Windows tools (mcp-servers/windows) in plain words: "Pressed Shuffle in
 * Spotify", "Read your Wi-Fi adapter". The chat labels each step with these,
 * and the Desk tab's caption says what DEX is doing right now
 * (docs/desktop-control/PLAN.md §Phase 3).
 */

export interface DeskWords {
  /** Present tense, while it runs: "Pressing Shuffle in Spotify". */
  active: string;
  /** Past tense, once done: "Pressed Shuffle in Spotify". */
  done: string;
}

type Args = Record<string, unknown>;

/** Processes that host other people's windows: the window's title names it better. */
const HOSTS = new Set(['powershell', 'pwsh', 'applicationframehost', 'javaw', 'java', 'python', 'pythonw', 'node', 'electron', 'rundll32', 'dllhost', 'mmc', 'cmd', 'conhost', 'wscript', 'mshta']);

/** "Spotify.exe" → "Spotify"; a few Windows names; a host's window by its title. */
export function appName(process: unknown, title?: unknown): string {
  const raw = typeof process === 'string' ? process.replace(/\.exe$/i, '') : '';
  const t = typeof title === 'string' ? title.trim() : '';
  if (t && HOSTS.has(raw.toLowerCase())) return t.length > 40 ? `${t.slice(0, 39)}…` : t;
  const known: Record<string, string> = {
    applicationframehost: 'the app', systemsettings: 'Settings', explorer: 'File Explorer', mspaint: 'Paint',
    notepad: 'Notepad', calculatorapp: 'Calculator', winword: 'Word', excel: 'Excel', powerpnt: 'PowerPoint',
    msedge: 'Edge', chrome: 'Chrome', firefox: 'Firefox', 'ms-teams': 'Teams', olk: 'Outlook', outlook: 'Outlook',
  };
  return known[raw.toLowerCase()] ?? (raw || 'the app');
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A target as the user would say it: “Shuffle”, or "a button" when only a handle is known. */
function targetWords(target: unknown, element?: { name?: string; role?: string } | null): string {
  const name = element?.name?.trim() || (target && typeof target === 'object' ? str((target as Args).name).trim() : '');
  if (name) return `“${name.length > 40 ? `${name.slice(0, 39)}…` : name}”`;
  const role = (element?.role || (target && typeof target === 'object' ? str((target as Args).role) : '')).toLowerCase();
  const roles: Record<string, string> = {
    button: 'a button', checkbox: 'a check box', edit: 'a text field', listitem: 'a list item', menuitem: 'a menu item',
    tabitem: 'a tab', hyperlink: 'a link', radiobutton: 'an option', combobox: 'a drop-down', treeitem: 'an item',
  };
  return roles[role] ?? 'a control';
}

function pair(active: string, done: string): DeskWords {
  return { active, done };
}

const TOPICS: Record<string, DeskWords> = {
  network: pair('Checking your network', 'Checked your network'),
  wifi: pair('Reading your Wi-Fi adapter', 'Read your Wi-Fi adapter'),
  wlan_events: pair('Reading when your Wi-Fi dropped', 'Read when your Wi-Fi dropped'),
  devices: pair('Checking your devices', 'Checked your devices'),
  driver: pair('Reading a driver’s details', 'Read a driver’s details'),
  touchpad: pair('Reading your touchpad settings', 'Read your touchpad settings'),
  apps: pair('Looking through your apps', 'Looked through your apps'),
  events: pair('Reading Windows’ event log', 'Read Windows’ event log'),
};

const CHANGES: Record<string, (a: Args) => DeskWords> = {
  dns_flush: () => pair('Clearing the DNS cache', 'Cleared the DNS cache'),
  wifi_reconnect: () => pair('Reconnecting Wi-Fi', 'Reconnected Wi-Fi'),
  explorer_restart: () => pair('Restarting Windows Explorer', 'Restarted Windows Explorer'),
  gesture_set: () => pair('Changing a touchpad gesture', 'Changed a touchpad gesture'),
  touchpad_set: () => pair('Changing a touchpad setting', 'Changed a touchpad setting'),
  app_uninstall: (a) => pair(`Uninstalling ${str(a.wingetId) || 'an app'}`, `Uninstalled ${str(a.wingetId) || 'an app'}`),
  ip_renew: () => pair('Renewing your IP address', 'Renewed your IP address'),
  adapter_restart: (a) => pair(`Restarting ${str(a.name) || 'a network adapter'}`, `Restarted ${str(a.name) || 'a network adapter'}`),
  dns_set: (a) => pair(`Changing ${str(a.adapter) || 'the'} DNS servers`, `Changed ${str(a.adapter) || 'the'} DNS servers`),
  device_restart: () => pair('Restarting a device', 'Restarted a device'),
  device_enable: () => pair('Turning a device on', 'Turned a device on'),
  device_disable: () => pair('Turning a device off', 'Turned a device off'),
  service_restart: (a) => pair(`Restarting the ${str(a.name) || ''} service`.replace('  ', ' '), `Restarted the ${str(a.name) || ''} service`.replace('  ', ' ')),
  winsock_reset: () => pair('Resetting Winsock', 'Reset Winsock'),
  ip_stack_reset: () => pair('Resetting the network stack', 'Reset the network stack'),
  restore_point: () => pair('Making a restore point', 'Made a restore point'),
};

const MEDIA: Record<string, (a: Args) => DeskWords> = {
  status: () => pair('Checking what’s playing', 'Checked what’s playing'),
  play: () => pair('Pressing play', 'Pressed play'),
  pause: () => pair('Pausing', 'Paused'),
  toggle: () => pair('Pressing play/pause', 'Pressed play/pause'),
  next: () => pair('Skipping to the next track', 'Skipped to the next track'),
  previous: () => pair('Going back a track', 'Went back a track'),
  shuffle: (a) => (a.value === false ? pair('Turning shuffle off', 'Turned shuffle off') : pair('Turning shuffle on', 'Turned shuffle on')),
  repeat: (a) => {
    const v = str(a.value);
    if (v === 'none') return pair('Turning repeat off', 'Turned repeat off');
    const what = v === 'track' ? 'this track' : 'the list';
    return pair(`Repeating ${what}`, `Set repeat to ${what}`);
  },
};

/**
 * Words for one Windows tool call. `window` is the window it worked in (its
 * process), `element` what it acted on, once the call came back.
 */
export function deskWords(tool: string, args: Args = {}, window?: { process?: string; title?: string } | null, element?: { name?: string; role?: string } | null): DeskWords {
  const sel = args.window && typeof args.window === 'object' ? (args.window as Args) : {};
  const app = window?.process || window?.title ? appName(window.process, window.title) : appName(sel.process, sel.title);
  const t = targetWords(args.target, element);
  switch (tool) {
    case 'windows_list': return pair('Looking at your open windows', 'Looked at your open windows');
    case 'window_tree': return pair(`Reading what’s in ${app}`, `Read what’s in ${app}`);
    case 'window_find': {
      const name = str(args.name);
      return name ? pair(`Looking for “${name}” in ${app}`, `Looked for “${name}” in ${app}`) : pair(`Searching ${app}`, `Searched ${app}`);
    }
    case 'window_capture': return pair(`Looking at ${app}`, `Took a picture of ${app}`);
    case 'ui_invoke': return pair(`Pressing ${t} in ${app}`, `Pressed ${t} in ${app}`);
    case 'ui_set_text': return pair(`Typing into ${t} in ${app}`, `Typed into ${t} in ${app}`);
    case 'ui_toggle': {
      const s = args.state === 'off' ? 'off' : 'on';
      return pair(`Turning ${t} ${s} in ${app}`, `Turned ${t} ${s} in ${app}`);
    }
    case 'ui_select': return pair(`Selecting ${t} in ${app}`, `Selected ${t} in ${app}`);
    case 'ui_expand': return args.expanded === false ? pair(`Closing ${t} in ${app}`, `Closed ${t} in ${app}`) : pair(`Opening ${t} in ${app}`, `Opened ${t} in ${app}`);
    case 'ui_scroll': return args.intoView ? pair(`Scrolling to ${t} in ${app}`, `Scrolled to ${t} in ${app}`) : pair(`Scrolling ${app}`, `Scrolled ${app}`);
    case 'ui_wait': return pair(`Waiting for ${app}`, `Waited for ${app}`);
    case 'app_launch': {
      const what = appName(str(args.app).split(/[\\/!]/).pop() || str(args.uri).split(':')[0] || 'an app');
      return args.show ? pair(`Opening ${what}`, `Opened ${what}`) : pair(`Opening ${what} in the background`, `Opened ${what} in the background`);
    }
    case 'window_manage': {
      const a = str(args.action);
      if (a === 'park') return pair(`Moving ${app} off your screen`, `Moved ${app} off your screen`);
      if (a === 'unpark') return pair(`Putting ${app} on your screen`, `Put ${app} on your screen`);
      if (a === 'minimize') return pair(`Minimizing ${app}`, `Minimized ${app}`);
      if (a === 'close') return pair(`Closing ${app}`, `Closed ${app}`);
      return pair(`Arranging ${app}`, `Arranged ${app}`);
    }
    case 'media': return (MEDIA[str(args.action)] ?? MEDIA.status)(args);
    case 'system_info': return TOPICS[str(args.topic)] ?? pair('Checking your PC', 'Checked your PC');
    case 'system_change': {
      const f = CHANGES[str(args.action)];
      const a = args.args && typeof args.args === 'object' ? (args.args as Args) : {};
      return f ? f(a) : pair('Changing a setting', 'Changed a setting');
    }
    case 'undo': return pair('Undoing a change', 'Undid a change');
    case 'input_act': return pair(`Using your mouse in ${app}`, `Used your mouse in ${app}`);
    case 'open_settings': return pair('Opening Settings', 'Opened Settings');
    default: return pair('Using Windows', 'Used Windows');
  }
}
