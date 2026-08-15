# Dex V3 — System Architecture

> See also: [plan.md](./plan.md) for the build sequence and project structure, [SAFETY.md](./SAFETY.md) for the permissions and confirmation model every backend follows.

---

## 1. Overview

Dex V3 is a multi-agentic automation framework for Windows, built around a single owner. It accepts natural-language commands from any channel, plans them, routes them to the right specialist, executes, verifies the result actually happened, and streams progress back to wherever the command came from.

**What changed from the V2 draft:**

- **Brain and Orchestrator are separate.** The Brain plans. It never executes anything itself.
- **Agents are registered, not hardcoded.** A router that matches capabilities can grow without a rewrite every time a new agent shows up.
- **Every agent's underlying engine is a swappable backend.** Agent-S3 powers the desktop today; nothing else in the system needs to know if that changes tomorrow.
- **One Event Bus, not N ad-hoc return values.** Every backend reports progress the same way — what makes "visible thinking steps" actually true instead of displayed for some agents and not others.
- **A tool call succeeding is not proof anything happened.** A dedicated Reliability Layer (§9) verifies, recovers, and detects when Dex is stuck in a cycle rather than making progress.
- **A path to more than one device.** Not built in V3, but designed for from day one (§15).

A request's full trip: **channel → Owner Gate → Gateway → Brain (plans) → Orchestrator (executes) → Agent Registry (resolves capability to backend) → Execution Backend → Reliability Layer (verifies) → Event Bus (streams back up) → origin channel.**

---

## 2. Design principles

1. **The Brain plans, the Orchestrator executes — never blur the two.**
2. **Every execution engine is swappable behind a stable interface.**
3. **Route on capability, never on name.**
4. **If it isn't visible, it isn't done correctly.** Every step any backend takes emits an event.
5. **A return value is a claim, not proof.** Nothing is marked complete until it's been observed and verified — see §9.
6. **Confirm proportionally to risk, owner-only, always.** Full model in [SAFETY.md](./SAFETY.md).
7. **A task always ends explicitly** — `COMPLETED`, `FAILED`, `ABORTED`, or `CANCELLED`. Never left `UNKNOWN`, stuck, or retrying forever.

---

## 3. Request lifecycle

```
╔══════════════════════════════════════════════════════════════════╗
║                       COMMUNICATION LAYER                        ║
║   WhatsApp · Telegram · Discord · Slack · CLI · Dex Bar · Flutter║
╚═════════════════════════════╦════════════════════════════════════╝
                               ║ raw message
╔═════════════════════════════▼════════════════════════════════════╗
║  OWNER GATE — sender check · @dex prefix in groups · else discard║
╚═════════════════════════════╦════════════════════════════════════╝
                               ║ approved request
╔═════════════════════════════▼════════════════════════════════════╗
║  GATEWAY — one TaskRequest format, session/entity stitching,     ║
║  relays Event Bus updates back to the origin channel             ║
╚═════════════════════════════╦════════════════════════════════════╝
                               ║ TaskRequest
╔═════════════════════════════▼════════════════════════════════════╗
║  BRAIN — plans only                                              ║
║  normalize → semantic cache → intent analysis → tier classify    ║
║  produces: ExecutionPlan (a DAG, not just a list)                ║
╚═════════════════════════════╦════════════════════════════════════╝
                               ║ ExecutionPlan (DAG)
╔═════════════════════════════▼════════════════════════════════════╗
║  ORCHESTRATOR — executes only                                    ║
║  resolves each node's capability against the Agent Registry,     ║
║  dispatches respecting dependencies, collects results             ║
╚═══════════╦════════════════════════════════════╦═════════════════╝
            ║ capability lookup                  ║ dispatch
╔═══════════▼═════════════╗          ╔═══════════▼═════════════════╗
║   AGENT REGISTRY         ║          ║   EXECUTION BACKENDS         ║
║   capability → backend   ║ ───────▶ ║   Desktop · System · Browser ║
║   map, live status       ║          ║   Workspace · (Device Mesh)  ║
╚═══════════════════════════╝         ╚═══════════╦═══════════════╝
                                                   ║ each step passes
                                                   ║ through §9 before
                                                   ║ it's marked done
                                       ╔═══════════▼═══════════════╗
                                       ║        EVENT BUS           ║
                                       ║ Started→Progress→Completed ║
                                       ║          /Failed           ║
                                       ╚═════════════════════════════╝
```

