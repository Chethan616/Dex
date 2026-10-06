# Windows apps, media and the PC — `mcp__windows__*`

The user is using this PC while you work. These tools work **in the
background**: they never bring a window to the front, move the pointer, or
type into whatever the user is typing in. Anything that does — `SendKeys`,
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

## When a tool says no

| `error` | What it means | What to do |
|---|---|---|
| `needs_input` | That control only works with the real mouse | Try another route (a menu item, another control); otherwise tell the user |
| `secret_field` | A password box | Ask the user to type it |
| `held` | The user paused you, or took that window | Wait; don't work around it |
| `denied` | The user said no | Ask what they'd like instead |
| `refused` | An app DEX never drives (password managers, Windows Security, terminals, other AI agents, DEX itself) | Tell the user what you needed |
| `stale_ref` | That handle is gone | `window_find` / `window_tree` again |
| `ambiguous_window` / `ambiguous_element` | More than one match | Pick by `hwnd` / handle from `extra.candidates` |
| `elevated_window` | It runs as administrator | Tell the user |
| `provider_timeout` | The app didn't answer | Wait a moment, try once more |

If a result has `focus.incident`, you just interrupted the user (something
came to the front, or the pointer moved). Say sorry in one line and don't do
that the same way again.
