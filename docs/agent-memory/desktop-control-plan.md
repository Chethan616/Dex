---
name: desktop-control-plan
description: "DEX drives Windows apps and the OS in the background (mcp-servers/windows); phases 1, 2, 4 and most of 3 built; owner's decisions answered; what's left"
metadata:
  node_type: memory
  type: project
  originSessionId: baacd51d-de97-451d-b014-856abd9e3f87
  modified: 2026-10-07T04:10:49.280Z
---

On 2026-10-06 the owner asked for "Jarvis"-style autonomy: multi-step app tasks (e.g. a Spotify playlist plus shuffle), Settings and Wi-Fi troubleshooting, touchpad-gesture fixes, and both destructive and normal OS tasks. **The agent must never block the user or take focus while they use the PC.** The design is in `docs/desktop-control/PLAN.md`; the owner's answers are in its §6.

**Owner decisions (2026-10-06):**
- The approval setting rules: Full access is silent, including admin changes. Admin changes go through a helper that is set up once with one UAC prompt.
- Borrowed input: take the mouse and keyboard at once, with no card, but let go the instant the user moves.

**Built (as of 2026-10-07, commit 3259997b, pushed to unify and main):**
- **Phase 1:** UIA with AutoSetFocus off, apps parked off-screen, captures, media, `system_info`.
- **Phase 2:** `system_change` with 17 allowlisted actions, the elevated helper (scheduled task `\DEX\Elevated`), and the undo journal.
- **Phase 4:** `input_act`, borrowed input. It uses SendInput marked with dwExtraInfo `0x44455821`, LL hooks that abort on unmarked input, an edge glow, and guards for password, covered and lost-focus cases, then restores the window, the foreground and the cursor.
- All of it was live-tested against `desktop/app/scripts/desk-fixture.ps1`.

**Testing gotchas:**
- A zero-distance mouse move never reaches LL hooks; simulate the user with a ±1 px move.
- Screenshot scripts must be DPI-aware, or they capture only the top-left part of the screen.
- SetWindowPlacement pulls ANY wholly off-screen placement back onto the screen edge (documented; measured 2026-10-14). Park = SetWindowPos off-screen; if the window is in front, SW_MINIMIZE (not SW_SHOWMINNOACTIVE, which keeps it in front), wait ~120 ms, then SW_SHOWNOACTIVATE. Fixed in f6e4f15f.
- PrintWindow draws a DPI-unaware window at its logical size: capture into a bitmap of the size GetWindowRect gives under the window's own DPI context (DpiRatio in DexDesk.cs).

**Phase 3 (2026-10-14, f6e4f15f):** Desk tab (live frames only while watched), Show me / Hand back (host/window.ps1 spawned by main for foreground rights), plain-words chat labels, change rows with Undo (server `--undo`). Tier/onceOnly approvals + phone tier text were in progress — see the RESUME HERE block at the top of TO_BE_DONE.md.

**2026-10-14 later:** Settings › Desktop control app pickers search every installed app (`installedApps.ts`, `1505cb6b`). Owner's next asks for this area: real troubleshooting coverage (touchpad, gestures, missing drivers, laggy Search/Explorer, slow apps like WhatsApp) — design in TO_BE_DONE RESUME block, third batch item 4.

**Left:**
- The owner's acceptance tasks: Spotify (not installed on the PC), Wi-Fi, touchpad.
- The elevated helper running for real; it needs the owner's UAC click in Settings › Agent approval › Admin changes.
- Settings › Desktop control; phone Undo needs an `undo_change` command type, which the Firestore rules allowlist (deploy needs the owner's OK).

**How to apply:**
- Live tests that open windows only when the PC has been idle for more than 2 minutes (check `GetLastInputInfo`).
- Never trigger UAC yourself.

Related: [[unify-workspace-plan]], [[injected-click-guard]].
