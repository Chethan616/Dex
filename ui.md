# Dex V3 — Interface Specification

> See also: [architecture.md](./architecture.md) §14 (Mission Control & Dex Bar), §8 (Event Bus), [SAFETY.md](./SAFETY.md) §2 (confirmation tiers).

The UI is a client, not part of the core. It subscribes to the Event Bus and calls a small action API — it holds no automation logic of its own. Everything it shows comes from events the core already emits; everything it does (approve, pause, cancel) is a call the core already exposes. This keeps the whole of architecture.md true regardless of what the interface looks like.

---

## 1. Framework

**Desktop: Flutter (Windows, macOS, Linux from one codebase).**
Flutter renders every pixel itself rather than theming native controls, which is exactly what a distinctive, animation-heavy overlay wants — the command bar's growth, the step-by-step reveal, and the expand transition are the core of the feel, and Flutter makes those first-class instead of a fight. One codebase covers all three desktop platforms with an identical look.

The one honest rough edge: a translucent overlay with true native Windows blur (acrylic/mica) behind it isn't first-class in Flutter desktop. Handle it with a thin platform channel that calls the OS blur API where available, and fall back to a solid frosted-dark surface where it isn't — the design below is built to look right either way, so blur is an enhancement, not a dependency.

**Mobile: native (SwiftUI on iOS, Jetpack Compose on Android).**
Mobile isn't a second copy of the desktop app — it's a thin channel client (send a command, watch the steps, approve a card), so native is lighter and better-behaved than sharing the Flutter tree. On Android it also lines up with the Device Mesh node, which is already Kotlin/Accessibility-Service (architecture.md §15) — the phone app and the mesh node share a language and can share plumbing.

**Connection to the core.** The UI process talks to the core over a loopback-only WebSocket — the same local endpoint Mission Control uses in architecture.md §14, never network-exposed. Two directions: it subscribes to Event Bus lifecycle events (read), and it calls the action API (`approve`, `reject`, `pause`, `resume`, `cancel`). The renderer is read-only by default; approvals carry the request id and version so a stale card can't approve a newer step (SAFETY.md §2).

---

## 2. Surface one — the command bar

The default and, most days, the only surface. Summoned by global hotkey (`Alt+Space` by default, per config.yaml), dismissed with `Esc`. It is the same input box regardless of where the task ends up routed — the owner never picks an agent.

**Rest.** A single centered row: a leading mark, one text input, nothing else. No chrome, no dashboard. It floats over whatever's on screen and takes focus immediately.

**Running.** The moment a task starts, the bar grows *downward* to stream thinking steps — `thinking / routing / planning / selecting / executing / retrying / done`, each with the same prefix vocabulary as every other channel (architecture.md §4). Prefixes are color-coded: accent for in-progress stages, success green for `done`, danger for a failed step. A status pill top-right shows `running`, and a slim footer exposes `cancel` and `pause`. This is the state in the mockup above.

**Waiting on you.** When a step hits a tier-1 or tier-2 action (SAFETY.md §2), the stream pauses and a confirmation card slides in inline — see §4. The bar does not proceed until the card is resolved.

**Done.** The final `done` line stays, the pill goes quiet, and the bar auto-collapses back to a single row after a short beat (or on `Esc`). Nothing to dismiss manually.

Motion is the point here — grow, reveal per step, collapse — because it's what makes "visible thinking" feel alive rather than a scrolling log. Keep every transition short and eased; never animate more than one thing at a time.

---

## 3. Surface two — mission view

The expanded surface, reached only on demand (the `expand` control, or a second hotkey). This is the telemetry dashboard and the live agent view merged into one, per architecture.md §14 — not a separate app.

Contents:

- **Task header** — the original command, current status, elapsed time.
- **Plan graph** — the ExecutionPlan DAG (architecture.md §5), nodes lighting up as they complete, so a cross-surface task's structure is legible at a glance.
- **Live step stream** — the same thinking steps as the bar, with room to breathe.
- **Evidence** — before/after screenshots and the verification result for each step (architecture.md §9), so a `retrying` or a failure is inspectable, not mysterious.
- **Active agents / devices** — what's running where; once the Device Mesh ships (§15), this is where a second laptop or phone node shows up.
- **History** — past tasks, searchable, backed by Telemetry.

Same read-only rule: this view shows and requests; it never reaches into core internals.

---

## 4. Confirmation cards

The visible half of the tier model (SAFETY.md §2). When the core emits a confirmation-required event, a card appears — inline in the bar, or in the mission view if that's open.

A card states, plainly: the exact action, where it lands (which app, file, account, or device), and the data involved — never a vague "proceed?". Its controls map to the tiers:

- `Approve once` — this one action only.
- `Approve step` — pre-approval for the rest of this step (tier-3 actions only; tier-2 never offers this and re-asks every time).
- `Reject` — skip it, keep the task going if it can.
- `Cancel mission` — stop the whole task.

Tier-1 (hand-off) cards don't offer an approve at all — they tell the owner to do it themselves and give a `done, continue` once they have. Every decision is bound to the request id and version it was shown for; a card for a step that has since changed is dead, and says so, rather than silently approving the new version.

---

## 5. Visual language

Aim: distinctive and calm, not a generic dark IDE and not chrome-heavy. It sits *over* the owner's work, so it earns its space by being quiet at rest and legible in motion.

- **Layout** — one column, generous padding, hairline separators between the input, the step stream, and the footer. Nothing is boxed that doesn't need to be.
- **Type** — a clean sans for the input and chrome; a monospace for the step stream, because the prefixes are meant to read as a machine narrating itself, and the fixed column makes them scannable.
- **Color** — a near-neutral surface carries almost everything; one accent color marks in-progress stages and the leading mark, success green marks `done`, danger red marks a failed step and destructive confirmations. That's the whole palette — meaning, not decoration.
- **Motion** — grow, per-step reveal, collapse, and the expand transition. Short, eased, one at a time. This is the single biggest lever on whether the thing feels alive or clunky, so it's worth more polish than anything else here.
- **Dark and light** — both, fully. The overlay reads over a bright desktop and a dark one; nothing is hardcoded to one mode.

---

## 6. Build notes

- **Global hotkey** — a native global shortcut, not an in-window key listener (an in-window listener only fires when the window already has focus, which is useless for a summon-from-anywhere bar). Register an explicit cleanup on exit so the shortcut releases cleanly.
- **Borderless translucent window** — a frameless, always-on-top, transparent window that takes focus on summon and gives it back on dismiss.
- **System tray** — a tray icon for status-at-rest and a way back in if the hotkey's ever unavailable.
- **Loopback client** — a single WebSocket to the core; subscribe on connect, reconnect quietly if the core restarts, and never assume the socket is authenticated just because it's local — the core still gates every action.
- Keep the UI process crash-isolated from the core: if the interface dies, tasks keep running and the next summon reconnects to them mid-flight. The interface is a window onto the core, never a dependency of it.