Event Bus consumers: the **Gateway** (relays to the origin channel), **Mission Control** (live dashboard, §14), and **Telemetry** (append-only log).

---

## 4. Thinking steps

Every task streams structured steps back to the originating channel in real time.

```
[thinking]   Parsing intent → composite task: email retrieval + file operation
[routing]    Intent matches capability: app.outlook, fs.write
[planning]   Step 1: Launch or focus Outlook (no dependencies)
[selecting]  Desktop backend: agent-s3 (windows.gui)
[executing]  Opening Outlook...
[executing]  Located email: "Your Amazon.in order" — attachment found
[retrying]   Attachment click did not verify, re-capturing window state
[done]       ✓ Invoice saved → Documents\Amazon_Invoice_2026-08-15.pdf
```

| Prefix | Meaning |
|---|---|
| `[thinking]` | Intent analysis, ambiguity resolution — from the Brain |
| `[routing]` | Which capability/backend was matched |
| `[planning]` | DAG decomposition before execution begins |
| `[selecting]` | Which backend or sub-tool handles this specific step |
| `[executing]` | Live execution |
| `[retrying]` | A step failed verification; the Reliability Layer is recovering |
| `[done]` | Final result, after verification passed |

This works identically regardless of *how* a backend runs internally — visibility is a property of the Event Bus, not of any one backend's implementation.

---

## 5. The Brain

Plans only. Never calls a backend directly.

1. **Intent normalization** — strips the `@dex` prefix, collapses whitespace, resolves typos/abbreviations.
2. **Semantic intent cache** — embedding-based fuzzy match against recently run tasks. A cache hit skips planning entirely.
3. **Intent analysis** — extracts action verbs, target surfaces, data entities, and constraints into a structured `IntentObject`.
4. **Tier classification**:
   - **Tier 1 — lightweight**: single tool call, deterministic, <5 steps.
   - **Tier 2 — standard**: multi-step, single-backend, 5–20 steps.
   - **Tier 3 — heavy**: multi-agent, cross-surface, 20+ steps or parallel work.

Output: an **ExecutionPlan** — a directed acyclic graph, not just an ordered list. Each node is a step tagged with the capability it requires and the step ids it depends on. Modeling it as a DAG rather than a flat sequence means independent steps (e.g. "download the invoice" and "check today's calendar") can run in parallel, and a dependency cycle in the plan itself is a detectable, rejectable error rather than something that only surfaces as a hang at runtime.

---

## 6. The Orchestrator

Executes only. Never plans.

- Resolves each DAG node's required capability against the Agent Registry.
- Dispatches respecting dependencies — parallel where nodes are independent, sequential where one depends on another's output.
- Every step's result passes through the **Reliability Layer** (§9) before it's considered complete.
- On a verification failure: the Reliability Layer decides whether to retry, fall back to a different backend, or send the step back to the Brain to replan — the Orchestrator itself makes no recovery decisions, it just carries them out.
- Publishes lifecycle events to the Event Bus throughout.

---

## 7. Agent Registry & capability discovery

Backends register at startup instead of being hardcoded into a router file:

```json
{
  "name": "desktop",
  "version": "1.0.0",
  "capabilities": ["windows.gui", "app.office", "app.notepad", "app.explorer"],
  "backend": "agent-s3",
  "requires_elevation": false
}
```

The Orchestrator queries by capability — `"who can do windows.gui"` — never by agent name. A representative capability taxonomy:

| Namespace | Examples |
|---|---|
| `desktop.*` | `desktop.gui`, `app.office`, `app.explorer` |
| `os.*` | `os.registry.read`, `os.registry.write.<allowlisted-key>`, `os.power`, `os.network`, `os.bluetooth`, `os.process` |
| `browser.*` | `browser.navigate`, `browser.extract`, `browser.electron` |
| `workspace.google.*` | `workspace.google.gmail`, `workspace.google.drive` |
| `workspace.microsoft.*` | `workspace.microsoft.outlook`, `workspace.microsoft.teams` |
| `workspace.slack.*` | `workspace.slack.read`, `workspace.slack.post` |
| `device.*` (mesh) | `device.phone.sms`, `device.phone.camera`, `device.laptop.gui` |

