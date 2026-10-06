/**
 * The changes DEX may make to the PC (docs/desktop-control/PLAN.md §4.2.3) —
 * typed and allowlisted: no free text reaches a shell. Each says its tier,
 * whether it needs administrator rights (the elevated helper runs those),
 * how to describe it on an approval card, and how it's undone.
 *
 * Tiers: 2 reversible, 3 hard to undo. Categories follow approvals/policy.ts.
 */

const str = (v, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max;
const NAME = /^[\w .()&'-]{1,80}$/u;                       // adapter, service, profile names
const INSTANCE = /^[A-Za-z0-9\\&_.#{}-]{3,200}$/;          // device instance ids
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const WINGET_ID = /^[A-Za-z0-9][\w.+-]{1,120}$/;

/** HKCU\…\PrecisionTouchPad values DEX may set, and what each number means. */
export const GESTURE_KEYS = {
  ThreeFingerSlideEnabled: '0 nothing · 1 switch apps and show desktop · 2 switch desktops and show desktop · 3 change audio and volume',
  FourFingerSlideEnabled: '0 nothing · 1 switch apps and show desktop · 2 switch desktops and show desktop · 3 change audio and volume',
  ThreeFingerTapEnabled: '0 nothing · 1 open search · 2 notification center · 3 play/pause · 4 middle click',
  FourFingerTapEnabled: '0 nothing · 1 open search · 2 notification center · 3 play/pause · 4 middle click',
  TwoFingerTapEnabled: '0 off · 1 on (right click)',
  TapsEnabled: '0 off · 1 on (tap to click)',
  PanEnabled: '0 off · 1 on (two-finger scroll)',
  ZoomEnabled: '0 off · 1 on (pinch to zoom)',
  ScrollDirection: '0 down motion scrolls down · 4294967295 down motion scrolls up',
};

/** Touchpad parameters (SPI_SETTOUCHPADPARAMETERS) DEX may set. */
export const TOUCHPAD_FIELDS = ['touchpadEnabled', 'tapEnabled', 'tapAndDragEnabled', 'twoFingerTapEnabled', 'rightClickZoneEnabled', 'panEnabled', 'zoomEnabled', 'scrollDirectionReversed', 'allowActiveWhenMousePresent', 'cursorSpeed', 'sensitivity'];

export const ACTIONS = {
  dns_flush: { tier: 2, admin: false, title: () => 'Clear the DNS cache', check: () => true },
  wifi_reconnect: { tier: 2, admin: false, title: (a) => `Reconnect Wi-Fi${a.profile ? ` to ${a.profile}` : ''}`, check: (a) => a.profile === undefined || (str(a.profile, 80) && NAME.test(a.profile)) },
  explorer_restart: { tier: 2, admin: false, title: () => 'Restart Windows Explorer (the taskbar blinks)', check: () => true },
  gesture_set: { tier: 2, admin: false, title: (a) => `Set touchpad ${a.key} to ${a.value}`, check: (a) => Object.hasOwn(GESTURE_KEYS, a.key) && Number.isInteger(a.value) && a.value >= 0 && a.value <= 4294967295 },
  touchpad_set: { tier: 2, admin: false, title: (a) => `Set touchpad ${a.field} to ${a.value}`, check: (a) => TOUCHPAD_FIELDS.includes(a.field) && (typeof a.value === 'boolean' || (Number.isInteger(a.value) && a.value >= 0 && a.value <= 20)) },

  ip_renew: { tier: 2, admin: true, title: (a) => `Renew the IP address of ${a.adapter ?? 'every adapter'}`, check: (a) => a.adapter === undefined || NAME.test(a.adapter) },
  adapter_restart: { tier: 2, admin: true, title: (a) => `Restart the network adapter ${a.name}`, check: (a) => str(a.name, 80) && NAME.test(a.name) },
  dns_set: {
    tier: 2, admin: true,
    title: (a) => `Set ${a.adapter}'s DNS to ${a.servers === 'dhcp' ? 'automatic' : a.servers.join(', ')}`,
    check: (a) => str(a.adapter, 80) && NAME.test(a.adapter) && (a.servers === 'dhcp' || (Array.isArray(a.servers) && a.servers.length >= 1 && a.servers.length <= 4 && a.servers.every((s) => IPV4.test(s)))),
  },
  device_restart: { tier: 2, admin: true, title: (a) => `Restart the device ${a.instanceId}`, check: (a) => INSTANCE.test(a.instanceId ?? '') },
  device_enable: { tier: 2, admin: true, title: (a) => `Turn on the device ${a.instanceId}`, check: (a) => INSTANCE.test(a.instanceId ?? '') },
  service_restart: { tier: 2, admin: true, title: (a) => `Restart the ${a.name} service`, check: (a) => str(a.name, 80) && /^[\w.-]+$/.test(a.name) },
  device_disable: { tier: 3, admin: true, title: (a) => `Turn off the device ${a.instanceId}`, check: (a) => INSTANCE.test(a.instanceId ?? '') },
  winsock_reset: { tier: 3, admin: true, title: () => 'Reset Winsock (needs a restart)', check: () => true },
  ip_stack_reset: { tier: 3, admin: true, title: () => 'Reset the TCP/IP stack (needs a restart)', check: () => true },
  restore_point: { tier: 3, admin: true, title: (a) => `Make a restore point: ${a.description ?? 'DEX'}`, check: (a) => a.description === undefined || str(a.description, 100) },
  app_uninstall: { tier: 3, admin: false, title: (a) => `Uninstall ${a.wingetId}`, check: (a) => WINGET_ID.test(a.wingetId ?? '') },
};

export const ACTION_NAMES = Object.keys(ACTIONS);

/** The approval category for a change (approvals/policy.ts). */
export function categoryOf(action) {
  const a = ACTIONS[action];
  if (!a) return null;
  if (a.admin) return 'elevation';
  return a.tier >= 3 ? 'system-destructive' : 'system-change';
}
