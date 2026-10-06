/**
 * What a Windows tool call may do, and whether DEX asks first
 * (docs/desktop-control/PLAN.md §2.1, with the owner's decisions in §6).
 *
 * Pure: the server resolves the window, this decides. Main's approval
 * policy (approvals/policy.ts) then applies the user's Approvals setting —
 * Full access runs everything here without a card.
 *
 * Tiers: 0 reads, 1 acts inside an app, 3 hard to undo. Refused is refused
 * in every mode.
 */

/** Apps DEX never drives, not even to read: process name (lower case) → why. */
export const BLOCKED_PROCESSES = new Map([
  // Password managers: what's on screen is the user's secrets.
  ...['1password.exe', 'bitwarden.exe', 'keepass.exe', 'keepassxc.exe', 'dashlane.exe', 'nordpass.exe', 'enpass.exe', 'keeper.exe', 'keepersecurity.exe', 'roboform.exe', 'lastpass.exe', 'proton pass.exe', 'protonpass.exe']
    .map((p) => [p, 'it holds your passwords']),
  // Windows' own security and sign-in surfaces.
  ...['sechealthui.exe', 'securityhealthhost.exe', 'consent.exe', 'credentialuibroker.exe', 'lockapp.exe', 'logonui.exe', 'useraccountcontrolsettings.exe']
    .map((p) => [p, "it's part of Windows security or sign-in"]),
  // Other agents: one agent steering another is how instructions get laundered.
  ...['chatgpt.exe', 'claude.exe', 'codex.exe', 'copilot.exe', 'cursor.exe']
    .map((p) => [p, "it's another AI agent"]),
  // Terminals: DEX has its own shell; the user's terminal is theirs.
  ...['windowsterminal.exe', 'wt.exe', 'mintty.exe', 'alacritty.exe', 'wezterm-gui.exe']
    .map((p) => [p, 'terminals are off-limits (DEX uses its own shell)']),
]);

/**
 * Console windows, by class: cmd and PowerShell windows belong to conhost
 * (or Windows Terminal), but PowerShell also hosts ordinary app windows.
 */
const TERMINAL_CLASSES = new Set(['consolewindowclass', 'cascadia_hosting_window_class', 'pseudoconsolewindow']);

export function blockedReason(win) {
  if (!win) return null;
  const byProcess = win.process ? BLOCKED_PROCESSES.get(String(win.process).toLowerCase()) : null;
  if (byProcess) return byProcess;
  if (win.className && TERMINAL_CLASSES.has(String(win.className).toLowerCase())) return 'terminals are off-limits (DEX uses its own shell)';
  return null;
}

const READS = new Set(['windows_list', 'window_tree', 'window_find', 'window_capture', 'ui_wait', 'ui_scroll', 'system_info']);

function appName(win) {
  return (win?.process ?? 'the app').replace(/\.exe$/i, '');
}

function targetLabel(target) {
  if (!target) return 'it';
  if (typeof target === 'string') return target;
  return target.name ? `“${target.name}”` : target.automationId ? `#${target.automationId}` : 'it';
}

/**
 * {tier, category, title, detail, subject} for a call, or {refused} when DEX
 * must not do it. `win` is the resolved window (process, title, openedByDex),
 * or null for tools that don't take one.
 */
export function classify(tool, args = {}, win = null) {
  const blocked = blockedReason(win);
  if (blocked) return { refused: `DEX doesn't use ${appName(win)}: ${blocked}.` };

  if (READS.has(tool)) return { tier: 0 };
  if (tool === 'media') {
    if (!args.action || args.action === 'status') return { tier: 0 };
    return {
      tier: 1,
      category: 'app-control',
      title: 'Control what’s playing',
      detail: `${args.action}${args.value !== undefined ? ` ${args.value}` : ''}${args.app ? ` in ${args.app}` : ''}`,
      subject: 'media',
    };
  }
  if (tool === 'app_launch') {
    const what = args.uri ?? args.app ?? 'an app';
    return { tier: 1, category: 'app-control', title: `Open ${what}`, detail: args.show ? 'On your screen.' : 'In the background, off your screen.', subject: String(what) };
  }
  if (tool === 'open_settings') {
    return { tier: 1, category: 'app-control', title: 'Show a Settings page', detail: `ms-settings:${args.page}`, subject: 'settings' };
  }
  if (tool === 'window_manage') {
    const mine = Boolean(win?.openedByDex);
    if (args.action === 'close' && !mine) {
      return { tier: 3, category: 'system-destructive', title: `Close ${appName(win)}`, detail: `“${win?.title ?? ''}” — a window you opened. Unsaved work in it could be lost.`, subject: win?.process };
    }
    return { tier: 1, category: 'app-control', title: `${args.action} ${appName(win)}`, detail: win?.title ?? '', subject: win?.process };
  }
  const verbs = {
    ui_invoke: (a) => `Press ${targetLabel(a.target)}`,
    ui_set_text: (a) => `Type into ${targetLabel(a.target)}`,
    ui_toggle: (a) => `Turn ${targetLabel(a.target)} ${a.state ?? 'on'}`,
    ui_select: (a) => `Select ${targetLabel(a.target)}`,
    ui_expand: (a) => `${a.expanded === false ? 'Close' : 'Open'} ${targetLabel(a.target)}`,
  };
  if (verbs[tool]) {
    return {
      tier: 1,
      category: 'app-control',
      title: `${verbs[tool](args)} in ${appName(win)}`,
      detail: tool === 'ui_set_text' ? `“${String(args.text ?? '').slice(0, 300)}”` : (win?.title ?? ''),
      subject: win?.process,
    };
  }
  return { refused: `Unknown tool ${tool}.` };
}
