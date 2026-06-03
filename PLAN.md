# Dex — Build Plan & Progress Tracker

> **What this file is.** A live tracker of the Dex build. When resuming a session, read this file first, find the lowest unchecked phase, and continue from there. Full design rationale lives in `design.md`; the build contract lives in `prompt.md`.

---

## One-page summary

**Product.** Dex — a Windows-first personal AI assistant. Chat-first control surface for an agent that has *hands* on your machine. The memorable moment is the **Action Preview**: the agent shows you what it's about to do; you approve or deny.

**Bundle ID.** `com.chethan616.dex`

**Architecture (4 layers, 2 processes, 1 client).**

```
Flutter app (Dex)  ───HTTP/WS:18789───►  OpenClaw (Node 24, the brain)
                                              │  Anthropic Claude
                                              │
                                              ▼ MCP stdio
                                          windows-desktop-control MCP (Python 3.10, the glue)
                                              │
                                              ▼ Python import / subprocess
                                          Microsoft UFO² (Python 3.10, the hands)
                                              │  Groq Qwen 3 (default)  ·  Claude fallback for vision
                                              ▼
                                          PiP / virtual desktop (isolated)
```

**LLM split.**
- **OpenClaw brain →** Anthropic Claude (reasoning, tool routing).
- **UFO² hands →** Groq Qwen 3 (free, text-only, UIA-grounded). One-line config flip to Claude for vision-required tasks.

