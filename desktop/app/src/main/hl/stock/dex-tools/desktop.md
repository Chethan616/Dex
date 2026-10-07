# Windows apps, media and the PC — `mcp__windows__*`

The user is using this PC while you work. These tools work **in the
background**: they never bring a window to the front, move the pointer, or
type into whatever the user is typing in (all but `input_act`, which borrows
them politely — see below). Anything else that does — `SendKeys`,
`SendInput`, pyautogui, clicking at coordinates, starting a GUI app from your
shell — interrupts them. Don't.

## The loop

1. `windows_list` — what's open (hwnd, title, process, on screen or not).
2. `window_find` (by name, role, automation id) or `window_tree` — the
   window's controls, each with a handle like `e17`, the patterns it supports
   (`pat`: invoke, value, toggle, select, expand, scroll) and its state (`st`).
3. Act on a handle: `ui_invoke` (press), `ui_set_text`, `ui_toggle`,
   `ui_select`, `ui_expand`, `ui_scroll`.
4. Check it worked: read back (`ui_set_text` returns `readBack`), or
   `window_find` again. Handles stay the same across reads; after anything
   that changes the UI, read again rather than guessing.
5. `ui_wait` when something loads; `window_capture` when you need to see it
   (one window, even off-screen; `annotate:true` labels the handles).

## Opening apps

`app_launch` opens an app **parked just off-screen** — running normally (not
minimized, so it keeps working) and not in the user's way. Use the
`launchId` it returns as `{opened:"L1"}`. App ids come from
`system_info {topic:"apps"}` (its `startMenu` list).

`show:true`, `window_manage unpark` and `open_settings` put a window on the
user's screen. Only when they asked to see it, or as your very last step.

## When only the real mouse will do

Some controls ignore accessibility (`ui_invoke` says `needs_input`), and some
apps (games, canvas editors) have none. Then `input_act` borrows the user's
mouse and keyboard for a moment. It waits for a pause in their typing, brings
the window up, shows a glow round the screen, runs your steps, and puts their
window and pointer back. Rules:

1. Try every background route first (another control, the app's menu, a
   setting, a URI). `input_act` is the last resort, not a shortcut.
2. Batch the whole job — every click, key and bit of text — into one call.
   Aim clicks at handles (`{click:{target:"e17"}}`); use `{x, y}` only from a
   fresh `window_capture` of that window.
3. `stopped: "user_took_over"` means they moved the mouse or typed. Don't try
   again straight away: wait, or ask if they'd like you to carry on.
4. Check the result afterwards (`window_find`, `window_capture`).

## Playing music and video

`media` controls whatever is playing — Spotify, a browser, any player — with
no window: `status`, `play`, `pause`, `next`, `previous`, `shuffle`,
`repeat`. Use the app's own window (parked) only to choose *what* plays, then
`media` to play and shuffle, and `media status` to confirm.

## Checking the PC

`system_info` reads without changing anything: `network`, `wifi`,
`wlan_events` (drops per hour and why), `devices`, `driver`, `touchpad`
(precision touchpad settings and each gesture), `apps`, `events`. Diagnose
with these — not by opening Settings. End with a short report: what you
found, what you'd change, and how to undo it.

## Changing the PC

`system_change` makes one typed change from a fixed list (its description
has the list) — never a free command. Rules:

1. **Diagnose first** with `system_info`. Say what you found.
2. **Cheapest fix first**: flush DNS before resetting the network stack;
   restart a device before reinstalling its driver.
3. Give `reason` in plain words — the user may see it on an approval card.
4. Every change is journaled (`entry` in the result). `undo` reverses the
   last one that can be (DNS servers, touchpad settings, a device on/off).
5. Admin changes go through DEX's admin helper. If it says
   `elevation_not_set_up`, tell the user how to set it up (Settings › Agent
   approval › Admin changes) and what you would change.
6. Things that need a restart (`winsock_reset`, `ip_stack_reset`): say so,
   and never restart the PC yourself.

End with a short fix report: what you found, what you changed (with the
journal entries), how to undo it.

## Recipes

**"Play my <playlist> on Spotify, shuffled"**
1. `media status`: is Spotify already a session?
2. A playlist link → `app_launch {uri:"spotify:playlist:<id>"}` (the id is
   the part after `/playlist/` in an open.spotify.com link). A name →
   `app_launch` Spotify (app id from `system_info apps`), then in its parked
   window: `window_find` the search box, `ui_set_text`, `ui_wait` for
   results, `ui_invoke` the playlist.
3. `media shuffle` (value true), then `media play`.
4. `media status` — playing, shuffle on — and tell the user in one line.

**"My Wi-Fi keeps dropping / is slow"**
1. `system_info wifi` (signal, band, rates), `network` (IP, DNS, gateway,
   internet), `wlan_events` (drops per hour and why), `driver` for the
   adapter (age).
2. Read it: weak signal → move closer / 5 GHz; DNS fails but internet works
   → `dns_flush`, then `dns_set` to 1.1.1.1 (admin); APIPA (169.254.x.x) →
   `ip_renew` (admin); frequent drops with an old driver → tell the user
   where to update it; repeated failures → `adapter_restart` (admin), and
   only then `winsock_reset` (needs a restart).
3. Check again after each change; stop when it's fixed.

**"My touchpad works but gestures don't"**
1. `system_info touchpad`: is it a precision touchpad? Is it enabled and
   active (a mouse plugged in can turn it off)? What is each gesture set to
   (`gestureSettings`)? Any vendor utility running?
2. A gesture set to 0 (nothing) → `gesture_set` it (1 for three-finger
   swipes) and `explorer_restart` so it takes effect.
3. Settings look right → `explorer_restart` (gesture handling lives there);
   still nothing → `device_restart` the touchpad's instance id (admin).
   A driver reinstall is never your call — tell the user.

## When a tool says no

| `error` | What it means | What to do |
|---|---|---|
| `needs_input` | That control only works with the real mouse | Try another route (a menu item, another control); otherwise `input_act` |
| `secret_field` | A password box | Ask the user to type it |
| `held` | The user paused you, or took that window | Wait; don't work around it |
| `denied` | The user said no | Ask what they'd like instead |
| `refused` | An app DEX never drives (password managers, Windows Security, terminals, other AI agents, DEX itself) | Tell the user what you needed |
| `stale_ref` | That handle is gone | `window_find` / `window_tree` again |
| `ambiguous_window` / `ambiguous_element` | More than one match | Pick by `hwnd` / handle from `extra.candidates` |
| `elevated_window` | It runs as administrator | Tell the user |
| `provider_timeout` | The app didn't answer | Wait a moment, try once more |
| `elevation_not_set_up` | Admin changes aren't set up on this PC | Tell the user: Settings › Agent approval › Admin changes |
| `cant_watch` | `input_act` couldn't watch for the user's input, so it didn't borrow it | Tell the user what you needed to press |

`input_act` also reports, without an error: `reason: "user_busy"` (the
user didn't pause in time; try later), `stopped: "user_took_over"` (they
moved or typed; don't fight them), `stopped: "secret_field"` (a password
box; ask them to type it), `stopped: "covered"` (another window was over that
point, so it didn't click) and `stopped: "lost_focus"` (the app lost the
front before typing).

If a result has `focus.incident`, you just interrupted the user (something
came to the front, or the pointer moved). Say sorry in one line and don't do
that the same way again.
