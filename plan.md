# Dex V3 — Build Plan

> See also: [architecture.md](./architecture.md) for how everything works, [SAFETY.md](./SAFETY.md) for the permissions contract.

## 1. What Dex V3 is

A multi-agentic automation framework for Windows, built around a single owner. Natural language in, from any channel; a plan out; specialist backends execute it; every step is verified, not just attempted; progress streams back to wherever the request came from. Ground-up rewrite — Agent-S3 replaces the old GUI layer, MCP is the default for third-party integrations, and every execution engine sits behind a swappable interface.

---

## 2. Implementation strategy: vertical slices

The wrong way to build this is to scaffold all seventeen sections of architecture.md at once. Nothing works until everything does, and "everything" here is a lot. The right way is a sequence of slices, each one a real, working, end-to-end path — every slice after the first is built on top of a reliability loop that's already been tested, not added at the end.

```
Slice 1 — Prove the loop
  CLI → Owner Gate → Gateway → Brain → Orchestrator → ONE backend (System)
  → Reliability Layer (observe/verify/recover) → Evidence
  Exit: "set my DNS to 1.1.1.1" works, is verified, and is evidenced —
        end to end, on the ugliest possible interface (a terminal).

Slice 2 — Add the hard backend
  Desktop backend (Agent-S3 wrap) on the same reliability loop
  Exit: a GUI task (open Notepad, write, save) verifies and evidences
        exactly like the System backend did — same loop, new backend.

Slice 3 — Make it visible
  Dex Bar → Mission Control projection → approval cards
  Exit: a human can watch a task's thinking-steps live and approve/
        reject/cancel it without touching the CLI.

Slice 4 — Leave the desktop
  Browser backend (agent-browser default) + Workspace backend (start
  with one MCP provider, e.g. Google)
  Exit: "summarize today's unread email" and "find me a flight" both
        run through the same DAG/verify/evidence loop as Slices 1–2.

Slice 5 — Leave the CLI
  WhatsApp → Telegram → Discord, in that order
  Exit: the Slice 1 DNS task and the Slice 4 email task both work,
        unmodified, from a phone via WhatsApp.

Slice 6 — Remember across channels
  Session stitching → entity graph → long-term memory
  Exit: start a task on WhatsApp, refer to "the report" on Telegram
        ten minutes later, it resolves correctly.

Slice 7 — Everything else that was already designed for
  Slack (channel + workspace) · Scheduler/Workflow Engine · Plugin SDK
  Exit: a scheduled trigger fires a workflow with no human in the loop,
        and a third-party plugin registers a new capability without
        touching the Brain.

Slice 8 — Device Mesh
  Device Registry → authenticated node handshake → a second laptop →
  an Android phone
  Exit: "text this to my phone" resolves once the phone node is
        joined and has advertised SMS — nothing before this slice
        depended on it existing.
```

Each slice ships something the owner can actually use. If the project stalls after Slice 3, there's still a working, verified, human-supervised automation tool — not seventeen half-built subsystems.

---

## 3. Roadmap (slices mapped to scope)

| Slice | Scope | Depends on |
|---|---|---|
| 1 | Gateway, Owner Gate, Brain, Orchestrator, Agent Registry, Event Bus, Reliability Layer, Tool Runtime (elevated daemon), CLI, System backend | — |
| 2 | Desktop backend (Agent-S3), Windows ACI layer, per-app profiles | 1 |
| 3 | Dex Bar, Mission Control, confirmation cards | 1–2 |
| 4 | Browser backend, Workspace backend (Google first, then MS365) | 1–2 |
| 5 | WhatsApp, Telegram, Discord channels | 1–3 |
| 6 | Session stitching, entity graph, long-term memory | 1–5 |
| 7 | Slack (channel + workspace), Scheduler, Workflow Engine, Plugin SDK | 1–6 |
| 8 | Device Mesh — Device Registry, Dex Node, secondary laptop, Android | 1–7 |

Local VLM grounding server and the deeper Win32 surface (audio routing, process affinity, virtual desktops, BLE) aren't a separate slice — they're extensions of Slice 2's Desktop and System backends, added when a specific task needs them rather than built speculatively ahead of time.

---

## 4. Production readiness gates

