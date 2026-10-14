---
name: injected-click-guard
description: "window_manager's show/focus injects a synthetic mouse click on Windows, which auto-approved DEX confirmation cards; guarded by requiring pointer movement"
metadata: 
  node_type: memory
  type: project
  originSessionId: 46b9c244-fb0f-4a55-af95-ba2f135b9cb6
  modified: 2026-08-25T10:03:18.769Z
---

On Windows, `window_manager`'s `show()` / `focus()` injects a synthetic mouse
event via `SendInput` to get past the foreground-activation lock. Windows
delivers it to whatever is under the pointer — including a button on the window
it just raised. In the Dex Bar this auto-approved Tier 2 confirmation cards.

Measured 2026-08-25: a task that only resizes the bar produces zero pointer
events; a task that summons it produces a real left-button down/up at the
cursor. Delivery latency varied from a few ms to over 1200 ms.

**Why:** no timeout can gate it — short thresholds leak, long ones make real
approvals feel dead. The reliable discriminator is movement: the injected click
arrives at a cursor that has not moved, while a person must move onto a button
to press it.

**How to apply:** `ui/dex-bar/lib/core/window_activity.dart` holds the guard.
Any consequential control must check `WindowActivity.safeToAccept` (settle delay
AND pointer moved since last activation), re-evaluated continuously, never
latched. Call `WindowActivity.mark()` on every show/focus/move/resize —
including programmatic `setSize`/`center`, which window_manager does NOT report
through `onWindowResize`. Regression tests live in
`ui/dex-bar/test/confirmation_card_test.dart`.

Related: [[project-overview]]
