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
`launchId` it returns as `{opened:"L1"}`. Give it an exe path, a program
name (`notepad.exe`), or an app id from `system_info {topic:"apps"}` (its
`startMenu` list); a display name like "Calculator" answers `not_found`.

Every app works this way, Store apps included. If one jumps to the front by
itself — Store apps do as they start, some apps do when a button is pressed —
DEX puts it back off-screen and hands the user their window back; you don't
need to do anything. Dialogs the app opens (Save as, "Are you sure?") are
parked with it: `windows_list` shows them, `openedByDex: true`.

`show:true`, `window_manage unpark` and `open_settings` put a window on the
user's screen. Only when they asked to see it, or as your very last step.

The user watches the window you work in from DEX's **Desk** tab — a live
mirror with a box on the control you act on — so there's no need to bring a
window forward to show them. From there they can **Show me** (the window
comes onto their screen and becomes theirs: your calls on it answer `held`)
and **Hand back** (it's yours again, parked off-screen). While a window is
theirs, leave it alone; ask if you need it.

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
(precision touchpad settings and each gesture), `apps`, `events`,
`processes` (what's using the CPU and memory right now, per app),
`startup` (what starts with Windows, on or off), `disk` (free space and
disk health), `search` (Windows Search's service, index and Explorer's
thumbnail cache) and `app {name}` (one app: version, Store package, data
size, running or not). Diagnose with these — not by opening Settings. End
with a short report: what you found, what you'd change, and how to undo it.

## Changing the PC

`system_change` makes one typed change from a fixed list (its description
has the list) — never a free command. Rules:

1. **Diagnose first** with `system_info`. Say what you found.
2. **Cheapest fix first**: flush DNS before resetting the network stack;
   restart a device before reinstalling its driver.
3. Give `reason` in plain words — the user may see it on an approval card.
4. Every change is journaled (`entry` in the result). `undo` reverses the
   last one that can be (DNS servers, touchpad settings, a device on/off,
   a startup app on/off).
5. Admin changes go through DEX's admin helper. If it says
   `elevation_not_set_up`, tell the user how to set it up (Settings › Agent
   approval › Admin changes) and what you would change.
6. Things that need a restart (`winsock_reset`, `ip_stack_reset`): say so,
   and never restart the PC yourself.

End with a short fix report: what you found, what you changed, how to undo
it. DEX already lists each change under your reply with its own **Undo**
button (and in the Desk tab), so say in words what each one did and why —
don't paste journal ids.

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

**"My touchpad isn't working"** (the pointer doesn't move at all)
1. `system_info touchpad`: `parameters.touchpadEnabled` (Windows' own
   switch), `allowActiveWhenMousePresent` (off + a mouse plugged in = the
   touchpad turns itself off), `devices` (is the touchpad there, and is its
   status OK?), `vendorUtilities`.
2. Switched off → `touchpad_set {field:"touchpadEnabled", value:true}`.
   Off because a mouse is plugged in → say so, and offer
   `touchpad_set allowActiveWhenMousePresent true`.
3. The device shows an error or is missing → `system_info devices` (no
   class: every device with a problem) and `events {log:"pnp"}`; a
   disabled one → `device_enable`; a failing one → `device_restart` (both
   admin); not listed at all → `device_scan` (admin). Still nothing →
   the missing-drivers recipe below.
4. Many laptops also have a touchpad key (Fn + F-key) that Windows can't
   see. If everything above looks right, tell the user to try it.

**"My touchpad works but gestures don't"**
1. `system_info touchpad`: is it a precision touchpad? Is it enabled and
   active (a mouse plugged in can turn it off)? What is each gesture set to
   (`gestureSettings`)? Any vendor utility running?
2. A gesture set to 0 (nothing) → `gesture_set` it (1 for three-finger
   swipes) and `explorer_restart` so it takes effect.
3. Settings look right → `explorer_restart` (gesture handling lives there);
   still nothing → `device_restart` the touchpad's instance id (admin).
   No `precisionEnabled` and a vendor utility (Synaptics, ELAN) → its
   gestures are set in the vendor's own app: say which. A driver
   reinstall is never your call — tell the user.

**"I have missing drivers" / "this device doesn't work"**
1. `system_info devices` (no class): every device with a problem, with its
   `problem` code. `driver {instanceId}` for the ones that matter (age,
   provider).
2. `device_scan` (admin): Windows looks again and often installs the
   driver itself. Then `system_info devices` again: is the list shorter?
3. Still missing → open Windows Update's optional updates, where vendors
   ship drivers: `open_settings {page:"windowsupdate-optionalupdates"}`
   as the last step, and tell the user which device to tick. Name the
   device and, if you know it, the vendor's support page (as a button).
   Never download drivers from the web yourself.

**"Windows Search / File Explorer is slow or laggy"**
1. `system_info search`: is the service running? Index `state` (a
   `full_crawl` or a big `waiting` count means it's still indexing: that's
   the lag, and it ends by itself), `pausedBecause`, `indexerMemoryMB`,
   `explorerCache.sizeMB`.
2. `system_info processes`: is SearchIndexer, explorer or something else
   eating the CPU or memory? `disk`: a nearly full system drive (under
   ~10 % free) makes everything slow — say so, it's the real fix.
3. Fixes, cheapest first, checking after each:
   `explorer_restart` → `explorer_cache_clear` (a huge thumbnail cache, or
   blank or wrong icons) → `search_reindex` (admin; only when search misses
   files or the indexer is stuck — not while it's simply still crawling).
   Tell the user search finds fewer files until the rebuild finishes.

**"<app> takes forever to load" (e.g. WhatsApp)**
1. `system_info app {name}`: Store or desktop app, version, `dataMB`, is
   it already running (and how much memory)?
2. `processes` (is something else hogging the PC?), `disk` (free space),
   `network` (WhatsApp, Teams and the like wait on the network at start),
   `startup` (dozens of apps starting with Windows slow every start-up:
   offer to switch off the ones the user doesn't need, with
   `startup_disable`, naming each).
3. A huge `dataMB` (gigabytes of cache), or nothing else explains it →
   `app_reset {package}` as the **last resort**: ask first with a `dex-ui`
   choice (see ui.md, "Fixing the PC"), saying plainly that it clears the
   app's data and signs the user out (WhatsApp: they link the
   phone again with the QR code; chats come back from the phone). Never
   reset without that answer, whatever the approval mode.

**"My PC is slow" / "fix my PC" / anything vague**
Triage before touching anything: `processes`, `disk`, `startup`,
`devices` (no class), `events {log:"system", hours:24}`. Report the one or
two things that stand out, with the fix you'd make for each, and make the
cheap reversible ones (a startup app off, Explorer restart, DNS flush).
If nothing stands out, say so honestly rather than changing things to look
busy.

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
| `not_found` | No such app, package or startup entry | Read `system_info` again and use a name from it |
| `unsupported` | This Windows can't do that from a script | Tell the user the Settings path in the hint |
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