Note the registry capability is authenticated before it's ever offered to the planner — a node or plugin that hasn't proven its identity doesn't get to advertise what it can do. This applies as much to a second laptop or phone joining the Device Mesh (§15) as it does to a plugin loading locally.

This capability model is also what makes the Plugin SDK (§16) work: a new plugin registers new capabilities on load. Nothing about the Brain, Orchestrator, or router changes.

---

## 8. Event Bus & memory

**Event Bus.** Every backend emits lifecycle events regardless of its internal shape:

```json
{
  "task_id": "t_8f2a1c",
  "session_id": "s_44b",
  "type": "TaskProgress",
  "prefix": "executing",
  "backend": "desktop",
  "message": "Opening Outlook via Desktop backend...",
  "timestamp": "2026-08-15T10:22:03Z"
}
```

**Memory** is five distinct problems, not one "intent cache":

| Layer | Answers | Lifetime |
|---|---|---|
| Semantic cache | "Have I planned something like this recently?" | Rolling, task-scoped |
| Session memory | "What did we just do, two messages ago — on any channel?" | One logical session |
| Long-term memory | "What does the owner generally want?" | Durable, cross-session |
| Agent memory | Per-backend state — Agent-S3 trajectories, browser cookies, learned app profiles | Per-backend |
| Telemetry | Everything, for tuning and debugging — not for recall | Append-only log |

**Cross-channel continuity.** A task doesn't belong to a channel — it belongs to a session. When a message arrives, session memory resolves it against active sessions with an explainable, ranked score: an exact active session first, then a referenced-artifact match, then an entity match, then recent temporal proximity — each counts in favor; an expired session or a conflicting owner context counts against. A low-confidence match never silently merges two unrelated tasks — it's better to start a fresh session than guess wrong. This is what makes "continue that on my phone," or asking about "the report" three messages later on a different app, actually work.

---

## 9. Reliability Layer

This is what separates "usually works" from something worth trusting with your registry and your files. The governing rule: **a tool call returning cleanly is a claim, not proof.**

Per step, the flow is:

```
execute
  → observe (UIA state · pixel diff · OCR · VLM, as relevant — fused into one verdict)
  → verify against the policy for that action type
      verified   → evidence stored → DAG continues
      uncertain
      or failed  → recover:
                     refocus | reobserve | retry | fallback to a different
                     backend | replan from the Brain | ask the owner | abort
                   → back to observe, within a bounded attempt budget
```

**Verification policy is decided per action type in advance**, not improvised in the moment:

| Action type | Required signal | Fallback signals |
|---|---|---|
| UI click | UIA or DOM state change | Pixel diff → OCR → VLM |
| Text entry | Value match | OCR |
| File create | File exists + hash/size changed | — |
| Process start | Process present | Window present |
| Registry write | Read-back matches written value | — |

**Recovery is bounded and ordered**, never an unbounded retry: refocus (target may have lost focus) → reobserve (state may be stale) → retry → fall back to a different backend for the same step → replan from the Brain → hand off to the owner → abort. Each retry carries the previous failure's evidence forward; the same action is never blindly repeated against the same observation.

**Loop detection** fingerprints every attempt — a hash of `(step, backend, action, observation)` — in a bounded ring buffer. The same fingerprint repeating past a small limit (2, by default) is reclassified from "transient failure, keep trying" into a **cycle**: automatic abort, not a stall. This is the difference between Dex retrying a genuinely flaky click three times and Dex clicking the same wrong pixel forever.

**Evidence.** Every non-trivial step writes a content-hashed bundle: before/after screenshot, the observation signals that were captured, the action taken, and the verification result. This is what makes a failure explainable after the fact instead of a log line that just says "failed" — and it's what a `[retrying]` thinking-step is actually backed by. Secrets are never written into evidence, logs, or telemetry.