Before calling any slice done, not just the whole project:

**Reliability**
```
[ ] A click succeeds by return value but UIA/pixel state doesn't change — caught, not marked done
[ ] The same failure repeats — loop detector aborts, doesn't retry forever
[ ] A DAG with a dependency cycle is rejected at plan time, not at runtime
[ ] Dex restarts mid-task — the task resolves to RESUMABLE, FAILED, or ABORTED, never orphaned
```

**Security**
```
[ ] Unauthorized sender is silently rejected, every channel
[ ] Group message without @dex is ignored
[ ] A stale confirmation card cannot approve a newer version of the same step
[ ] The daemon's named pipe rejects a connection from a non-admin local account
[ ] Untrusted page/email content never grants a capability by itself
```

**Cross-channel**
```
[ ] WhatsApp → Telegram continuation resolves to the right session
[ ] An ambiguous entity reference forces clarification instead of guessing
```

**Mesh** *(Slice 8 only)*
```
[ ] A node must complete the auth handshake before its capabilities are trusted
[ ] Node disconnect mid-step resumes, migrates, or fails explicitly — never hangs
```

---

## 5. Project structure

```
DexV3/
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── pyproject.toml
├── config/
│   └── config.yaml            # owner ids, prefix, model choice — no secrets
├── core/
│   ├── gateway.ts
│   ├── owner_gate.ts
│   ├── events/
│   │   ├── bus.ts
│   │   └── types.ts
│   ├── brain/
│   │   ├── normalizer.ts
│   │   ├── cache.ts
│   │   ├── tier.ts
│   │   └── planner.ts          # DAG generation
│   ├── orchestrator/
│   │   ├── orchestrator.ts
│   │   ├── registry.ts         # Agent Registry
│   │   ├── guardrails.ts       # tier enforcement, signed approvals
│   │   ├── retry_engine.ts
│   │   └── loop_detector.ts
│   ├── reliability/
│   │   ├── observation_engine.ts   # UIA + pixel diff + OCR + VLM fusion
│   │   ├── verification_policy.ts
│   │   ├── recovery_planner.ts
│   │   └── evidence_store.ts
│   ├── memory/
│   │   ├── session_stitcher.ts
│   │   ├── entity_graph.ts
│   │   └── long_term.ts
│   ├── ipc/
│   │   └── daemon_client.ts
│   └── mesh/                   # Slice 8
│       ├── device_registry.ts
│       ├── handshake.ts
│       └── transport.ts
├── daemon/                     # Tool Runtime — elevated, persistent
│   ├── DexDaemon.py
│   ├── install_service.ps1
│   └── handlers/
│       ├── registry_handler.py
│       ├── power_handler.py
│       ├── network_handler.py
│       ├── bluetooth_handler.py
│       ├── audio_handler.py
│       └── shell_runner.py     # non-blocking, signal-driven
├── agents/
│   ├── desktop/
│   │   ├── agent.ts
│   │   ├── windows_aci/        # discovery-then-target, stale-handle recovery
│   │   ├── app_profiles/
│   │   └── agent_s_bridge/
│   ├── system/
│   │   └── agent.ts
│   ├── browser/
│   │   ├── agent.ts
│   │   └── backends/
│   │       ├── agent_browser.ts
│   │       ├── webbrain_mcp.ts
│   │       └── browser_use.ts
│   ├── workspace/
│   │   ├── agent.ts
│   │   └── mcp_runtime/
│   └── phone/                  # Slice 8
│       └── agent.ts
├── channels/
│   ├── base_channel.ts
│   ├── whatsapp.ts
│   ├── telegram.ts
│   ├── discord.ts
│   ├── slack.ts
│   └── cli.ts
├── ui/
│   ├── dex-bar/
│   └── mission-control/
├── vlm/                         # local grounding server, added when Slice 2 needs it
│   ├── server/
│   └── client/
├── plugins/
│   └── examples/
│       ├── obs/
│       ├── spotify/
│       └── blender/
└── data/
    ├── sessions/
    ├── cache/
    ├── evidence/
    └── telemetry.db
```

---

## 6. Tech stack

