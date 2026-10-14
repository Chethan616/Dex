---
name: cdp-broker
description: DEX has no open remote-debugging port since f675a5f4 — agents use a token CDP broker; dev/testing must opt in with AGB_CDP_PORT
metadata:
  node_type: memory
  type: project
  originSessionId: baacd51d-de97-451d-b014-856abd9e3f87
  modified: 2026-09-30T13:15:38.449Z
---

Since commit `f675a5f4` (2026-09-30, `feat/low-latency`), DEX **does not open `--remote-debugging-port`** by default.

**Why it changed:** the port exposed every DEX window (Hub, Logs, Pill, approval cards) to any local process, including the agent's own shell.

**How agents reach their tab now:** through `main/cdpBroker.ts`.
- It's a random loopback port.
- There's one secret token URL per task, passed as `BU_CDP_WS`.
- A token only reaches that task's `BrowserPool` view.
- `Browser.*`, `Target.createTarget`, foreign `attachToTarget` and `Page.close` are refused.

**Debugger access:** any code that needs `webContents.debugger` must use `leaseDebugger()` / `withDebugger()` from `main/cdpLease.ts`, never raw attach/detach, or it can cut the broker off.

**How to apply:**
- For UI testing through CDP (the `$TEMP/cdp` helper scripts), start dev with `set AGB_CDP_PORT=9222&& npx electron-forge start`. Settings then warns that the port is open. Restart without it afterwards.
- The e2e launcher passes `--remote-debugging-port=0`, which still works.
- `browser-harness-js` must keep sending `X-BU-CDP-WS` / `X-BU-Target-Id` on `/eval`, so long-lived REPLs follow a new link after a DEX restart.

Related: [[unify-workspace-plan]].