**DPI-aware coordinates.** Grounding models (§10.1) return normalized `[0, 1000]` coordinates. Converting that to an actual click needs the target window's physical bounds *and* the live DPI scale — a coordinate computed at one scale silently misses at another. This must be tested explicitly at 100%, 125%, 150%, and 200% scaling, which covers the realistic range of Windows displays. A stale screenshot (captured before the window moved, resized, or lost focus) must never result in a blind coordinate injection — the capture timestamp and the action timestamp are checked against each other before the click fires.

---

## 10. Execution backends

Internally still called "agents" in conversation, but the interface each one implements is an **Execution Backend** — today's Agent-S3 or browser-use can be replaced tomorrow without the Brain, Orchestrator, or Registry noticing.

### 10.1 Desktop backend — Agent-S3

**Foundation:** [simular-ai/Agent-S3](https://github.com/simular-ai/Agent-S/tree/s3), Apache 2.0, forked and wrapped rather than modified.

Worker + Reflection architecture: the Worker reads the screen (screenshot + accessibility tree), proposes the next action, and Reflection reviews the trajectory and corrects it before the next step. A grounding model (UI-TARS, run locally behind a small inference server) turns high-level intent into normalized coordinates. A CodeAgent sub-module already handles steps that are faster as a direct Python/PowerShell call than a GUI click.

**A note on naming and dependencies.** Some reference material describes this layer as "window2," mirroring the API shape of a similar tool bundled with Codex's Computer Use skill. To be direct: that specific runtime (`@oai/sky`) is proprietary to Codex and is not a package Dex can install or depend on. What Dex actually builds is its own thin UIA/SendInput layer, on top of Agent-S3 — the design borrows good patterns from tools like it, not the code.

**Windows ACI layer, built in-house:**

- **Discovery-then-target discipline.** Resolve the app, resolve the window, capture state *once*, batch several actions against it, then re-verify with a single follow-up capture — not a screenshot before every click.
- **Pull the accessibility tree only when the next decision needs element text or indices** — a screenshot alone is the default.
- **Stale-handle recovery.** Rehydrate a stale window handle from its last known id. Never reconstruct coordinates from memory.
- **Per-app profiles** (`app_profiles/`), pre-learned rather than rediscovered every run:
  - Office apps: prefer Alt-key ribbon sequences over clicking — ribbon accessibility elements can time out mid-refresh.
  - Canvas/creative/game-style apps: click the work surface and press Escape once or twice before firing a hotkey — shortcuts are focus- and mode-sensitive.
  - Native right-click menus: `Shift+F10` plus keyboard navigation beats hunting for the right pixel.
- Verification, DPI handling, and loop detection for this backend all run through the shared Reliability Layer (§9) — this backend doesn't reimplement its own.

Hard rules for this backend live in [SAFETY.md](./SAFETY.md) — notably, it never automates a terminal window. Registry, DNS, and power-plan changes go through §10.2 instead, always.

### 10.2 System backend — direct OS control

No screen capture. Structured calls against Windows APIs, PowerShell, `netsh`, `reg.exe`, and WMI, run through the Tool Runtime (§13) so nothing re-prompts for elevation mid-task.

**Tool set:** `registry_read/write/delete` (write scoped to an explicit allowlist — see SAFETY.md) · `power_plan_list/create/apply` · `network_dns_set/flush` · `network_wifi_list/connect/forget` · `bluetooth_device_list/pair/disconnect` · `process_list/kill/priority_set` · `service_list/start/stop/set_startup` · `audio_endpoint_list/set_default` · `gaming_optimize` (composite) · `os_optimize` (composite).

Every mutable action here captures before-state, applies, verifies the read-back, and — where the change is reversible — can roll back to the captured before-state.

### 10.3 Browser backend — pluggable

| Backend | License | Shape | Best for |
|---|---|---|---|
| **agent-browser** *(default)* | Apache 2.0 | Low-level CLI primitives (open/click/type/snapshot) that the Brain drives step-by-step. Also automates Electron apps (VS Code, Discord, Figma, Spotify). | Most tasks — one reasoning loop, true per-action visibility |
| **webbrain** *(alt)* | MIT | Browser extension acting inside the owner's real signed-in session; local-model capable; ships its own MCP server | Tasks that need the actual day-to-day browser profile |
| **browser-use** *(alt)* | MIT | Self-contained agent with its own internal decision loop (Playwright-backed), can also attach to an existing Chrome instance over CDP to reuse an already-logged-in session | Tasks fine running autonomously in a scratch or CDP-attached profile |

agent-browser is the default because its shape matches §4's visibility principle most directly — Dex's own Brain makes every click decision instead of delegating to a second independent reasoning loop with its own context.

### 10.4 Workspace backend — unified MCP runtime

One implementation, many providers:

```
Workspace backend → MCP runtime → Google Workspace / Microsoft 365 / Slack / (future: GitHub, Linear, Notion)
```

- **Google:** [taylorwilsdon/google_workspace_mcp](https://github.com/taylorwilsdon/google_workspace_mcp) (MIT).
- **Microsoft 365:** [Softeria/ms-365-mcp-server](https://github.com/Softeria/ms-365-mcp-server) (MIT), activated by preset (`mail`, `outlook`, `teams`).
- **Slack:** [korotovsky/slack-mcp-server](https://github.com/korotovsky/slack-mcp-server) (MIT) — stealth mode or OAuth mode; posting gated behind explicit config.

### 10.5 Device backend — Device Mesh

Designed in §15. Not part of core V3.

---

## 11. Communication layer

All channels are pure transport — receive, pass approved requests to the Gateway, deliver results back. No AI logic lives here.

- **WhatsApp** — [Baileys](https://github.com/WhiskeySockets/Baileys), QR-session auth, persisted at `data/whatsapp-session/`.
- **Telegram** — [grammY](https://grammy.dev/), bot token from BotFather; long tasks live-edit a single message instead of spamming new ones.
- **Discord** — [discord.js](https://discord.js.org/) v14, `MESSAGE_CONTENT` intent, status updates via message edits.
- **Slack** — dual role: a channel (DM or `@dex` mention) *and* a Workspace backend target (§10.4).
- **CLI** — local, no Owner Gate needed, ANSI-colored thinking-step prefixes.
- **Dex Bar** — a persistent, hotkey-summoned input on the desktop itself. Same request format as every other channel, just another Gateway client. The user never picks an agent — they type or speak the task, Dex routes it. See §14.

---

## 12. Owner Gate & permission tiers

Full detail and implementation in [SAFETY.md](./SAFETY.md); summary here:

1. DM/self-chat from the configured owner → allow.
2. Group/server message from the owner starting with `@dex` → allow, prefix stripped.
3. Message from the owner in a group *without* the prefix → ignored silently.
4. Message from anyone else, anywhere → ignored silently. No error, no acknowledgement.

Every backend action is additionally classified into one of four confirmation tiers (hand-off required / always confirm / confirm-once / no confirmation) rather than a single "owner only" flag. Confirmations are signed and versioned — an approval only applies to the exact step/request version that generated it, so a stale confirmation card can't be replayed against a newer, different request. Full tier table and the reasoning behind each classification: SAFETY.md §2.

---

## 13. Tool Runtime

Centralizes PowerShell, Python, registry, filesystem, and git access instead of every backend owning its own copy of this logic.

**Concretely:** a small daemon process, registered via Task Scheduler with "run with highest privileges," listens on a named pipe that only the current admin user and SYSTEM can connect to — nothing else. It starts once when Dex launches and stays up. Every System and Desktop backend call goes through this one persistent, already-privileged process, so nothing downstream re-prompts for UAC mid-task.

**Monitor, not poll.** Long-running commands spawn as a child process; a background thread blocks on that process's Windows-level exit signal (not a polling loop) and pushes the result back down the pipe the instant it's available. This is the actual fix for both "don't ask for admin every time" and "don't burn tokens waiting on a command that isn't done yet."

The pipe's access control has to be real, not assumed — see SAFETY.md §6 for the specific requirement.

---

## 14. Mission Control & Dex Bar

A single surface merging the telemetry dashboard, a live view of every agent (and, once Device Mesh ships, every device), and the Dex Bar input itself.

- **Dex Bar**: one text/voice input, always available via hotkey, identical in shape to a WhatsApp or Telegram message to Dex.
- **Live view**: every active task's thinking-step stream, subscribed directly from the Event Bus, plus confirmation cards for anything waiting on the owner (`Approve Once` / `Approve Step` / `Reject` / `Cancel Mission`).
- **History**: past tasks, searchable, backed by Telemetry.

Deliberately *not* a network-exposed admin panel — the original design explicitly avoided a web dashboard to keep the attack surface small, and that principle holds. Mission Control is local-only: the desktop overlay and, optionally, the Flutter app talking to a loopback-only endpoint. The renderer is read-only by default; it has no direct shell or daemon access, and approval actions require the request id and version, not just a click.

---

## 15. Device Mesh *(designed for, not built in V3 — see plan.md)*

The JARVIS-style extension: Dex reachable and acting from more than one device.

Three pieces don't exist yet and need to:

- **Device Registry** — an extension of the Agent Registry (§7) that registers *devices* and their capabilities. A phone node advertises `device.phone.sms`, `device.phone.camera`, `device.phone.location`; a second laptop advertises `device.laptop.gui`, `device.laptop.registry`.
- **Dex Node** — a lightweight process on every device, talking to the primary Brain through the registry. LAN-first (mDNS-style discovery) with a relay fallback for devices off the local network.
- **Capability-aware routing** — "text this to my phone" only resolves once a phone node exists and has advertised it can send SMS.

**Concretely, joining the mesh looks like:** a node opens a WebSocket to the registry and authenticates before it's trusted — `HELLO` (node id, version) → `CHALLENGE` (nonce) → `AUTH` (signed response + capability list) → `SESSION`. A node never gets to advertise capabilities to the planner before that handshake completes; an unauthenticated socket is not a source of truth. Once joined, dispatching a step to that node is a request/response over the same socket, correlated by step id. An Android node, for instance, is realistically a small Accessibility Service that opens exactly this connection and handles whatever steps arrive — sending an SMS through the platform's own SMS API is a reasonable first capability, since it's simple and it's something a laptop alone can't do. If a node disconnects mid-step, the orchestrator either resumes once it reconnects within a timeout, migrates the step to an equivalent-capability node if one exists, or fails the step explicitly — it never just hangs.

**Feasibility, honestly:**

| Device pair | Status |
|---|---|
| Laptop ↔ laptop | Straightforward — identical Dex Node software, same OS |
| Laptop ↔ Android | Real and buildable today. Accessibility-Service-based agents already exist in the open-source ecosystem that read the screen tree and act through Android's own accessibility API |
| Laptop ↔ iPhone | Meaningfully harder — no Android-Accessibility-Service equivalent on iOS. Realistic path is Apple's own UI-testing framework (WebDriverAgent), needing developer mode and a signed build, fragile since Apple can restrict it without notice. **Scope: notifications and Shortcuts-triggered actions only, not full automation.** |
| Off-LAN (any pair) | Transport priority: direct local WebSocket first, then an authenticated Tailscale/WireGuard route, then WebRTC as a last resort, then explicit failure — never fall back to an unauthenticated relay |

---

## 16. Scheduler & Workflow Engine

- **Scheduler** — cron-style and event-based triggers: every morning, every Friday, battery > 90%, USB device inserted, WiFi network changed, every startup.
- **Workflow Engine** — chains beyond a single command: `Trigger → Agent → Condition → Loop → Agent`, stored as declarative workflow definitions rather than hardcoded scripts.

---

## 17. Plugin SDK

The extension point that makes new integrations additive instead of invasive:

```
plugins/
  obs/       manifest.json · agent.ts · tools.ts
  spotify/
  blender/
  docker/
```

Each plugin's manifest declares its capabilities, each with its own confirmation tier and parameter schema, and the specific permissions it needs (e.g. `process:obs64.exe`, `network:localhost` — never blanket filesystem, shell, or network access by default). A plugin registers its capabilities into the Agent Registry (§7) on load; the Brain, Orchestrator, and router never change to support a new one. A crashing plugin is marked unhealthy, retried, and quarantined if it keeps failing — it doesn't take the rest of Dex down with it.