**v1 scope (the user's call).** All of `design.md` desktop surface, no extras. No settings screen, no history search, no system tray, no global hotkey, no theme toggle, no Telegram, no Android build.

---

## Phase tracker

Tick a box only when the phase's **acceptance check** passes. Note the date.

**Legend:** [x] code written + verified by us · [~] code written, needs user verification with live stack · [ ] not started · [👤] gated on human step (key paste, install)

- [x] **Phase 0 — Bootstrap** (repo layout, PLAN.md, setup script runs green on this host)
- [~] **Phase 1 — OpenClaw running** (vendor cloned + pinned, gateway client API documented; install + `openclaw onboard` + Anthropic key are human steps below)
- [~] **Phase 2 — UFO² running standalone** (vendor cloned + pinned, headless entrypoint documented, PiP finding inverted; venv + Groq key are human steps below)
- [x] **Phase 3 — MCP glue server** (`glue/windows-desktop-control/server.py` written, refusal list wired, timeout enforced; live REPL test waits on Phase 2 venv)
- [x] **Phase 4 — Skill artifacts** (`SKILL.md` authored, `scripts/install-skill.ps1` ready; runs after OpenClaw is up)
- [x] **Phase 5 — Flutter foundation** (`com.chethan616.dex` builds, theme tokens + gateway client + models + state store, `flutter build windows` succeeds, widget test passes)
- [x] **Phase 6 — Flutter conversation surface** (3-zone home, Action Preview card with amber border + approve/deny, command bar with Ctrl+K, status pill with breathing dot, action steps in mono — all built)
- [~] **Phase 7 — Polish** (`scripts/run-dev.ps1` skeleton, SECURITY.md revised after Phase 2 finding, LICENSES.md drafted; live golden-path verification waits on the user setup steps)

## 🧑 Human steps to bring Dex live

The agent has built everything that doesn't need keys or a running gateway. These remaining steps need the user:

1. **Install Python 3.10 or 3.11** (UFO² requires; host currently has 3.14 only). https://www.python.org/downloads/
2. **Create UFO² venv** and install deps:
   ```powershell
   py -3.10 -m venv D:\project1\vendor\UFO\.venv
   D:\project1\vendor\UFO\.venv\Scripts\python.exe -m pip install -r D:\project1\vendor\UFO\requirements.txt
   ```
3. **Configure UFO² for Groq Qwen3:** copy template, paste Groq key. See "agents.yaml for Groq/Qwen3" block in Phase 2 below.
4. **Install OpenClaw:** `npm install -g openclaw@latest`
5. **Onboard OpenClaw** with Anthropic key: `openclaw onboard --install-daemon` (paste `sk-ant-...` when prompted, set Anthropic Claude as the model)
6. **Start the gateway** (if onboard didn't already): `openclaw gateway --port 18789 --verbose`
7. **Register the skill + MCP server:** `D:\project1\scripts\install-skill.ps1`
8. **Run Dex:**
   ```powershell
   D:\project1\app\build\windows\x64\runner\Debug\dex.exe
   # OR
   cd D:\project1\app; flutter run -d windows
   ```
9. **Try the golden path:** type "open Calculator and compute 12 × 9" — confirm Dex parses Claude's plan into an Action Preview, you click **Approve**, UFO² executes, the result comes back as agent prose.

---

## Phase 0 — Bootstrap

**Files created**
- [x] `D:\project1\vendor\` (empty)
- [x] `D:\project1\glue\windows-desktop-control\` (empty)
- [x] `D:\project1\app\` (empty)
- [x] `D:\project1\scripts\` (empty)
- [x] `D:\project1\README.md`
- [x] `D:\project1\PLAN.md` (this file)
- [x] `D:\project1\LICENSES.md` (first draft)
- [x] `D:\project1\SECURITY.md` (first draft)
- [x] `D:\project1\.gitignore`
- [x] `D:\project1\scripts\setup-windows.ps1` (prereq checker — does NOT install)
- [x] `D:\project1\scripts\run-dev.ps1` (skeleton)
- [x] `D:\project1\scripts\verify-phase.ps1` (skeleton)

**Prereq check result (run 2026-06-03):**
- [x] Node.js 24.12.0
- [x] git 2.54
- [x] PowerShell 5.1
- [x] Flutter 3.44.0 (stable)
- [ ] **Python 3.10 or 3.11** — user has 3.14.0 only; UFO2 needs 3.10 / 3.11 specifically
- [ ] **Flutter Windows target** — run `flutter config --enable-windows-desktop`
- [ ] **ANTHROPIC_API_KEY** — paste into OpenClaw config in Phase 1
- [ ] **GROQ_API_KEY** — paste into UFO2 agents.yaml in Phase 2

**🧑 HUMAN STEP — confirm before Phase 1 starts**
- [ ] Node 24 installed (`node --version` → v24.x or v22.19+)
- [ ] Python 3.10 installed (`py -3.10 --version`)
- [ ] Flutter SDK installed (`flutter --version`) with `flutter config --enable-windows-desktop`
- [ ] Anthropic API key in hand (for OpenClaw → Claude)
- [ ] Groq API key in hand (for UFO² → Qwen 3)

**Acceptance:** `scripts\setup-windows.ps1` prints a green ✓ for every prereq.

---

## Phase 1 — OpenClaw running headlessly (no Telegram)

**Steps**
1. [x] `git clone https://github.com/openclaw/openclaw vendor/openclaw`
2. [x] Pin: `OPENCLAW_PIN = 7074cf8e23c1f64362c4f8c4bf32971ca94d5221` (2026-06-03)
3. [x] Read README + `docs/` + `packages/gateway-protocol/` + `src/skills/` (Explore agent pass)
4. [ ] Install per OpenClaw's real instructions: `npm install -g openclaw@latest` then `openclaw onboard --install-daemon` (or foreground `openclaw gateway --port 18789 --verbose`)
5. [ ] **🧑 HUMAN STEP** — paste Anthropic API key into OpenClaw's config (via `openclaw onboard` wizard)
6. [ ] Start the gateway: `openclaw gateway --port 18789 --verbose`

**Gateway client API (verified from source):**

- **Transport.** JSON-RPC 2.0 over WebSocket on `ws://127.0.0.1:18789`.
  - Files: `vendor/openclaw/packages/gateway-protocol/src/schema/frames.ts:138-150`
- **Auth.** Shared-secret token or password in the `hello` connect frame.
  - File: `vendor/openclaw/packages/gateway-protocol/src/schema/frames.ts:55-66`
  - Field: `auth: { token?, password?, deviceToken? }`
- **Send a message.** Method `chat.send`.
  - Params schema: `vendor/openclaw/packages/gateway-protocol/src/schema/logs-chat.ts:70-90`
  - Shape: `{ sessionKey, agentId?, sessionId?, message, thinking?, fastMode?, deliver?, originatingChannel?, attachments?, timeoutMs?, idempotencyKey }`
  - Returns `{ runId, ... }`
- **Stream replies.** Event frames keyed by `runId`.
  - Schema: `vendor/openclaw/packages/gateway-protocol/src/schema/logs-chat.ts:127-178`
  - Shapes: `state: "delta" | "final" | "error" | "aborted"`, `deltaText` for partials.
- **Other useful methods.** `chat.history` (bounded), `chat.inject` (assistant note without run), `chat.message.get` (single message).
- **Protocol version handshake:** `vendor/openclaw/packages/gateway-protocol/src/version.ts`. Server advertises method list in `HelloOk`.

**Canonical request/response example (this is what our Flutter `gateway_client.dart` will send/receive):**

```jsonc
// → request
{
  "type": "req",
  "id": "<uuid>",
  "method": "chat.send",
  "params": {
    "sessionKey": "dex-desktop",
    "message": "open Calculator and compute 12 * 9",
    "idempotencyKey": "<uuid>"
  }
}

// ← sync response
{ "type": "res", "id": "<same uuid>", "ok": true, "data": { "runId": "run-..." } }

// ← streamed events (multiple)
{ "type": "event", "event": "chat.delta", "seq": 1, "runId": "run-...",
  "sessionKey": "dex-desktop", "state": "delta", "deltaText": "I'll open..." }
{ "type": "event", "event": "chat.delta", "seq": 2, "runId": "run-...",
  "state": "final", "message": { ... } }
```

**MCP server registration (the "mcporter" mechanism — actual current name is `openclaw mcp`):**
- Docs: `vendor/openclaw/docs/cli/mcp.md`
- Command:
  ```powershell
  openclaw mcp add windows-desktop-control `
    --command python `
    --arg D:\project1\glue\windows-desktop-control\server.py `
    --cwd D:\project1\glue\windows-desktop-control
  openclaw mcp doctor windows-desktop-control --probe
  ```
- Storage: `~/.openclaw/openclaw.json` under `mcp.servers.<name>`.
- Reload: `openclaw mcp reload`.

**Skills directory precedence (on Windows; verified in source):**
1. Workspace `.agents/skills/` (project-rooted)
2. User `%USERPROFILE%\.agents\skills\` (cross-project personal skills) ← we install here in Phase 4
3. Bundled / managed skills (in OpenClaw install)
4. Plugin skills: `%USERPROFILE%\.openclaw\plugin-skills\`

**SKILL.md frontmatter (current parser, `src/skills/loading/frontmatter.ts`):**
```yaml
name: <string>          # required
description: <string>   # required
os?: ["windows"]        # gate by platform — we set this for windows-desktop-control
always?: false
requires?: []
primaryEnv?: ""
```

**Native Windows verdict (from Explore pass):** Should work for single-user local. The README's "WSL2 recommended" is a strong suggestion, not a hard block. The launcher is Node; the skills loader uses Node's `path` module which handles both POSIX and Windows; daemon mode is launchd/systemd-aware but optional. **We'll attempt native Windows; if onboard daemon install fails, fall back to running `openclaw gateway` in a foreground PowerShell window managed by `scripts\run-dev.ps1`.**

**Acceptance:** Run `openclaw gateway --port 18789 --verbose`, then PowerShell `Test-NetConnection -ComputerName 127.0.0.1 -Port 18789` succeeds and a JSON-RPC `chat.send` over `ws://127.0.0.1:18789` returns streamed `chat.delta` frames from Claude.

---

## Phase 2 — UFO² running standalone

**Steps**
1. [x] `git clone https://github.com/microsoft/UFO vendor/UFO`
2. [x] Pin: `UFO_PIN = adef15b8789b015356977ed742916de2da644509` (2026-05-26)
3. [x] Read `vendor/UFO/README.md`, `vendor/UFO/ufo/ufo.py`, `vendor/UFO/config/ufo/*.yaml(.template)`, `vendor/UFO/ufo/server/app.py`.
4. [ ] **🧑 HUMAN STEP** — install Python 3.10 or 3.11 (host has 3.14 only; UFO² requires 3.10/3.11).
5. [ ] Create venv: `py -3.10 -m venv D:\project1\vendor\UFO\.venv` then `pip install -r D:\project1\vendor\UFO\requirements.txt`.
6. [ ] **🧑 HUMAN STEP** — copy `vendor\UFO\config\ufo\agents.yaml.template` → `vendor\UFO\config\ufo\agents.yaml`, then paste Groq key per the "agents.yaml for Groq/Qwen3" block below.

**UFO² entrypoint (verified from source):**

- **Headless CLI** — `vendor/UFO/ufo/ufo.py:9-46` defines argparse. The headless invocation is:
  ```powershell
  cd D:\project1\vendor\UFO
  .\.venv\Scripts\python.exe -m ufo `
    -t "dex-<uuid>" `
    -r "open Notepad, type 'hello dex', save to $env:USERPROFILE\Desktop\dex-test.txt" `
    -m normal `
    --log-level INFO
  ```
  - `-t / --task` task id (used as log dir name; we supply a UUID per Dex run)
  - `-r / --request` the natural-language goal — **omit and UFO² blocks for stdin**, so always pass it for headless
  - `-m / --mode` `normal` (default; what we want)
- **Programmatic entry** — `ufo.module.session_pool.SessionFactory().create_session(task=, mode=, plan=, request=)` then `await SessionPool(sessions).run_all()`. Phase 7 optimization candidate if subprocess cold-start hurts.
- **Daemon-mode FastAPI** — `vendor/UFO/ufo/server/app.py` exposes HTTP + WebSocket on default port 5000, auto-generated `--api-key`. Phase 7 optimization candidate.

**Important config knobs (`vendor/UFO/config/ufo/system.yaml`):**

- `CONTROL_BACKEND: ["uia"]` — defaults to Windows Accessibility (UIA) grounding. Text-only LLMs work here. ✓
- `SAFE_GUARD: True` — built-in refusal guard for sensitive operations. ✓
- `USE_MCP: True` — UFO² calls OTHER MCP servers as tools (unrelated to Dex's glue server).
- `MAXIMIZE_WINDOW: False`, `SHOW_VISUAL_OUTLINE_ON_SCREEN: False` — sensible defaults; leave alone for v1.
- Per-agent `VISUAL_MODE: True/False` in `agents.yaml` — **set False for HOST_AGENT and APP_AGENT** so Qwen 3 text-only doesn't try to consume screenshots.

**agents.yaml for Groq/Qwen3 (the human-step content):**

```yaml
HOST_AGENT:
  VISUAL_MODE: False              # text-only; Qwen3 doesn't take images
  REASONING_MODEL: False
  API_TYPE: "openai"
  API_BASE: "https://api.groq.com/openai/v1/chat/completions"
  API_KEY: "<paste your gsk_ key>"
  API_VERSION: "2025-02-01-preview"
  API_MODEL: "qwen/qwen3-32b"     # verify current Qwen-3 model id on Groq
  PROMPT: "ufo/prompts/share/base/host_agent.yaml"
  EXAMPLE_PROMPT: "ufo/prompts/examples/{mode}/host_agent_example.yaml"

APP_AGENT:
  VISUAL_MODE: False
  REASONING_MODEL: False
  API_TYPE: "openai"
  API_BASE: "https://api.groq.com/openai/v1/chat/completions"
  API_KEY: "<paste your gsk_ key>"
  API_VERSION: "2025-02-01-preview"
  API_MODEL: "qwen/qwen3-32b"
  PROMPT: "ufo/prompts/share/base/app_agent.yaml"
  EXAMPLE_PROMPT: "ufo/prompts/examples/{mode}/app_agent_example.yaml"

# Optional vision fallback — uncomment when you need Claude vision (for Photoshop, games, custom-drawn UIs).

MAX_TOKENS: 2000
TIMEOUT: 60
```

**Picture-in-Picture / virtual desktop — REVISED finding:**

PiP / virtual-desktop mode as described in `prompt.md` §5.3 **is not a built-in UFO² feature** in this commit. Grep across the repo for `picture.in.picture`, `virtual.desktop`, `PiP` returns only mobile/Linux MCP servers, not a Windows isolation toggle. Two options:

1. **Accept that UFO² runs on the user's primary desktop.** The Action Preview *approval gate* is the primary defense (user sees and approves before anything executes). Document this honestly in `SECURITY.md`.
2. **Build virtual-desktop isolation ourselves later (post-v1).** Windows has `IVirtualDesktopManager` COM API; spawn UFO² on a fresh desktop via a small wrapper.

**v1 decision:** option 1. Update `SECURITY.md` Phase 7 to reflect that isolation is *approval-based*, not *desktop-based*. Track option 2 as a roadmap item.

7. [ ] Smoke test: write `scripts/_ufo_smoke.py`, run, delete.
   - goal: "open Notepad, type 'hello dex', save to %USERPROFILE%\\Desktop\\dex-test.txt"
   - Expect: file exists at expected path.

**Acceptance:** smoke test passes; log saved under `vendor/UFO/logs/dex-smoke/`.

---

## Phase 3 — MCP glue server

**File:** `glue/windows-desktop-control/server.py`

```python
@mcp.tool()
def run_desktop_task(
    goal: str,
    app_hint: str = "",
    engine: str = "fast",      # "fast" = Qwen3 text/UIA · "vision" = Claude
    dry_run: bool = False,     # if True, return planned steps without executing
    timeout_s: int = 120,
) -> dict:
    """Returns {ok, summary, steps, log_excerpt}"""
```

- [ ] FastMCP skeleton, stdio transport (default)
- [ ] Wire to UFO² entrypoint from Phase 2.7
- [ ] Enforce `timeout_s` (subprocess wait or asyncio timeout)
- [ ] `dry_run=True` — return steps without executing (if UFO² can't natively, simulate by asking only for plan and noting in SECURITY.md)
- [ ] `engine="vision"` flips UFO² to Claude vision profile
- [ ] Under ~200 lines

**Acceptance:** call `run_desktop_task("open Calculator and compute 12*9", "Calculator")` from a Python REPL → returns `{ok: true, summary: "108", ...}`. `dry_run=True` returns step list without clicking.

---

## Phase 4 — Wire the skill into OpenClaw

**File:** `glue/windows-desktop-control/SKILL.md`

**Steps**
- [ ] Confirm OpenClaw's current skill frontmatter (read its docs — fields evolve)
- [ ] Write SKILL.md per draft in `prompt.md` §6.3
- [ ] Copy or symlink folder into the skills dir from Phase 1.8
- [ ] Register the MCP server via OpenClaw's `mcporter` — record command used: `<fill in>`
- [ ] Refresh skills / restart gateway

**Acceptance:** `curl` to gateway: "open Calculator and compute 12 × 9" → trace shows agent calling `run_desktop_task` → result arrives. Save trace to `D:\project1\notes\phase4-trace.txt`.

---

## Phase 5 — Flutter foundation

**Scaffold**
- [ ] `cd D:\project1 && flutter create --org com.chethan616 --project-name dex app`
- [ ] Confirm applicationId is `com.chethan616.dex`
- [ ] `flutter config --enable-windows-desktop`

**Dependencies (`app/pubspec.yaml`) — justified only**
- [ ] `web_socket_channel` — WS to gateway
- [ ] `http` — REST to gateway
- [ ] `intl` — timestamps
- [ ] (State: stick to `ChangeNotifier` for v1; revisit at end of Phase 7)
- [ ] **NOT included:** any UI kit, animation library, icon font

**Theme**
- [ ] `assets/fonts/Geist-Variable.ttf` and `assets/fonts/GeistMono-Variable.ttf`
- [ ] `lib/theme/tokens.dart` — verbatim color/space/radius/type tokens from `design.md` §2-4
- [ ] `lib/theme/theme.dart` — `ThemeData.dark()` + light mirror; no hard-coded hex/px outside `tokens.dart`
- [ ] `lib/theme/motion.dart` — 120/160/220 ms curves; honors `MediaQuery.disableAnimations`

**Gateway adapter**
- [ ] `lib/core/gateway_client.dart` — typed: `sendMessage`, `streamEvents`, `approveAction`, `denyAction` (real endpoints from Phase 1.7)
- [ ] `lib/core/models/` — `Message`, `ActionStep`, `ActionPreview`, `Device`, `Skill`, `AgentState` enum

**Acceptance:** `flutter run -d windows` opens an empty dark window in the token palette. Connecting to the local gateway prints a streamed event to the console.

---

## Phase 6 — Flutter conversation surface + Action Preview

Build the three desktop zones from `design.md` §5.

- [ ] `lib/screens/home_desktop.dart` — three resizable columns: Devices | Conversation | Live/Action
- [ ] `lib/widgets/device_chip.dart` + `skill_list_item.dart` — left rail; v1 = "This PC" + skills
- [ ] `lib/widgets/message_human.dart` — sans, no decorative bubble
- [ ] `lib/widgets/message_agent_prose.dart` — sans, full width
- [ ] `lib/widgets/action_step.dart` — mono line, leading state glyph (`›` `⠿` `✓` `✕`), colored by agent-state token
- [ ] `lib/widgets/command_bar.dart` — floating, blurred (one of two allowed `BackdropFilter` uses), mono input, Enter sends, `Ctrl+K` focuses
- [ ] `lib/widgets/action_preview_card.dart` — **the soul.** Amber border (`--awaiting`), mono step list, Approve (accent) / Deny
- [ ] `lib/widgets/agent_status_pill.dart` — persistent dot + word; 160ms cross-fade on state change

**Motion budget (§8)**
- [ ] 120ms fade + 4px rise on new messages; 40ms stagger on action steps
- [ ] 1.2s opacity pulse on `⠿`
- [ ] All animations respect `MediaQuery.disableAnimations`

**Acceptance — the golden path inside the app:**
1. Type "open Calculator and compute 12 × 9"
2. Status pill: `thinking`
3. Action Preview slides in (right panel) with the planned steps in mono
4. Click **Approve**
5. Status pill: `acting`; action steps animate into the conversation
6. Agent prose message: "Done — 108."

---

## Phase 7 — Polish, security, perf

- [ ] **Approval gate** — if gateway doesn't natively emit pre-action events, intercept inside the MCP server (Phase 7.1 of the spec). Document the seam in SECURITY.md.
- [ ] **a11y** — contrast ≥ 4.5:1 (palette already passes; verify); every state has glyph + word; full keyboard path; Enter/Esc on approval card.
- [ ] **Perf budget** — cold-start < 2s; input never blocked while agent works; one `BackdropFilter` per frame max.
- [ ] **`LICENSES.md` audit** — every vendored repo, every Flutter dep, every font; no AGPL.
- [ ] **`SECURITY.md`** — PiP isolation, ask-first default, key locations (not committed), what `run_desktop_task` refuses.
- [ ] **`scripts/run-dev.ps1`** — one command: gateway + MCP server + Flutter, all up.

**Acceptance:** `scripts\run-dev.ps1` brings everything up; golden path works; reduced-motion works; light theme renders.

---

## Out of scope for v1 (do NOT start)

macOS agent · Linux agent · Android build · cross-device relay (Tailscale, device registry) · UFO³ Galaxy · settings screen · history search · system tray · global hotkey · theme toggle UI · Telegram channel.

Leave clean seams (responsive scaffolding, device chip is already a list-of-1) — build none of these in v1.

---

## Notes from execution

> Append dated notes as work progresses. Things like: what the OpenClaw API actually looked like once we read its source; whether Qwen3+UIA was enough for the smoke test app; PiP toggle file path; etc.

- _(empty — fill in as we go)_