| Layer | Technology | License |
|---|---|---|
| Desktop GUI | Agent-S3 (simular-ai/Agent-S) | Apache 2.0 |
| Grounding model | UI-TARS-1.5-7B (local) | Apache 2.0 |
| Browser (default) | agent-browser (Vercel Labs) | Apache 2.0 |
| Browser (alt) | webbrain | MIT |
| Browser (alt) | browser-use + Playwright | MIT |
| Google Workspace | taylorwilsdon/google_workspace_mcp | MIT |
| Microsoft 365 | Softeria/ms-365-mcp-server | MIT |
| Slack | korotovsky/slack-mcp-server | MIT |
| WhatsApp | Baileys | GPL-3.0 |
| Telegram | grammY | MIT |
| Discord | discord.js v14 | Apache 2.0 |
| Core runtime | Node.js + TypeScript | — |
| Daemon / Win32 | Python 3.12 + pywin32 | — |
| Session/cache store | better-sqlite3 | MIT |
| Mesh transport | `ws` (WebSocket) | MIT |
| Semantic cache | sentence-transformers (local embed) | Apache 2.0 |
| LLM provider | Configurable (Claude / GPT / local) | — |

---

## 7. Configuration

`config/config.yaml` — structural config only, no secrets:

```yaml
system:
  instance_id: "dex-master-workstation"
  hotkey: "Alt+Space"

owner:
  whatsapp: "+91XXXXXXXXXX@s.whatsapp.net"
  telegram_id: 123456789
  discord_id: "123456789012345678"
  slack_user_id: "UXXXXXXXXX"
  trigger_prefix: "@dex"

llm:
  default_provider: "anthropic"        # anthropic | openai | openrouter | local
  # pick whatever's current when you actually build this —
  # don't hardcode a model string into a planning doc

backends:
  desktop:
    grounding_endpoint: "http://127.0.0.1:8080"
  browser:
    default_backend: "agent_browser"   # agent_browser | webbrain | browser_use
  workspace:
    google_mcp_args: ["-y", "taylorwilsdon-google-workspace-mcp"]
    ms365_mcp_args: ["-y", "@softeria/ms-365-mcp-server"]
    slack_mcp_args: ["-y", "@korotovsky/slack-mcp-server"]

mesh:                                   # Slice 8, inert until then
  enabled: false
  discovery: "mdns"
  websocket_port: 8765
```

`.env` — everything secret-shaped lives here, never in config.yaml:

```env
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

TELEGRAM_BOT_TOKEN=
DISCORD_BOT_TOKEN=
SLACK_BOT_TOKEN=
SLACK_USER_TOKEN=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MS365_CLIENT_ID=
MS365_CLIENT_SECRET=

DAEMON_PIPE_NAME=\\.\pipe\dex_privileged_daemon
DAEMON_SHARED_SECRET=

# Slice 8 only
MESH_CLUSTER_SECRET=
```

---

## 8. Installation (rough sequence, Slice 1 only)

```bash
# 1. Bootstrap
git clone https://github.com/you/DexV3 && cd DexV3
npm install
python -m venv venv && ./venv/Scripts/activate
pip install pywin32 better-sqlite3 websockets --break-system-packages

# 2. Register the elevated daemon (Task Scheduler, "run with highest privileges")
powershell -ExecutionPolicy Bypass -File ./daemon/install_service.ps1

# 3. Configure
cp .env.example .env
# edit .env and config/config.yaml

# 4. Prove Slice 1
npx tsx core/index.ts --cli "set my DNS to 1.1.1.1 and 1.0.0.1"
# expect: [thinking]...[executing]...[done], no UAC prompt, evidence written to data/evidence/
```

Everything past this point — Desktop backend, channels, memory, Slack, mesh — is additive per the slice sequence in §2.

---

## 9. What Dex V3 does not do

- Respond to anyone except the configured owner, on any channel.
- Run as a public chatbot or multi-user service.
- Expose a network-reachable dashboard — Mission Control is local-only.
- Act on instructions found inside a webpage, email, or document — see SAFETY.md §3.
- Automate a second device unless it's explicitly enrolled through the Device Registry (Slice 8).
- Retry an action indefinitely — every task ends in `COMPLETED`, `FAILED`, `ABORTED`, or `CANCELLED`.
