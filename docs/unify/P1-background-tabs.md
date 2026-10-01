# P1 — Tabs off your screen: the stage

**Problem.** A web view that isn't in any window has nowhere to draw, so
Chromium never paints it. DEX removed the view of every tab you weren't looking
at from its window: a background tab, the tab you switched away from, every
task you weren't viewing, and all of them while DEX sat in the tray. For those,
`Page.captureScreenshot` **hangs**. The page also runs as a hidden tab (no
animation frames, so lazy-loading and rAF-driven UIs stall). Clicks still land,
so the agent could act but couldn't see.

That was true before unify for a task run from the phone with DEX closed.
`dex-tab new` (background tabs) would have hit it on every use.

## Measurements (Electron 41.2.1, Windows 11, 2026-09-30)

Page screenshot via CDP (`Page.captureScreenshot`), 3–5 tries each, 3–4 s timeout:

| Where the view is | Screenshot | rAF/s | Notes |
|---|---|---|---|
| On screen | ok, 120–350 ms | 165 | |
| Removed from the window (DEX until now) | **timeout, every time** | 1 | also with emulation on, `fromSurface:false`, `captureBeyondViewport` |
| Never added to any window | **timeout**; lays out **0×0** | 1 | |
| In the window, hidden (`setVisible(false)`) | ok 250 ms… | 1 | …then **timeouts** once the window is occluded |
| `capturePage({stayHidden})` of a removed view | "display surface not available" | — | Needs a view that has been shown once |
| **On the stage, hidden; shown while the agent uses it** | **ok, fresh, 95–140 ms** | 1 idle / 165 busy | 11/11 live e2e below |

Occlusion matters: Windows' native occlusion tracking marks an off-screen or
covered window as hidden, and then even views that were shown before stop
producing frames. With `CalculateNativeWinOcclusion` disabled, an off-screen
window counts as visible and its hidden views stay capturable.

Freshness (the page changes colour, then capture): a single `capturePage` of a
hidden view returned the **previous** frame 3–7 times in 10. That's why DEX
doesn't serve screenshots of sleeping tabs from `capturePage`. It shows the
tab on the stage, waits two frames (≤ 200 ms) and lets CDP capture as usual:
10/10 fresh, and every CDP option (clip, `captureBeyondViewport`, webp) keeps
working.

## Design

- `src/main/workspace/stage.ts` provides the stage, a `BaseWindow`:
  - it sits at (−32000, −32000); Windows clamps it to about −26000;
  - it's shown inactive, never focusable, and has no taskbar button;
  - `type:'toolbar'` keeps it out of Alt+Tab;
  - being a `BaseWindow`, it isn't in `BrowserWindow.getAllWindows()`, so DEX's
    "is any window open?" checks don't see it;
  - it exists on Windows only (macOS keeps windows on screen), and
    `DEX_STAGE=0` turns it off.
- `BrowserPool` gives every tab a place: `screen` (DEX's window), `stage`, or
  `none` (no stage).
  - A new tab is born on the stage at the pane's size. It is laid out while
    shown, then hidden, because a view hidden before its first layout stays 0×0.
  - Switching tabs, detaching a task, a hub menu (`temporarilyDetachAll`), and
    DEX going to the tray or minimizing all park the front tab on the stage.
    Coming back puts it on screen again.
- The broker's `beforeCommand` calls `browserPool.noteAgentUse(wc)`.
  - A parked tab the agent touches is shown on the stage and goes back to
    sleep 6 s after its last command.
  - If a screenshot is what woke it, the hook waits for a frame first.
- `index.ts` disables `CalculateNativeWinOcclusion` on Windows. The cost: DEX's
  own window keeps drawing its animations while another app covers it.
  Hidden views still sleep.

## Live e2e (real harness REPL → broker → BrowserPool → stage)

`$TEMP/broker-e2e/stage-e2e.cjs`, 11/11:

- the stage isn't one of DEX's windows;
- both tabs are reachable through the broker;
- a background tab lays out at the pane's size (1000×700);
- a screenshot of a tab that was never on screen: fresh, 115 ms;
- again: fresh, 94 ms;
- after the tab went back to sleep, the next screenshot wakes it: fresh, 114 ms;
- `document.visibilityState` is `visible` while the agent uses it;
- a click in a background tab lands;
- the tab you switched away from: fresh, 114 ms;
- with DEX in the tray, the task's page: fresh, 121 ms;
- back on screen afterwards: fresh, 119 ms.
