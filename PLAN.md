# Dex — Implementation Plan

> **Plan-mode note:** This is the planning artifact. During execution, a mirrored, human-facing progress tracker will live at `D:\project1\PLAN.md` and get checked off phase by phase.

---

## Context

**What we're building.** Dex is a Windows-first personal AI assistant — a chat-first control surface for an agent that has "hands" on the user's PC. The user types a natural-language goal; the agent reasons, previews each GUI action, waits for one-tap approval, then executes inside an isolated Picture-in-Picture desktop. The memorable thing is the **Action Preview** moment: nothing happens until the user sees what's about to happen.

**Why this shape.**
- The user is letting software touch their real files and apps. Trust, legibility, and stoppability are the design goals — not feature breadth.
- Building from scratch is wasteful when OpenClaw (the brain) and Microsoft UFO² (the hands) already exist as mature open-source projects. Dex is the *integration and surface*, not the agent or the automation engine.
- "Lightweight is the aesthetic" — Flutter (not Electron), no heavy state library, restraint as a feature.

**Identity.**
- Product name: **Dex**
- Bundle/package ID: `com.chethan616.dex`
- Tagline (internal): "A calm cockpit for commanding agents you can trust."

**Decisions the user already made (in this session).**
1. LLM split: **Anthropic Claude** for OpenClaw (the brain — reasoning, planning, tool routing). **Groq Qwen 3** for UFO² (the hands — UIA-grounded GUI execution; free tier, fast). See "LLM strategy" below for the vision caveat.
2. **Skip Telegram bootstrap.** Go straight to the Flutter app as the only client. We lose the "is the brain alive?" sanity check but save a phase.
3. **Flutter scope = MVP v1 from design.md, no extras.** Conversation, command bar, Action Preview, device chip, agent status pill, skills list — production-quality on each. No settings screen, no history search, no system tray, no global hotkey in v1.

**What success looks like for v1.** User types "open Calculator and compute 12 × 9" in the Dex app → the agent's plan appears as mono step-lines in the right panel → user clicks **Approve** → UFO² executes in the PiP desktop → result streams back into the conversation. The whole loop is calm, fast, and reads as one cohesive product.

---

## Architecture (4 layers, 2 processes, 1 client)

```
┌─────────────────────────────────────────────────────────────┐
│  Flutter app (Dex)         "the face"                       │
│  — Windows desktop now, Android-ready code structure        │
│  — talks to OpenClaw's local gateway over HTTP + WebSocket  │
└───────────────────────────────┬─────────────────────────────┘
                                │  HTTP/WS on 127.0.0.1:18789
┌───────────────────────────────▼─────────────────────────────┐
│  OpenClaw (Node 24)        "the brain"                      │
│  — sessions, channels, skills, memory, cron                 │
│  — Anthropic Claude for reasoning                           │
│  — registers the windows-desktop-control MCP server         │
└───────────────────────────────┬─────────────────────────────┘
                                │  MCP stdio
┌───────────────────────────────▼─────────────────────────────┐
│  windows-desktop-control MCP server (Python 3.10)  "glue"   │
│  — FastMCP, one tool: run_desktop_task(goal, app_hint)      │
│  — wraps UFO² with timeout + dry-run flag                   │
└───────────────────────────────┬─────────────────────────────┘
                                │  Python import / subprocess
┌───────────────────────────────▼─────────────────────────────┐
│  Microsoft UFO² (Python 3.10) "the hands"                   │
│  — runs in PiP / virtual desktop (does not steal focus)     │
│  — Groq Qwen 3 (text) in UIA-grounded mode                  │
└─────────────────────────────────────────────────────────────┘
```

---

## LLM strategy (the Qwen-3 caveat, handled)

UFO² historically uses a vision-language model (GPT-4V) to *see* the screen and click. **Qwen 3 on Groq is text-only.** Two ways UFO² can still work with a text LLM:

1. **UIA-grounded mode.** UFO² reads the Windows Accessibility tree (UIA) and exposes controls as structured text — element name, type, bounds. The LLM picks which element to click. No pixels needed. This works for ~80% of mainstream apps (Office, Notepad, Calculator, browsers via accessibility, settings).
2. **Vision-required fallback.** Some apps (Photoshop, games, custom-drawn UIs) only render pixels. For these we fall back to Claude (Claude has vision) on the same UFO² agent config.

**Plan:** ship with **Qwen 3 via Groq as default for UFO²** plus a documented one-line config flip in `agents.yaml` to swap to Claude. The MCP `run_desktop_task` tool accepts an optional `engine: "fast" | "vision"` arg so the agent can choose per task.

---

## Repo layout

```
D:\project1\                            # the repo root (already exists)
├── README.md                           # product overview + run-dev
├── PLAN.md                             # mirrored progress tracker (created Phase 0)
├── LICENSES.md                         # third-party license audit
├── SECURITY.md                         # risk surface + isolation guarantees
├── design.md                           # (already exists, untouched)
├── prompt.md                           # (already exists, untouched)
├── vendor/
│   ├── openclaw/                       # pinned commit, do not modify
│   └── UFO/                            # pinned commit, do not modify
├── glue/
│   └── windows-desktop-control/
│       ├── server.py                   # FastMCP server (<200 lines)
│       ├── requirements.txt
│       └── SKILL.md                    # OpenClaw skill definition
├── app/                                # Flutter client
│   ├── pubspec.yaml                    # com.chethan616.dex, justified deps only
│   ├── lib/
│   │   ├── main.dart
│   │   ├── theme/
│   │   │   ├── tokens.dart             # Section 2-4 of design.md, single source of truth
│   │   │   ├── theme.dart              # ThemeData (dark-first, light mirror)
│   │   │   └── motion.dart             # 120ms / 160ms / 220ms curves; respects prefers-reduced
│   │   ├── core/
│   │   │   ├── gateway_client.dart     # HTTP + WS to 127.0.0.1:18789
│   │   │   ├── models/                 # Message, ActionStep, ActionPreview, Device, Skill
│   │   │   └── state/                  # ConversationStore, AgentStateStore (ChangeNotifier)
│   │   ├── widgets/
│   │   │   ├── message_human.dart
│   │   │   ├── message_agent_prose.dart
│   │   │   ├── action_step.dart        # mono line, state glyph + color
│   │   │   ├── action_preview_card.dart  # the soul — amber border, approve/deny
│   │   │   ├── command_bar.dart        # floating, ⌘K, mono input
│   │   │   ├── device_chip.dart
│   │   │   ├── agent_status_pill.dart
│   │   │   └── skill_list_item.dart
│   │   ├── screens/
│   │   │   └── home_desktop.dart       # the 3-zone layout from §5 of design.md
│   │   └── platform/
│   │       └── responsive.dart         # >= 720dp = desktop; phone code-paths kept but unused in v1
│   ├── assets/
│   │   └── fonts/                      # Geist + Geist Mono (variable, single file each)
│   └── windows/                        # Flutter Windows runner (auto-generated)
└── scripts/
    ├── setup-windows.ps1               # idempotent dev setup
    ├── run-dev.ps1                     # starts gateway + MCP server for local dev
    └── verify-phase.ps1                # runs the acceptance check for a given phase
```

---

## Phases (resequenced — Telegram skipped, Flutter pulled forward)

Each phase ends with an explicit **acceptance check** and a **PLAN.md update** before the next begins.

### Phase 0 — Bootstrap (`D:\project1\` scaffolding)

1. Create the repo layout above (empty files where appropriate).
2. Write `PLAN.md` (the user-facing tracker) with the phase checklist below.
3. Write `scripts/setup-windows.ps1` — checks Node 24, Python 3.10, Flutter SDK, prints what's missing. Does NOT install — humans install.
4. **`🧑 HUMAN STEP`** confirm: Node 24, Python 3.10, Flutter (`flutter config --enable-windows-desktop`), Anthropic API key, Groq API key.
5. Write `LICENSES.md` and `SECURITY.md` first drafts (filled in real values as we vendor).

**Acceptance:** `scripts/setup-windows.ps1` runs green; PLAN.md visible; no vendored code yet.

### Phase 1 — OpenClaw running headlessly (no Telegram)

1. `git clone https://github.com/openclaw/openclaw vendor/openclaw` → pin to current `main` HEAD commit, record SHA in README.md.
2. Read `vendor/openclaw/README.md` and any `docs/` end-to-end. **If anything in this plan disagrees with what you find, stop and report** — the spec rule from prompt.md §0.1.
3. Install OpenClaw per its real instructions. **`🧑 HUMAN STEP`** paste Anthropic API key into its config (whatever path its docs specify — historically `~/.openclaw/config.json` or env var).
4. Start the gateway: `openclaw gateway --port 18789 --verbose` (the port from the README; confirm it's still the default).
5. Find and document the gateway's **client API** in `README.md`: HTTP route(s) for sending a message, WS route for streaming events, auth scheme (token? localhost-only?), and the message schema. **Read source, don't guess.** This is the API the Flutter app will speak.
6. Document the real skills directory path on Windows (from OpenClaw's docs / source).

**Acceptance:** `curl` (or PowerShell `Invoke-WebRequest`) against the gateway sends a "hello" and gets a streamed reply from Claude. Capture the request/response shape in `README.md` for reference.

### Phase 2 — UFO² running standalone (the hands work in isolation)

1. `git clone https://github.com/microsoft/UFO vendor/UFO` → pin commit, record SHA.
2. Read `vendor/UFO/README.md` and `documents/` end-to-end.
3. Set up its Python 3.10 venv (`vendor/UFO/.venv`) per its instructions. **`🧑 HUMAN STEP`** copy `config/ufo/agents.yaml.template` → `agents.yaml`, paste **Groq API key** and configure Qwen 3 endpoint (Groq is OpenAI-compatible: `https://api.groq.com/openai/v1`, model `qwen/qwen3-32b` or current Qwen 3 model id — verify from Groq's docs).
4. Enable **Picture-in-Picture / virtual desktop mode** — find the real toggle in UFO²'s config or CLI flag. Document the exact toggle.
5. Find UFO²'s **headless / programmatic entrypoint** by reading source. Document module + function signature. (README hints `python -m ufo --task <name>` — verify whether that's the right Python-importable entrypoint or whether there's a cleaner one.)
6. Smoke test: from a throwaway script, ask UFO² to "open Notepad, type 'hello dex', save to `%USERPROFILE%\Desktop\dex-test.txt`" inside PiP. Capture the log.

**Acceptance:** the file exists at the expected path, was created without UFO² stealing the user's foreground focus. Log saved to `vendor/UFO/logs/`.

### Phase 3 — The MCP glue server

1. `glue/windows-desktop-control/server.py` — FastMCP server with one tool:

   ```python
   @mcp.tool()
   def run_desktop_task(
       goal: str,
       app_hint: str = "",
       engine: str = "fast",      # "fast" = Qwen3 text/UIA, "vision" = Claude
       dry_run: bool = False,     # if True, return the planned steps without executing
       timeout_s: int = 120,
   ) -> dict:
       """..."""
   ```

2. The tool spawns UFO² (subprocess or import per Phase 2 findings) **inside the PiP desktop**, enforces `timeout_s`, returns a structured dict: `{ok, summary, steps, log_excerpt}`.
3. `dry_run=True` returns UFO²'s planned step list **without executing** — this is what the Flutter Action Preview will render. (If UFO² can't natively dry-run, simulate by asking the LLM only for the plan; record the limitation in `SECURITY.md`.)
4. Keep server.py under ~200 lines (prompt.md §8 budget).
5. `requirements.txt`: `mcp`, anything UFO² needs that isn't already in its venv. Reuse UFO²'s venv where possible — don't re-pin its deps.

**Acceptance:** standalone test — call `run_desktop_task("open Calculator and compute 12*9", "Calculator")` from a Python REPL and get `{ok: true, summary: "108", ...}` back. Same with `dry_run=True` returns steps but does not click.

### Phase 4 — Wire the skill into OpenClaw

1. Author `glue/windows-desktop-control/SKILL.md` using OpenClaw's actual current skill frontmatter (confirm field names from its docs — they evolve). The body is roughly the draft in prompt.md §6.3.
2. Copy or symlink the skill folder into OpenClaw's skills dir (the path confirmed in Phase 1.6).
3. Register the MCP server with OpenClaw using its **`mcporter`** mechanism. Read OpenClaw's MCP/skills docs for the exact command. Record the command used.
4. Refresh skills / restart the gateway.

**Acceptance:** from a `curl` to the gateway: "open Calculator and compute 12 × 9". The gateway's response stream shows the agent calling `run_desktop_task`, then returning the result. Trace logged.

### Phase 5 — Flutter app, foundation (the face, part 1)

1. `flutter create --org com.chethan616 --project-name dex app` (yields applicationId `com.chethan616.dex`). Then `flutter config --enable-windows-desktop` (already done as `🧑 HUMAN STEP` in Phase 0 but reconfirm).
2. `pubspec.yaml` justified-deps list. **Approved:**
   - `web_socket_channel` — WS to gateway. Built-in feel.
   - `http` — REST calls to gateway.
   - `flutter_riverpod` — small, type-safe state. (Alternative: pure `ChangeNotifier`. Decision: **ChangeNotifier**, to honor "no heavy state library" — Riverpod is justified only if state graph gets large; revisit at end of Phase 7.)
   - `intl` — timestamps.
   - **NOT included:** any UI kit (no GetX, no Material You theming pack), no animation library, no icon font.
3. Wire Geist + Geist Mono variable fonts in `assets/fonts/`. Single file each. Declare in pubspec.
4. Write `lib/theme/tokens.dart` — verbatim ports of the color/spacing/radius/type tokens from design.md §2-4. Single source of truth. No hex or px anywhere else in the codebase — lint with `dart analyze` to keep it clean.
5. Write `lib/theme/theme.dart` — `ThemeData.dark()` overrides built from tokens; light theme mirrored.
6. Write `lib/core/gateway_client.dart` — typed methods: `sendMessage(text)`, `streamEvents()` (returns a `Stream<GatewayEvent>`), `approveAction(id)`, `denyAction(id)`. Uses real endpoints from Phase 1.5.
7. Write `lib/core/models/` — `Message`, `ActionStep`, `ActionPreview`, `Device`, `Skill`, `AgentState` enum (`idle | thinking | acting | awaiting | error`).

**Acceptance:** `flutter run -d windows` opens an empty window using the dark token palette. Connecting to the gateway prints a streamed event to the console.

### Phase 6 — Flutter app, the conversation surface (the face, part 2)

Build the three desktop zones from design.md §5. Use only the tokens.

1. `home_desktop.dart` — three resizable columns: Devices | Conversation | Live/Action.
2. **Left rail** (`device_chip.dart`, `skill_list_item.dart`) — v1 shows just "This PC" + the skills list pulled from gateway. Collapsible.
3. **Center column:**
   - `message_human.dart` — sans, right-aligned-light, no decorative bubble.
   - `message_agent_prose.dart` — sans, full width.
   - `action_step.dart` — mono line, leading state glyph (`›` `⠿` `✓` `✕`), color from agent-state token. Groups collapse into an expandable "Action" card.
   - `command_bar.dart` — floating bottom-center, blurred surface (one of the two allowed `backdrop_filter` uses), mono input, Enter sends, `⌘K`/`Ctrl+K` focuses.
4. **Right column:**
   - `action_preview_card.dart` — title (what + which app), mono step list, `Approve` (accent) / `Deny` buttons, **amber border while pending** (`--awaiting`). Highest-contrast element in the app, by design.
   - Optional: PiP thumbnail (Phase 7 deliverable; v1 ships without this).
5. `agent_status_pill.dart` — persistent in the conversation header. Dot + word, transitions 160ms color cross-fade.
6. Motion budget (§8 of design.md): 120ms fade+rise on new messages, 40ms stagger on action steps, 1.2s opacity pulse on `⠿`. Respect `MediaQuery.disableAnimations`.

**Acceptance:** the desktop golden path works through the Flutter app:
- type "open Calculator and compute 12 × 9" → message appears → status pill goes `thinking` → Action Preview slides in (right panel) → click **Approve** → status pill goes `acting` → action steps animate in → final agent message: "Done — 108."
- A denied action shows a clean rollback message in chat.
- Reduced-motion mode: instant transitions, no pulses.

### Phase 7 — Polish, security, perf budget

1. **Approval pre-action events.** If OpenClaw's gateway doesn't emit pre-action events natively, intercept in the MCP server: on the *first* call of `run_desktop_task`, emit `dry_run=True` to plan, post the plan to a small in-app inbox, block until Flutter sends approval. (Implementation lives in the MCP server, not Flutter — the LLM doesn't know about it.) Document this seam in `SECURITY.md`.
2. **Accessibility audit.** Contrast ≥ 4.5:1 on every surface (tokens already pass — verify). Every agent state has a glyph + word, not just color. Full keyboard path: tab order through conversation, command bar focusable via ⌘K, approval focusable, Enter/Esc on the approval card maps to Approve/Deny.
3. **Perf budget verification.** Cold-start under 2s. Input never blocked while the agent works (gateway client runs on a `compute` isolate or is awaited cleanly). One `BackdropFilter` per frame max (command bar OR approval sheet, never both visible together).
4. **`LICENSES.md` audit.** Run an honest pass: every vendored repo, every Flutter dep, every font. Confirm no AGPL. Record SPDX.
5. **`SECURITY.md`.** Document: PiP isolation, default ask-first behavior, where the API keys live (not committed), what `run_desktop_task` will refuse.
6. **`scripts/run-dev.ps1`.** One command that starts gateway + MCP server + Flutter app for local dev.

**Acceptance:** `scripts/run-dev.ps1` brings the whole stack up; the golden path works; reduced-motion works; light theme renders correctly (even if v1 ships dark-default).

---

## Out of scope for v1 (do NOT start)

Per prompt.md §9 and the user's "MVP v1, no extras" answer: macOS agent, Linux agent, Android build (code stays mobile-ready but no `flutter run -d android`), cross-device relay (Tailscale, device registry), UFO³ Galaxy multi-device, settings screen, history search, system tray, global hotkey, theme toggle UI. Leave clean seams (responsive scaffolding, device chip already a list) — build none.

---

## Risk register (things most likely to blow up)

1. **OpenClaw's client API isn't documented enough.** Mitigation: Phase 1.5 forces a documentation pass before any Flutter work starts. If the API truly is undocumented, build a tiny localhost adapter and document why (prompt.md §7.2 already permits this).
2. **UFO² programmatic entrypoint is messy.** Mitigation: Phase 2.5 — read source, don't guess. If only the CLI works cleanly, the MCP server shells out via subprocess; that's fine.
3. **Qwen 3 + UIA mode misses too many real tasks.** Mitigation: the `engine: "fast" | "vision"` knob is in the tool from day one — flipping to Claude is a one-arg change, not a rewrite.
4. **PiP / virtual desktop steals focus anyway.** Mitigation: Phase 2.4 verifies this in isolation before any glue is written. Stop and report if it does.
5. **Pre-action approval isn't natively possible.** Mitigation: handle it in the MCP server as in Phase 7.1 — the glue is the natural place for this gate.

---

## Verification (how to know it works, end to end)

```powershell
# from D:\project1
.\scripts\run-dev.ps1               # starts gateway, MCP server, Flutter app
# In the Flutter app:
#   type: "open Calculator and compute 12 × 9"
#   wait for Action Preview in the right panel
#   click Approve
#   confirm result "108" arrives in chat as agent prose
#   confirm action steps render in mono in the conversation
#   confirm status pill cycles idle → thinking → awaiting → acting → idle
# Also:
.\scripts\verify-phase.ps1 7        # runs the Phase 7 acceptance script
```

---

## Critical files (the executor will create or modify these — most other files are scaffolding)

- `D:\project1\PLAN.md` — the human-facing progress tracker (mirrors this plan, with checkboxes)
- `D:\project1\glue\windows-desktop-control\server.py` — the MCP glue (<200 lines)
- `D:\project1\glue\windows-desktop-control\SKILL.md` — the OpenClaw skill teaching the agent when to call desktop control
- `D:\project1\app\lib\theme\tokens.dart` — single source of truth for design tokens
- `D:\project1\app\lib\core\gateway_client.dart` — the OpenClaw gateway adapter
- `D:\project1\app\lib\widgets\action_preview_card.dart` — the soul of the app
- `D:\project1\app\lib\screens\home_desktop.dart` — the three-zone layout
- `D:\project1\scripts\run-dev.ps1` — the one-command dev startup
- `D:\project1\SECURITY.md` — risk surface + isolation
- `D:\project1\LICENSES.md` — third-party audit

---

## Progress log (the executor checks these off as phases complete)

- [ ] Phase 0 — Bootstrap (`PLAN.md`, scripts, prereqs confirmed)
- [ ] Phase 1 — OpenClaw running, client API documented
- [ ] Phase 2 — UFO² running standalone, PiP confirmed, entrypoint documented
- [ ] Phase 3 — MCP glue server with `run_desktop_task`, dry-run mode
- [ ] Phase 4 — Skill registered, end-to-end via curl works
- [ ] Phase 5 — Flutter foundation (theme tokens, gateway client, models)
- [ ] Phase 6 — Flutter conversation surface + Action Preview
- [ ] Phase 7 — Polish, security, perf budget, `run-dev.ps1`

When resuming a session: read `D:\project1\PLAN.md` first, find the lowest unchecked phase, and continue from there.

---

# v1.1 — Tool family expansion (Phase 8-9)

## Context

The v1 build (Phases 0-7) is working end-to-end: Dex connects, Claude reasons, shell + UFO² are usable. But a real session exposed a gap: when the user asked Dex to **take a typing test on a website**, Claude burned ~10 minutes flailing — first via `SendKeys`, then clipboard paste, then injecting JavaScript through Vivaldi's address bar — because the only "hands" tool it had (`windows-desktop-control` → UFO²) is meant for native Windows app UIA, not browser DOM. It defaulted to OpenClaw's shell tool and improvised badly.

The fix mirrors how Gemini auto-routes between text and image generation: **give Claude more specialized tools and let MCP's natural tool-selection do the routing.** Add a dedicated browser-control tool (wrapping the `browser-use` library) so browser tasks have a real driver. With three tool families in play (shell + UFO² + browser-use), Claude picks per-task based on SKILL descriptions, just like Gemini picking "nano-banana" for images.

**Decisions the user made (in this session).**
1. **Skip agent-zero.** It overlaps significantly with what shell + UFO² + browser-use already cover; the Docker + XFCE overhead isn't justified yet. Documented as a "future, deferred" item in the roadmap, NOT a v1.1 deliverable.
2. **browser-use LLM = Groq Qwen 3** (same key already in `agents.yaml`). Free, fast. Qwen 3 is text-only, so browser-use runs in `use_vision=False` mode (accessibility tree only). Visual web tasks (image CAPTCHAs, image-only buttons) won't work; the vast majority of real web tasks — forms, text content, links, navigation — will.
3. **Tool chips visible in chat.** Every tool call renders a small mono chip in the conversation: `tool: browser-use → take typing test`. Gemini-style "selecting tool" transparency.

## New architecture (3 tool families)

```
            Claude (via OpenClaw) decides per-message
            ┌────────────────────────────────────────┐
            ▼                  ▼                     ▼
   OpenClaw built-in    windows-desktop-     browser-control
   shell / file /       control (UFO²)       (browser-use)
   process tools        [vendor/UFO]         [vendor/browser-use]
            │                  │                     │
            ▼                  ▼                     ▼
   Spawn notepad.exe,   Excel sums,          Web forms, typing
   read files, run      Word edits,          tests, scraping,
   git, npm, etc.       Settings panels      navigation
```

**Routing rule of thumb** (encoded in each tool's SKILL.md and description so Claude has clear signals):

| Task shape | Tool |
|---|---|
| File read/write, CLI command, `git`, `npm`, anything in a shell | OpenClaw built-in (`bash`, `read`, `write`) |
| Native Win32 app interior: Excel/Word/Outlook/Settings/Calculator/file dialogs | `windows-desktop-control` (UFO²) |
| Anything happening *inside a web page* (Chrome, Edge, Firefox, Vivaldi): forms, clicks, text extraction, multi-page flows | `browser-control` (browser-use) |
| Just *launching* an app (e.g. "open notepad") | OpenClaw shell — no need to drive its UI |

If a task spans categories ("download a CSV, open it in Excel, sum a column"), Claude chains tool calls — browser-control for the download, shell for the open, windows-desktop-control for the sum.

## Phase 8 — browser-control MCP server

**Goal:** add a third MCP server that exposes `run_browser_task` to Claude, backed by browser-use + Playwright + Qwen 3.

### 8.1 Vendor browser-use

1. `git clone --depth 1 https://github.com/browser-use/browser-use vendor/browser-use`
2. Pin HEAD commit; record SHA in README.md alongside the OpenClaw + UFO² pins.
3. Read the cloned `README.md` and `docs/` to verify the API hasn't drifted. The Python API expected from web-fetch:
   ```python
   from browser_use import Agent, Browser
   # LLM: ChatOpenAI from langchain_openai, pointed at Groq's OpenAI-compatible endpoint
   ```
4. License check: MIT (per repo README) → add row to `LICENSES.md`.

### 8.2 Python venv + Playwright

browser-use requires Python ≥ 3.11. The same Python 3.11 install already needed for UFO² covers it. Decision: **separate venv** per tool family to avoid dependency conflicts (Playwright + browser-use is a heavyweight set).

```powershell
py -3.11 -m venv D:\project1\vendor\browser-use\.venv
D:\project1\vendor\browser-use\.venv\Scripts\python.exe -m pip install browser-use playwright langchain-openai mcp
D:\project1\vendor\browser-use\.venv\Scripts\python.exe -m playwright install chromium
```

(Chromium download is ~150 MB; this is the only "heavy" piece.)

### 8.3 The MCP glue — `glue/browser-control/server.py`

Mirror the structure of `glue/windows-desktop-control/server.py`. Single tool:

```python
@mcp.tool()
def run_browser_task(
    goal: str,
    url_hint: str = "",          # optional starting URL; agent navigates if missing
    timeout_s: int = 180,        # browser tasks are slower than UIA
    dry_run: bool = False,
    headless: bool = False,      # default visible so user sees what's happening
) -> dict:
    """Drive a web browser to accomplish a natural-language goal.
    Use ONLY for tasks happening INSIDE a webpage (forms, text content,
    navigation, scraping). For native Windows apps use run_desktop_task.
    For pure file/shell work use the agent's own shell tool.
    Returns {ok, summary, steps, log_path, task_id}.
    """
```

Internals:
1. Build a `langchain_openai.ChatOpenAI` pointed at `https://api.groq.com/openai/v1` with model `qwen/qwen3-32b` and the existing Groq key.
2. Construct `browser_use.Agent(task=goal, llm=llm, browser=Browser(), use_vision=False)`. Vision off because Qwen 3 is text-only.
3. `await agent.run()` with a timeout. Capture step history into `steps`.
4. Same refusal list as `run_desktop_task` (formatting drives, disabling defender, etc.) PLUS browser-specific refusals (logging into banking sites, sending money, posting publicly without explicit user confirmation in the goal text).
5. Return a structured dict identical in shape to `run_desktop_task` so the Flutter renderer treats both uniformly.
6. **Under ~250 lines.** Slightly larger budget than the UFO² glue because we're driving an async library directly (not subprocessing a CLI).

### 8.4 SKILL.md — teach Claude the routing

Author `glue/browser-control/SKILL.md` with crisp "use this when / don't use this when" rules. Critical: SKILL.md is read by Claude at every turn, so it's the routing prompt. Include:

- When to pick this over `run_desktop_task` ("any task inside a web page")
- When to pick this over shell ("the goal needs to interact with rendered HTML")
- The mandatory user-confirmation rule (same as windows-desktop-control: state plan, wait for "approve")
- Caveats: vision off → image-only elements may fail; CAPTCHA → refuse
- Examples of each routing decision

ALSO update `glue/windows-desktop-control/SKILL.md` with a "NOT for browser tasks — use browser-control instead" line so the two skills cross-reference cleanly. Without this, Claude may still pick UFO² for browser work because that's what it learned first.

### 8.5 Register the second MCP server

Extend `scripts/install-skill.ps1` → rename to `scripts/install-skills.ps1` (plural). It now registers BOTH `windows-desktop-control` and `browser-control` via `openclaw mcp set`. Same JSON-blob shape as before, with backslash-escape workaround for PowerShell 5.1. After both are registered:

```powershell
openclaw mcp show windows-desktop-control
openclaw mcp show browser-control
openclaw gateway stop ; <restart>
```

### 8.6 Acceptance

Three golden paths must succeed:

| Prompt | Tool Claude should pick | What happens |
|---|---|---|
| "What's in C:\Users\cheth\Desktop?" | OpenClaw shell | `ls` runs, results in chat |
| "Open Calculator and compute 12 × 9" | `run_desktop_task` (UFO²) | UFO² opens Calc, types, returns "108" |
| "Go to https://www.livechat.com/typing-speed-test/ and take the test" | `run_browser_task` (browser-use) | Browser opens, browser-use finds the input, types real key events, surfaces WPM |

Each must show the correct tool chip in Dex's conversation surface. The typing test in particular is the smoke-test for this whole phase — it's the task v1 failed on.

## Phase 9 — Tool selection UI (Gemini-style chips)

**Goal:** make tool selection visible in the conversation so the user sees Claude's routing decisions live.

### 9.1 The chip widget

The conversation store already tracks tool calls via `_applyToolCall` / `_applyToolResult` (added during the post-v1 debug pass). The action card it renders is fine but undersells the routing story. Upgrade:

- **New widget** `app/lib/widgets/tool_chip.dart` — a compact `[icon] tool: <friendly-name> → <short goal>` row that renders inline in the conversation, NOT as a full Action card.
- **Friendly name mapping** in one place (e.g. `lib/core/tool_registry.dart`):
  ```dart
  {
    'windows-desktop-control': ('Windows app', Icons.desktop_windows),
    'browser-control':         ('Browser',     Icons.public),
    'bash':                    ('Shell',       Icons.terminal),
    'read':                    ('File read',   Icons.description),
    'write':                   ('File write',  Icons.edit_document),
    // unknown tools fall back to their raw id + a generic icon
  }
  ```
- The existing "Action" card stays — it's used for richer tool *results* (a step list from UFO²). The chip is for the inline *call announcement*.

### 9.2 State changes

Minimal: in `conversation_store.dart`, when a `toolCall` event arrives, instead of (only) appending an Action message, also append a lightweight chip message (`MessageSpeaker.toolChip` — new enum value). The chip flips its state to `done` / `failed` when the matching `toolResult` arrives, same correlation pattern that's already there.

### 9.3 Routing trace on hover (optional polish)

A tooltip over the chip shows the agent's reasoning fragment that led to the choice ("picked browser-control because the goal references livechat.com"). This makes the "Gemini selecting nano-banana" feel complete. Pull the reasoning text from the streaming chat content immediately preceding the toolCall event. **Cut from v1.1 scope if time-pressed; chip alone is enough.**

### 9.4 Acceptance

Three back-to-back prompts in one session:
1. "List my desktop." → tool chip says `Shell  ·  ls Desktop`
2. "Open Calculator and compute 12 × 9." → tool chip says `Windows app  ·  Calculator: 12 × 9`
3. "Take this typing test: https://livechat.com/typing-speed-test/" → tool chip says `Browser  ·  livechat.com typing test`

Each chip transitions from `running` → `done` (or `failed`) with a 160ms color cross-fade, matching the design.md motion budget.

## Files this phase touches

- `D:\project1\vendor\browser-use\` (new, vendored read-only)
- `D:\project1\glue\browser-control\server.py` (new — the MCP glue)
- `D:\project1\glue\browser-control\SKILL.md` (new — Claude's routing prompt)
- `D:\project1\glue\browser-control\requirements.txt` (new)
- `D:\project1\glue\windows-desktop-control\SKILL.md` (edit — add cross-reference)
- `D:\project1\scripts\install-skill.ps1` → rename to `install-skills.ps1` (edit — register both servers)
- `D:\project1\app\lib\widgets\tool_chip.dart` (new)
- `D:\project1\app\lib\core\tool_registry.dart` (new — friendly-name map)
- `D:\project1\app\lib\core\models\message.dart` (edit — add `MessageSpeaker.toolChip`)
- `D:\project1\app\lib\core\state\conversation_store.dart` (edit — emit chip on toolCall)
- `D:\project1\app\lib\screens\home_desktop.dart` (edit — render chips inline)
- `D:\project1\LICENSES.md` (edit — add browser-use MIT row + Playwright row)
- `D:\project1\PLAN.md` (edit — add Phase 8/9 progress entries)
- `D:\project1\README.md` (edit — update arch diagram with the third tool family)

## Risks specific to this phase

1. **Qwen 3 may not be strong enough for browser-use.** browser-use was tuned against GPT-4 / Claude. Mitigation: same `engine` flag pattern we used for UFO² — keep a one-line config flip to Claude in `server.py`. If Qwen 3 fails too often in real use, swap it.
2. **Playwright's Chromium download fails on metered/restricted networks.** Mitigation: `install-skills.ps1` prints a clear "this will download ~150 MB the first time" warning before running `playwright install`.
3. **browser-use API may have changed since the web-fetch.** Mitigation: read `vendor/browser-use/README.md` end-to-end after cloning (the same "do not hallucinate" rule that drove Phases 1-2). Pin the commit so future updates don't break us.
4. **Two browsers can collide.** If the user is already on Vivaldi/Chrome and `run_browser_task` opens a new Chromium window, that's actually fine (Playwright uses its own profile). But if the user has Vivaldi DevTools open hooked to the same port, weirdness. Mitigation: browser-use spawns its own isolated Chromium by default — document that in SECURITY.md.
5. **Chip noise.** Long sessions could fill the conversation with chips. Mitigation: group consecutive chips from the same tool into a single "[Browser] 4 steps" line after they all complete. Defer to v1.2 if needed.

## Roadmap (NOT v1.1)

- **agent-zero**: revisit only if a user wants sandboxed/destructive experimentation or Linux-only GUI work. Document the integration shape (another MCP server) but don't build it.
- **Auto-routing without SKILL.md**: a meta-agent that reads the task and picks the tool family before invoking Claude. Premature — Claude's own tool selection is good enough.
- **Per-tool LLM tuning**: small router LLM (Qwen 3) decides, big LLM (Claude) executes. Performance optimization; revisit if latency stays bad.

## Verification (end-to-end)

```powershell
# 0. Prereq: Phase 7 stack is up and Phase 8 setup ran
.\scripts\install-skills.ps1                    # registers both MCP servers
openclaw gateway stop ; <restart>
D:\project1\app\build\windows\x64\runner\Debug\dex.exe

# 1. Routing smoke (in Dex):
#    "list my desktop"                          → chip: Shell
#    "compute 12 x 9 in Calculator"             → chip: Windows app
#    "take typing test at livechat.com/typing-speed-test"  → chip: Browser

# 2. Failure modes are visible:
#    Kill the browser mid-task → chip flips to failed (red), agent surfaces the error
#    Refusal pattern in goal → chip never appears; agent explains refusal in prose
```

## Progress log (append to bottom of PLAN.md)

- [ ] Phase 8 — browser-control vendored, venv built, MCP server wired, SKILL.md routes, both MCPs registered
- [ ] Phase 9 — tool chip widget, friendly-name registry, conversation store emits chips, three-route smoke passes

---

# v1.2 — Live Action surface + interrupt + Windows chrome

## Context

v1.1 shipped: chat works, tool routing works, chips visible. Two real-session pains drive v1.2:

1. **"Thinking…" is opaque.** Long Windows tasks (DNS panel, multi-app workflows) idle on `thinking…` for minutes with no signal about *what* the agent is doing or *which tool* it's about to use. The user can't tell flailing apart from working.
2. **No stop.** When the agent picks the wrong path (typing-test JS injection, deep Settings nav that's clearly going nowhere) the user has no way to interrupt — they have to wait for timeout. That's expensive both in tokens and in patience.
3. **Scheduled actions are invisible.** When the agent says "I'll open vtop.vit.ac.in at 12:17 PM and remember it" the user has no UI affordance to verify it's actually scheduled — just trust the prose. A future-time card in the Live panel fixes this.
4. **No tray, no global hotkey.** Closing the window kills the app; bringing it back means re-launching cold. There's no Spotlight-style summon.

Locked decisions (from this turn): action surface + Windows chrome ship as v1.2; per-platform UI + mobile QR pairing ship separately as v1.3. Close-to-tray is the default with a setting to override.

## Architecture (where the new UI bits land)

```
┌─────────────────────────────────────────────────────────────────┐
│  Dex window  (Windows desktop, v1.2 chrome layer)               │
│                                                                 │
│  ┌─────────────────────────────┬─────────────────────────────┐  │
│  │  CONVERSATION  (left)       │  LIVE  (right, rebuilt v1.2)│  │
│  │  - tool chips (v1.1)        │                             │  │
│  │  - messages                 │  ┌───────────────────────┐  │  │
│  │  - command bar              │  │ Now                   │  │  │
│  │                             │  │ ├─ running:  Browser  │  │  │
│  │  + STOP button when ┐       │  │ │  livechat typing... │  │  │
│  │    state=acting     │       │  │ └─ STAGE chip         │  │  │
│  │                     │       │  └───────────────────────┘  │  │
│  │                     │       │  ┌───────────────────────┐  │  │
│  │                     │       │  │ Pending approval      │  │  │
│  │  ↓ chat.abort       │       │  │ (amber-border card)   │  │  │
│  │                     │       │  └───────────────────────┘  │  │
│  │                     │       │  ┌───────────────────────┐  │  │
│  │                     │       │  │ Scheduled (NEW v1.2)  │  │  │
│  │                     │       │  │ 12:17 PM · vtop open  │  │  │
│  │                     │       │  │ + 2 other scheduled   │  │  │
│  │                     │       │  └───────────────────────┘  │  │
│  └─────────────────────────────┴─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
       │                                              │
       │ X (close) → window_manager intercepts        │ Ctrl+K (global)
       ▼                                              ▼
   ┌──────────────┐                          ┌─────────────────────┐
   │ System tray  │                          │ Spotlight-style     │
   │ icon + menu  │                          │ overlay (centered,  │
   │ (Show/Quit)  │                          │ blurred, mono input)│
   └──────────────┘                          └─────────────────────┘
```

## Phase 10 — Live Action surface rebuild

### 10.1 Action model

The Live panel currently shows only `ActionPreview` (pending approval) or "no pending action". Replace with a stack of typed entries so running, pending, scheduled, and recently-completed actions all have a visual home.

New file: `app/lib/core/models/live_entry.dart`:
```dart
enum LiveEntryKind { running, pending, scheduled, recent }

class LiveEntry {
  final String id;
  final LiveEntryKind kind;
  final String toolId;           // routes through tool_registry for icon + name
  final String summary;          // one-line: "open vtop.vit.ac.in"
  final DateTime? scheduledFor;  // only for scheduled
  final String? callId;          // correlates to the chip + Action card
  // ... + state for running entries (stage, etc.)
}
```

`ConversationStore` becomes the source of truth for the live list. The current `pending` field becomes the first `LiveEntry` of kind `pending`; tool calls in flight become `running`; scheduled tasks emitted by the agent become `scheduled` (parsed from the chat stream — see 10.5); completed entries decay into `recent` for ~30 s then disappear.

### 10.2 Block UI

Rebuild `_LivePanel` in `home_desktop.dart` around `LiveEntry` cards. Each kind has its own block style — same vocabulary as the chip widget, scaled up:

- **running**: surface card, mono summary, breathing dot, tool-stage indicator (see 10.3), inline `Stop` button.
- **pending**: keeps the amber-border `ActionPreviewCard` we already have. Just slotted into the new stack.
- **scheduled**: surface card with `[clock-icon] 12:17 PM · today · open vtop.vit.ac.in` plus a `Cancel` button. Color: `--accent-quiet` (dim blue).
- **recent**: collapsed mono one-liner with the result glyph (`OK` / `X` / `-`); fades out at 30 s.

v1.2 implementation uses the existing token vocabulary directly (raw `Container` + `tokens.dart`). The platform-flavored versions arrive in Phase 12 (`shadcn_ui` `Card` on Windows/Linux, `CNCard`-style surface on macOS, m3e card on Android).

### 10.3 Tool-stage indicator

Replace the bare "thinking…" with discrete, named stages so the user can read the agent's progress at a glance:

```
selecting → refining → acting → done
   │           │          │
   │           │          └─ tool is running (chip + Action card live)
   │           └─ tool picked, agent is constructing the call
   └─ Claude is deciding which tool family to use
```

How we know which stage we're in:
- **selecting**: streaming reply contains tool-name signals (e.g. "I'll use", "let me call", or any chip about to land). Approximate detection by watching for `toolCall` events being imminent.
- **refining**: an agent message is streaming AND the last token mentions a tool name AND no toolCall has fired yet. A short-lived state (1–3 s usually).
- **acting**: at least one `toolCall` for this turn has fired; flips back as soon as `toolResult` lands for the last in-flight call.
- **done**: no in-flight tool calls and the final agent message has streamed.

Render this stage word right next to the breathing dot in the conversation header (today it just shows the bare `AgentState` word). Replace the existing `agent_status_pill.dart` text with the more specific stage; keep the dot color the same so the existing animation still reads right.

State transitions live in `ConversationStore` — a `stage: ToolStage` field that the home screen reads. Existing `AgentState` enum is renamed `AgentLifecycle` (idle/active/error) so it doesn't overload "thinking" with both meanings.

### 10.4 Stop button (interrupt)

Add `chat.abort` to `GatewayClient` (verified shape from `vendor/openclaw/packages/gateway-protocol/src/schema/logs-chat.ts:92-99` — `ChatAbortParamsSchema` with `sessionKey, agentId?, runId?`):
```dart
Future<void> abort({String? runId}) async {
  // POSTs a chat.abort req frame with the most recent runId from
  // ConversationStore. If no runId, omit -- the gateway aborts the
  // current run for our sessionKey.
}
```

UI: a `Stop` button that appears in the conversation header (and inline on running `LiveEntry` cards) whenever `_state` is `acting` or there is an in-flight `runId`. Color: `--error`. Pressing it:
1. Calls `client.abort(runId: <currentRunId>)`.
2. Flips the matching `running` LiveEntry + chip + Action card to `failed` immediately (don't wait for server confirm — server-side abort is best-effort).
3. Sets `AgentLifecycle.idle`.

The aborted text in the streaming agent bubble stays as-is so the user can see *what was being said*.

### 10.5 Scheduled actions surface

The agent sometimes says "I'll do X at Y" without any structural commitment in the protocol. Heuristic surface for v1.2:

A small parser on the agent's final reply (`ConversationStore._maybeExtractSchedule`) looks for patterns like `at 12:17`, `at 4pm`, `in 5 minutes`, `tomorrow at`, paired with an action verb (`open`, `run`, `send`, `schedule`). When matched, emit a `LiveEntry.scheduled` with the parsed `DateTime`. This is a v1.2 stopgap — v2 would do this server-side via OpenClaw's actual cron tool.

Cancellation: clicking `Cancel` on a scheduled entry sends `chat.inject('Cancel the scheduled action: <summary>.')` to OpenClaw so the brain knows the user changed their mind. v1.2 doesn't try to reach into OpenClaw's cron state directly — convention over machinery.

### 10.6 Acceptance

1. Type a long task ("open Settings, change DNS to 1.1.1.1"). Watch the conversation header cycle `selecting → refining → acting → done`. The `Stop` button is visible during `acting`.
2. Press Stop mid-run. The running LiveEntry flips to `failed`. The streaming bubble shows whatever text had landed.
3. Type "open vtop.vit.ac.in at HH:MM today" (a near-future time). A scheduled card appears in the Live panel with the right time. Cancel it; the card vanishes and a confirmation message lands in chat.

## Phase 11 — Windows desktop chrome

### 11.1 Close-to-tray

Add `window_manager: ^0.3` + `system_tray: ^2.0` to `pubspec.yaml`. In `main.dart`:
1. `await WindowManager.instance.setPreventClose(true)` — intercept the X.
2. Implement `WindowListener.onWindowClose` → call `windowManager.hide()`.
3. Initialize a tray icon with `SystemTray.initSystemTray(title: 'Dex', iconPath: 'assets/tray/dex.ico')`. Build a menu via `Menu.buildFrom([MenuItemLabel(label: 'Show Dex', onClicked: ...), MenuSeparator(), MenuItemLabel(label: 'Quit', onClicked: ...)])`.
4. Single-click tray → show window. Right-click → menu.

New file: `app/lib/platform/win/tray.dart` so the tray bits are not in `main.dart`.

### 11.2 Setting toggle (close → minimize vs close → quit)

Per the user's pick: minimize-to-tray is the default. A small persisted preference (`shared_preferences`) lets the user flip it. v1.2 surfaces this through a Settings entry in the tray menu rather than a full settings screen — `MenuItemCheckbox(label: 'Quit on close', checked: prefs.exitOnClose)`.

### 11.3 Ctrl+K Spotlight overlay

Add `hotkey_manager: ^0.2` to `pubspec.yaml`. In `main.dart`:
```dart
final hk = HotKey(
  key: PhysicalKeyboardKey.keyK,
  modifiers: [HotKeyModifier.control],   // Cmd on macOS in Phase 12
  scope: HotKeyScope.system,             // system-wide, even when hidden
);
await hotKeyManager.register(hk, keyDownHandler: (_) => SpotlightOverlay.show(rootContext));
```

New widget `app/lib/widgets/spotlight_overlay.dart`:
- Renders as a `BarrierDismissible` modal centered on screen (use existing `BackdropFilter` budget — this is one of the two allowed surfaces; the floating command bar in the main window is the other, but they can't be visible together so the budget holds).
- 560-wide mono input, hint `"command Dex..."`, Enter submits.
- Esc dismisses. Submitting bubbles the prompt to the existing `ConversationStore.sendHumanMessage` (re-show the main window first).
- If Dex is hidden in the tray, the overlay also brings the main window back so the streamed reply is visible.

### 11.4 Acceptance

1. Launch Dex, hit X. Window disappears, tray icon stays. Single-click tray → window returns to the same state.
2. Right-click tray → "Quit" → process exits cleanly.
3. Right-click tray → check "Quit on close". Hit X again → process exits.
4. From any app, press Ctrl+K. The Spotlight overlay appears centered. Type "hi", Enter. Window unhides, "hi" sent, Claude streams a reply.
5. Press Esc on overlay → it dismisses without sending.

## v1.2 — Files touched

```
NEW
  app/lib/core/models/live_entry.dart
  app/lib/widgets/spotlight_overlay.dart
  app/lib/widgets/stop_button.dart
  app/lib/widgets/scheduled_entry_card.dart        (could fold into live_entry_card)
  app/lib/widgets/live_entry_card.dart             (running / pending / scheduled / recent)
  app/lib/platform/win/tray.dart
  app/lib/platform/win/hotkey.dart
  assets/tray/dex.ico                              (16x16 + 32x32 ICO)

EDIT
  app/pubspec.yaml                                  (+ window_manager, system_tray, hotkey_manager, shared_preferences)
  app/lib/main.dart                                 (init tray + hotkey before runApp)
  app/lib/core/gateway_client.dart                  (+ abort())
  app/lib/core/state/conversation_store.dart        (+ stage, + abort path, + LiveEntry list, + schedule parser)
  app/lib/core/models/agent_state.dart              (rename to AgentLifecycle, narrow values)
  app/lib/widgets/agent_status_pill.dart            (show stage word, not bare state)
  app/lib/screens/home_desktop.dart                 (live panel rebuild around LiveEntry stack)
  app/lib/widgets/action_preview_card.dart          (slot into LiveEntry, no other change)
  app/lib/widgets/message_agent_prose.dart          (use stage-aware thinking indicator)
  D:\project1\PLAN.md                               (Phase 10/11 entries)
  D:\project1\SECURITY.md                           (note: hotkey is system-scope; document key)
```

## v1.2 — Risks

1. **Stage detection is heuristic and noisy.** Streaming text + event timing isn't a clean signal for "selecting" vs "refining". Mitigation: fall back to plain "thinking" if heuristics disagree; never block on a stage transition.
2. **Schedule regex misfires.** "I'll do this at most twice" matches `at` + a number. Mitigation: a stoplist (`at most`, `at least`, `at best`) and require the verb to come first ("open … at 12:17", not "at 12:17 open …" — though we'll accept that too). Worst case: an extra scheduled card the user dismisses.
3. **`chat.abort` doesn't actually interrupt a running tool.** OpenClaw aborts the LLM stream but a subprocess (UFO² / browser-use) may keep running until it finishes its current step. Mitigation: chip + LiveEntry flip to `failed` immediately on user click so the UI is honest; the subprocess wind-down is a separate v1.3 item.
4. **System tray icon assets.** `system_tray` needs a Windows ICO; if missing the init throws. Bundle a 16x16 + 32x32 multi-resolution ICO under `assets/tray/dex.ico`. Provide a quick `make-tray-icon.ps1` that generates it from any source PNG via `magick` (ImageMagick) if installed; otherwise document the manual conversion.
5. **Spotlight overlay race vs hidden window.** If the window is hidden and Spotlight summons it, the focus order can be janky on Windows. Mitigation: `windowManager.show()` then `windowManager.focus()` then `showDialog` — in that order, with a 50 ms gap on the focus call if Windows misbehaves.

## v1.2 — Verification

```powershell
# 1. Live action surface
#    Type a long task -> conversation header cycles selecting -> refining -> acting -> done
#    Stop button visible during acting; click it -> entry flips to failed, stream halts
#    Type "open vtop.vit.ac.in at 4pm" -> scheduled card appears in Live panel with 4pm

# 2. Windows chrome
#    X -> window hides, tray icon visible
#    Single-click tray -> window restores
#    Right-click tray -> Quit -> process exits with rc 0
#    Ctrl+K from any app -> overlay appears centered, mono input focused
```

## v1.2 — Progress log

- [ ] Phase 10 — `LiveEntry` model, block-UI Live panel, tool-stage indicator, `Stop` button (`chat.abort`), scheduled-action parser + card, Cancel-scheduled wiring
- [x] Phase 11 — close-intercept + tray icon + menu + system-scope
            Ctrl+K Spotlight all shipped 2026-06-08 (window_manager +
            tray_manager + shared_preferences + hotkey_manager).
            SpotlightOverlay is the second BackdropFilter surface
            (CommandBar is the first, never visible together).

---

# v1.3 — Per-platform UI + Mobile companion

## Context

v1.2 polishes the Windows desktop. v1.3 takes Dex multi-platform and multi-device:

1. **Platform decoupling.** A Material card on macOS and a Cupertino slider on Windows both feel wrong. The user's call: each platform gets its own widget kit; tokens (color, type, motion) stay shared so the *vocabulary* is consistent. Hux + shadcn_ui on Windows/Linux, `cupertino_native` on macOS/iOS, M3-Expressive (`m3e_collection` + `expressive_refresh` + `dynamic_color`) on Android.
2. **Mobile companion.** Dex should be summonable from a phone — type a prompt, it executes on the desktop. No login, no Firebase. The phone pairs over LAN via a QR code that bakes in a one-time token + the desktop's LAN address; thereafter the phone speaks the same OpenClaw gateway protocol over a thin LAN relay the desktop hosts.

## Architecture (per-platform widget kits, mobile relay)

```
                       SHARED: tokens.dart (color, type, motion, radius, space)
                       SHARED: gateway_client.dart, conversation_store.dart, models/
                       SHARED: tool_registry.dart
                                            │
       ┌────────────────────────────────────┼────────────────────────────────────┐
       ▼                  ▼                 ▼                 ▼                   ▼
   Windows + Linux      macOS            iOS              Android             Mobile↔Desktop
   widget kit         widget kit       widget kit       widget kit              pairing
                                                                                  │
   hux (primary)    cupertino_native  cupertino_native  m3e_collection      Desktop relay
   shadcn_ui          (CN*, liquid     (CN*, liquid     + expressive_refresh on LAN port 18790,
   (Card, Dialog,    glass, vibrancy)  glass, vibrancy)  + dynamic_color    auth = QR token
   Sheet for                                              (M3 Expressive)
   pending/sched)                                                            QR generated on
                                                                             desktop, scanned
                                                                             on phone

   ─────────────────────── tokens are the consistency boundary ───────────────────────
```

## Phase 12 — Per-platform UI flavors

### 12.1 Platform abstraction

A thin set of generic widget interfaces in `app/lib/platform/_abstract/`:
- `DexCard({title, body, badge, onTap})`
- `DexButton.primary / .secondary / .ghost({onPressed, child})`
- `DexTextField({controller, hint, onSubmit})`
- `DexSheet({child})` — modal/bottom-sheet/right-pane
- `DexSurface({elevation, child})` — what a "raised surface" means on this platform (glass on macOS, m3 surface tint on Android, Hux card on Win/Linux)

Each platform implements them under `app/lib/platform/win/`, `mac/`, `ios/`, `linux/`, `android/`. A small factory at `app/lib/platform/dex_widgets.dart` picks the right implementation at boot based on `Theme.of(context).platform` (testable via `MediaQuery`).

Tokens (`tokens.dart`) drive *all* platform implementations — Hux's `HuxButton` for example wraps with a fitted `Container(decoration: BoxDecoration(color: DexColors.accent, …))` so the same accent color lands on Win/Linux and Android even though the widget kit is different.

Existing widgets (`tool_chip.dart`, `live_entry_card.dart`, `action_preview_card.dart`, `command_bar.dart`, `agent_status_pill.dart`) get refactored to call `DexCard` / `DexButton` / `DexSurface` instead of raw `Container` + `BorderRadius`. **The widget files themselves stay platform-agnostic.** Only the abstraction layer is platform-specific.

### 12.2 Windows + Linux (Hux + shadcn_ui)

- `DexButton` → `HuxButton` (uses Hux's primary/secondary/outline/ghost variants — verified from pub.dev: `hux` exposes `HuxButton`, `HuxCard`, `HuxInput`, `HuxDialog`, `HuxSwitch`, `HuxLoadingOverlay` among others).
- `DexCard` → for *normal* surfaces use `HuxCard`. For the **scheduled-action + pending-approval + tool-chip stack in the Live panel**, use **`shadcn_ui` `Card` + `Badge`** to get the dense, neat dashboard look the user asked for (verified from pub.dev: `shadcn_ui` exposes `Card`, `Button`, `Badge`, `Dialog`, `Input`, `Sheet`, `Table`, `Tabs`).
- `DexTextField` → `HuxInput` for chat command bar.
- `DexSheet` → `shadcn_ui`'s `Sheet` for right-pane content; `HuxBottomSheet` for transient confirmations.
- Linux can reuse the Windows kit unchanged — these packages cover both. No `DexLinuxButton` separate.

### 12.3 macOS + iOS (`cupertino_native`)

- `DexButton` → `CNButton`; icon variants via `CNIcon` (SF Symbols).
- `DexSlider` (used by future settings) → `CNSlider`.
- `DexTabBar` (when we add a settings screen) → `CNTabBar`.
- `DexSurface` and `DexCard` → there's no `CNCard` in `cupertino_native`'s exposed surface (verified: only Slider/Switch/SegmentedControl/Button/Icon/PopupMenuButton/TabBar). We layer the **liquid-glass** effect ourselves: a `BackdropFilter(blur=14) + Container(color: ...withAlpha(0.55))` wrapped in `DexCard.macOS` — this matches the "Liquid Glass" styling the package itself uses on its primitives. Phase 12 commits the budget for the glass surface as one of the two allowed `BackdropFilter` slots on macOS/iOS.
- iOS minimum: 14.0; macOS minimum: 11.0 (verified from pub.dev). Document in README.

### 12.4 Android (M3 Expressive)

- `DexButton` → `ButtonM3E.filled` / `.tonal` / `.outlined` (verified: `m3e_collection` exposes `ButtonM3E.filled` with 5 styles × 5 sizes).
- `DexCard` → plain `Material 3 Card` (M3 already has good cards; m3e_collection doesn't add card variants per pub.dev).
- `DexProgress` → m3e's morphing polygon loading indicator (a real differentiator vs vanilla M3).
- Pull-to-refresh in the conversation: `expressive_refresh` (verified: a Material-3-Expressive-styled `RefreshIndicator` replacement).
- Color seeds: wrap `MaterialApp` in `DynamicColorBuilder` (`dynamic_color` package) so the theme respects the Android wallpaper accent on Android S+. Harmonize Dex's accent + state tokens with the dynamic palette using `colorScheme.harmonized()`. (Verified API surface from pub.dev.)
- `material_color_utilities` is a transitive dep of `dynamic_color`; we don't import it directly in v1.3.

### 12.5 Typography stays shared

`tokens.dart` keeps Geist + Geist Mono as the type stack across *all* platforms. We don't switch to SF or Roboto per platform — that's a design call from `design.md` we keep. Fallback chain in `tokens.dart` already has the platform-native fonts after Geist; if Geist isn't bundled the platform falls back natively.

Visibility/contrast: same tokens, same WCAG 4.5:1 budget. No per-platform contrast drift.

### 12.6 Acceptance

Build for each platform; smoke-check the conversation surface renders correctly:

```bash
flutter run -d windows     # → Hux + shadcn surfaces
flutter run -d macos       # → liquid-glass surfaces + CN controls
flutter run -d linux       # → Hux (no shadcn-flavor difference from Windows)
flutter run -d android     # → M3 Expressive, dynamic accent from wallpaper
```

Each build must:
1. Render the chat with the same color tokens (compare a screenshot side-by-side: the agent state pill is identical-hue across platforms).
2. Show the platform-flavored card style for the Live panel's scheduled-actions list.
3. Pass the existing widget tests with the platform abstraction in place.

## Phase 13 — Mobile companion + QR pairing

### 13.1 Pairing model

No login. No Firebase. LAN-only:

```
Desktop                                                          Phone
─────────                                                       ─────────
1. User clicks "Pair phone" in tray menu.
2. Desktop generates a 32-byte session token (cryptographic random).
3. Desktop binds a LAN relay on port 18790 (configurable).        ┌───────────────────┐
4. Desktop renders QR encoding:                                   │ Mobile scans QR   │
     dex+lan://<lan-ip>:18790?t=<hex32>&exp=<unix>                │ (mobile_scanner)  │
   `exp` = 5 minutes in the future (token validity window).       └─────────┬─────────┘
5. Desktop displays QR on-screen.                                            │
                                                                              ▼
6. Desktop relay accepts a single TLS-less WS upgrade           Phone POSTs WS upgrade
   from <lan-ip> only (refuses 0.0.0.0 connections).             with header X-Dex-Token
7. Verifies token constant-time match + not expired.             Receives 101 Switching
8. Stores phone fingerprint (random per pair) in                 Protocols.
   ~/.dex/pairings.json so re-pairs are optional.
9. From here, forwards every WS message between phone and the
   OpenClaw gateway (auth token NOT exposed to phone -- desktop
   relay handles gateway auth on its behalf).
```

Token in QR is the *pairing* secret — used once to establish the WebSocket. After connection, a per-session HMAC of `(deviceFingerprint || sessionKey)` is used as a continuation token saved in iOS keychain / Android keystore. So one QR scan = paired forever (until the user revokes).

Revocation: a "Paired devices" entry in the tray menu lists fingerprints and lets the user remove any of them, which deletes that line from `pairings.json`.

### 13.2 Desktop relay

New: `D:\project1\dex-relay\` — a tiny Dart server (no Python). Reuses Flutter's `dart:io` `HttpServer` since Flutter ships Dart anyway. Two endpoints:
- `WS /pair` — accept first connection with `X-Dex-Token` matching the active pairing token; respond with a continuation token; remember the device fingerprint.
- `WS /` — accept connections with continuation-token auth; forward to `ws://127.0.0.1:18789` as a transparent proxy (with the desktop's stored gateway auth token in the connect frame; phone never sees it).

Run as a Flutter isolate spawned at app start when the user has at least one pairing OR has "Pair phone" open. Idle otherwise. No system service; lives only as long as the Dex window does.

### 13.3 QR generation (desktop)

`qr_flutter`'s `QrImageView(data: <dex+lan://...>, size: 320)` rendered in a `DexCard` overlay opened from the tray "Pair phone…" menu. Includes a countdown ("token expires in 4:38") and a Regenerate button.

### 13.4 Mobile app

A new Flutter build target `dex` already builds for Android (responsive code is in `app/`). Phase 13 adds:
- `app/lib/screens/home_mobile.dart` — single-pane chat (no left rail, no right Live panel; Live entries collapse into an expandable bottom sheet).
- `app/lib/screens/pair.dart` — `MobileScanner` view; on QR detection, parse `dex+lan://...`, store fingerprint + continuation token, navigate to the chat home.
- The shared `gateway_client.dart` accepts a `Uri` so we point it at the desktop relay (`ws://<lan-ip>:18790/`) instead of `ws://127.0.0.1:18789/`.
- iOS scaffold but we don't ship to App Store — `flutter run -d <iphone>` on a paired Mac. Same code.

`mobile_scanner` is mobile-only (verified: Android/iOS/macOS/Web; no Linux/Windows). The desktop never needs to scan; this is fine.

### 13.5 Mobile-specific UI shape

- Phone screens use the Android M3-Expressive flavor from Phase 12.4. iOS uses the cupertino_native flavor from 12.3.
- The Live panel collapses to a single FAB-ish chip ("2 running") that opens a bottom sheet listing entries.
- The Spotlight Ctrl+K overlay isn't relevant on mobile — there's no global hotkey. Instead, the home screen's top app bar has a permanent mono input.

### 13.6 Acceptance

1. Tray → "Pair phone". A QR appears with a 5-minute countdown.
2. Phone opens Dex app → Scan QR. QR is decoded; phone connects to relay; confirmation in phone UI.
3. Phone types "open notepad". Within 2 s, the desktop window pops out of tray (if hidden), the prompt streams into the desktop chat, and the agent runs.
4. Desktop tray → "Paired devices" → 1 paired (with a name like "iPhone — paired 2 min ago"). Click Remove. Phone gets "connection lost" on its next message.

## v1.3 — Files touched

```
NEW
  app/lib/platform/_abstract/dex_card.dart
  app/lib/platform/_abstract/dex_button.dart
  app/lib/platform/_abstract/dex_text_field.dart
  app/lib/platform/_abstract/dex_sheet.dart
  app/lib/platform/_abstract/dex_surface.dart
  app/lib/platform/dex_widgets.dart                 (factory: pick per platform)
  app/lib/platform/win/widgets.dart                 (Hux + shadcn impls)
  app/lib/platform/mac/widgets.dart                 (cupertino_native + glass)
  app/lib/platform/ios/widgets.dart                 (re-exports mac/ with mobile tweaks)
  app/lib/platform/linux/widgets.dart               (re-exports win/)
  app/lib/platform/android/widgets.dart             (m3e_collection + dynamic_color)
  app/lib/screens/home_mobile.dart
  app/lib/screens/pair.dart
  app/lib/core/pairing/pairing_store.dart           (continuation tokens, fingerprints)
  app/lib/core/pairing/relay_client.dart            (mobile -> ws://lan-ip:18790)
  dex-relay/                                        (new Dart-only project; tiny WS proxy)
  dex-relay/bin/relay.dart
  dex-relay/lib/qr.dart
  dex-relay/lib/auth.dart

EDIT
  app/pubspec.yaml                                  (+ hux, shadcn_ui, cupertino_native,
                                                     m3e_collection, expressive_refresh,
                                                     dynamic_color, qr_flutter, mobile_scanner)
  app/lib/widgets/*.dart                            (refactor to call DexCard/Button/etc.)
  app/lib/screens/home_desktop.dart                 (use DexCard for Live entries)
  app/lib/main.dart                                 (mobile route; pairing startup)
  D:\project1\README.md                             (platform support matrix + pairing flow)
  D:\project1\SECURITY.md                           (pairing token, LAN scope, revocation)
  D:\project1\LICENSES.md                           (add all 8 new dep rows)
```

## v1.3 — Risks

1. **Refactor blast radius.** Wrapping every existing widget in the `DexCard`/`DexButton` abstraction touches ~10 files. Mitigation: do one widget end-to-end (`tool_chip.dart`) first, smoke-test on all 4 platforms, *then* expand. If the abstraction needs reshaping, only one widget gets reworked.
2. **`cupertino_native` is young (BSD-3, v0.1.x).** API may churn. Mitigation: pin the version; keep our `DexButton.macOS` wrapper thin enough that swapping `CNButton` → raw `CupertinoButton + glass` is a single-file edit if cupertino_native shifts.
3. **shadcn_ui's "incomplete components" list.** Per pub.dev: `Carousel`, `Collapsible`, `Command`, `DataTable`, `Drawer`, `NavigationMenu`, `Pagination`, `Skeleton`, `Toggle`, `ToggleGroup` are not yet implemented. Mitigation: don't depend on these — we only need `Card`, `Button`, `Badge`, `Dialog`, `Sheet`, `Tabs`, `Input`, all of which are implemented.
4. **LAN pairing is only as secure as the LAN.** Anyone on the same Wi-Fi who guesses the token (5-min window, 32-byte secret = ~10^77 entropy — effectively unguessable) could connect; anyone with packet capture could potentially MITM (no TLS). Mitigation: refuse non-loopback non-private-IP connections; warn loudly in `SECURITY.md`; v1.4 candidate: optional TLS via mkcert-generated cert pinned in the QR.
5. **Dual M3 builds (M3 Expressive on Android + plain M3 on web/elsewhere) drift.** Mitigation: only target Android with M3 Expressive in v1.3; web/embedded gets vanilla M3 (and we don't actively support either yet).
6. **`hotkey_manager` and `system_tray` may conflict on Linux** (different X11 paths). Mitigation: smoke-test on a Linux VM before shipping; if it breaks, document as a known-issue and gate the tray under `Platform.isWindows` first.

## v1.3 — Verification

```powershell
# Multi-platform build smoke
flutter build windows -t lib/main.dart
flutter build linux   -t lib/main.dart
flutter build macos   -t lib/main.dart
flutter build apk     -t lib/main.dart
flutter build ios     --no-codesign

# Pairing smoke
# On desktop: tray -> Pair phone -> QR appears
# On phone:   open Dex Mobile -> scan QR -> chat home loads
# Type "open notepad" on phone -> desktop runs it -> reply streams to BOTH surfaces
```

## v1.3 — Progress log

- [ ] Phase 12 — platform abstraction + four widget kits (Win/Linux=Hux+shadcn, macOS/iOS=cupertino_native+glass, Android=M3 Expressive), tokens preserved
- [ ] Phase 13 — desktop LAN relay (`dex-relay/`), QR pairing flow, mobile home + pair screens, end-to-end "phone → desktop runs" smoke

---

# Diagnostic — Why "open Wi-Fi DNS settings" failed in v1.1

You asked: was it the model or the tool, and what did Dex actually use?

**What ran:** Claude (the brain) picked `run_desktop_task` from `windows-desktop-control`. That MCP server subprocesses UFO² with Qwen 3 (text-only, UIA-grounded) driving it. So the LLM doing the per-click reasoning was Qwen 3, not Claude. Claude's only role was choosing the tool and narrating the result.

**Why it stopped halfway both times:**

1. **Deep nested Windows-11 Settings nav is hard without vision.** From "open Settings" to "Wi-Fi adapter's IPv4 DNS field" is roughly 8–12 UIA traversal steps: Settings → Network & Internet → Wi-Fi → Manage known networks → <network name> → Properties → DNS server assignment → Edit → Manual → IPv4 → DNS field. Modern Windows 11 Settings UIA tree shifts between screens; Qwen 3 has to re-read it every step and pick the next control by text alone (no screenshot). That's a long chain of text-grounded decisions and it loses the thread.

2. **Qwen 3 isn't great at multi-step UI plans.** It's tuned for short reasoning; the moment a task needs 8+ branched decisions in sequence with state recall, the agent starts hallucinating control names. We see this in the symptom you described — it half-navigates and gives up.

3. **MCP-side 120 s default timeout is too short** for a ~10-step UIA navigation. The "Desktop control is timing out" message you saw is *our* MCP timeout firing, not UFO² giving up internally.

**What the agent should have done:** for DNS specifically, just run a shell command. PowerShell has `netsh interface ip set dns name="Wi-Fi" static 1.1.1.1 primary` or `Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ServerAddresses ("1.1.1.1","1.0.0.1")`. Both are one-step, no GUI, and Claude could have used OpenClaw's built-in shell tool. The reason it didn't is that the SKILL.md for `windows-desktop-control` is more concrete and persuasive than the implicit "shell exists" prompt Claude has, so when the user says "open settings", Claude eagerly reaches for UFO².

**Three fixes baked into v1.2 / v1.3:**

- **(a) Bump timeout knob, surface it.** Phase 10 plumbs the MCP `timeout_s` arg through the tool-stage indicator UI so the user sees "long task ~3 min" and Claude can pass a larger value (default → 300 s for tasks that mention Settings / Control Panel).

- **(b) SKILL.md shortcut hints for shell-solvable tasks.** Add a "Prefer shell when possible" sub-section to `glue/windows-desktop-control/SKILL.md`:
  ```
  Before calling run_desktop_task, check if the goal is one of these
  shell-solvable patterns -- if so, use OpenClaw's bash/process tool
  instead, it's faster and more reliable:
    - DNS change   → netsh interface ip set dns ...
    - Service start/stop → Start-Service / Stop-Service
    - Env var get/set    → [Environment]::SetEnvironmentVariable(...)
    - Network adapter    → Set-NetIPInterface / Get-NetAdapter
    - Registry read      → reg query / Get-ItemProperty
    - Service install    → sc.exe ...
  ```
  Claude will see this on every turn and route the DNS-style asks to shell, not UFO².

- **(c) Vision fallback** — already designed in v1.1's `engine: "fast" | "vision"` knob. Bake an automatic vision-mode flip in `server.py` when the UIA tree depth crosses a threshold (more than 5 nested element walks for the same task). Vision (Claude) is slower and costs tokens but works on the deep nav cases Qwen 3 fails on. Not a Phase 10 deliverable — track as a v1.2.1 follow-up.

Once (a) and (b) are in, the DNS task should work either via shell shortcut (preferred, ~5 s) or via a longer-timeout UFO² run with Claude rather than Qwen 3 doing the grounding. Either way the chip will show *which* tool got picked, so you'll know in real time whether Dex is on a fast or slow path.

## Diagnostic progress log

- [ ] Add timeout knob to `run_desktop_task` SKILL.md description and lift default to 300 s for Settings/Control-Panel tasks (Phase 10)
- [ ] Add "Prefer shell when possible" patterns to `glue/windows-desktop-control/SKILL.md` (Phase 10)
- [ ] Vision auto-fallback after N UIA depth hits (deferred to v1.2.1; not in v1.2 scope)

---

# v1.4 — UnifiedAgenticCore + Flutter-native onboarding + full Settings surface

## Context

Until now, Dex has been a Flutter face on top of OpenClaw + UFO² + browser-use, but the setup story still leaks the seams: `npm install -g openclaw`, `openclaw onboard`, hand-edited `agents.yaml`, Groq keys hardcoded in vendor config. The user shouldn't have to know any of that exists.

v1.4 makes Dex feel like **one product**, not a stack:
1. **`UnifiedAgenticCore`** — a Dart-side façade that's the single API the UI talks to for anything model/tool/skill/gateway related. Internally it speaks OpenClaw's `config.patch` RPC and updates vendor config files; externally, the UI never sees the three underlying projects.
2. **First-run wizard inside Flutter** — replaces `openclaw onboard`. 4 steps for casual users, expandable into Advanced settings.
3. **Full Settings surface** — the user chose "all 30+ panels"; we group them under 6 nav sections so it stays navigable.
4. **No more hardcoded keys**. Anthropic + Groq keys live in OpenClaw's secrets store; vendor configs (`agents.yaml`) are regenerated from the unified config at apply-time.
5. **Both auth modes for Anthropic**: API-key paste + Claude Code OAuth (`claude-cli`).

Locked decisions this session:
- Both auth modes (API key + claude-cli OAuth).
- Full 30+ config panels (grouped 6 sections).
- Brand absorption is the goal, but a **source-level rename of `openclaw`** is split into v1.5 because the source-level pass is mechanical and big enough to risk the foundation work in v1.4.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Flutter UI                                                             │
│  - Onboarding wizard, chat, Settings (30+ panels)                       │
│  - Every read/write goes through ONE class:                             │
│                                                                         │
│    class UnifiedAgenticCore extends ChangeNotifier {                    │
│      Future<void> setAuthProfile(...)                                   │
│      Future<void> setModel(...)                                         │
│      Future<void> enableSkill(name, bool)                               │
│      Future<void> upsertMcpServer(name, McpServerConfig)                │
│      Future<void> setGatewayConfig(...)                                 │
│      Stream<CoreEvent> events                                           │
│      // ... one method per setting category                             │
│    }                                                                    │
└────────────────────────┬────────────────────────────────────────────────┘
                         │ config.patch / config.set / secrets.upsert
                         │ over the existing gateway WebSocket
                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  OpenClaw gateway (still Node 24, still vendored)                       │
│  - src/gateway/server-methods/config.ts:543-710                         │
│  - Validates Zod schema, hashes, writes ~/.openclaw/openclaw.json       │
└────────────────────────┬────────────────────────────────────────────────┘
                         │
                         ▼ MCP stdio
       ┌─────────────────────────────────────────────────────────────┐
       │  Vendor MCP servers (UFO², browser-use)                     │
       │  Read GROQ_API_KEY from env -- injected via                 │
       │  mcp.servers.<name>.env in openclaw.json                    │
       │  agents.yaml is REGENERATED from a template by Dex at apply │
       └─────────────────────────────────────────────────────────────┘
```

The critical seam: every setting the UI writes goes through `gateway.config.patch` (JSON Merge Patch, supports base-hash conflict detection — verified in `vendor/openclaw/src/gateway/server-methods/config.ts:543-710`). Vendor-side files like `agents.yaml` are *derived* from the unified config on every save, so the OpenClaw config remains the source of truth.

## Phase 14 — `UnifiedAgenticCore` + config-RPC transport

### 14.1 Gateway methods we'll call

Add to `app/lib/core/gateway_client.dart` — each method wraps `chat.send`-style RPC against the existing WebSocket:

```dart
Future<Map<String, dynamic>> configGet();          // -> calls config.get
Future<void> configPatch(Map<String, dynamic> patch, {String? baseHash});
Future<void> configSet(String rawJson5, {String? baseHash});
Future<void> secretsUpsert(String alias, String secret);
Future<List<String>> skillsList();                 // diagnostics endpoint
Future<List<String>> mcpList();                    // openclaw mcp list, but RPC
```

Verified shapes from `src/gateway/server-methods/config.ts:543-710`. `config.patch` is idempotent + safe for partial updates — the UI's primary write path.

### 14.2 The Core class

New `app/lib/core/agentic_core.dart`:

```dart
class UnifiedAgenticCore extends ChangeNotifier {
  UnifiedAgenticCore(this._gateway);
  final GatewayClient _gateway;

  // Snapshot of the live OpenClaw config, refreshed on changes.
  Map<String, dynamic> _config = {};
  Map<String, dynamic> get config => Map.unmodifiable(_config);

  // Typed views, computed from _config. Each one mirrors a Settings panel.
  ModelState get model;             // current model + auth profile + fallbacks
  List<McpServerView> get tools;    // mcp.servers.* with friendly names
  List<SkillView> get skills;       // skills.entries + discovered list
  GatewayView get gateway;          // port, bind, auth.mode, allowedOrigins
  SecurityView get security;
  // ... one per settings panel

  // Write methods -- always go through gateway.configPatch.
  Future<void> setAnthropicApiKey(String key) async {
    await _gateway.secretsUpsert('anthropic_api_key', key);
    await _gateway.configPatch({
      'auth': {'profiles': {'anthropic:dex': {'provider': 'anthropic', 'mode': 'api_key'}}},
      'models': {'defaults': {'primary': 'anthropic/claude-sonnet-4-6'}},
    });
    await _reload();
  }

  Future<void> setGroqApiKey(String key) async {
    await _gateway.secretsUpsert('groq_api_key', key);
    // Inject env into both MCP servers that need it.
    await _gateway.configPatch({
      'mcp': {
        'servers': {
          'browser-control': {'env': {'GROQ_API_KEY': '@secret:groq_api_key'}},
          'windows-desktop-control': {'env': {'GROQ_API_KEY': '@secret:groq_api_key'}},
        }
      }
    });
    // Regenerate agents.yaml from template using the new key.
    await _writeAgentsYamlFromTemplate(key);
    await _reload();
  }

  // ... etc
}
```

`UnifiedAgenticCore` is the **only** Flutter-side type that imports `GatewayClient` directly. Every Settings widget reads/writes via this class. Future implementation swaps (replacing OpenClaw, multi-backend) become single-file changes.

### 14.3 Bootstrap order

`main.dart`:
```dart
final gateway = GatewayClient(GatewayConfig.fromLocalConfig());
final core = UnifiedAgenticCore(gateway);
await gateway.connect();
await core.refresh();  // initial config snapshot
runApp(DexApp(core: core, conversation: ConversationStore(gateway)));
```

If `core.refresh()` reveals an unconfigured state (no auth profile), the app routes to the onboarding wizard instead of the chat home.

## Phase 15 — First-run onboarding wizard

### 15.1 Detection

After connect, if `core.config['auth']?['profiles']` is empty OR `core.model.profileId == null`, route to `OnboardingScreen` instead of `HomeDesktop`.

### 15.2 Four steps (initial wizard)

```
┌─────────────────────────────────────────────────────────┐
│  Step 1/4 — Welcome                                     │
│  "Dex drives your real apps. You'll see every action   │
│   before it runs and can stop it any time."             │
│  [Continue]                                             │
├─────────────────────────────────────────────────────────┤
│  Step 2/4 — Brain (Claude)                              │
│  How should Dex talk to Anthropic?                      │
│  ( ) Paste API key (sk-ant-...)                         │
│      [ key input field ]                                │
│  ( ) Use Claude Code (claude-cli OAuth)                 │
│      [ "Sign in with Claude" button ]                   │
│  [Back] [Continue]                                      │
├─────────────────────────────────────────────────────────┤
│  Step 3/4 — Hands (optional)                            │
│  For driving Windows apps + websites, Dex uses fast     │
│  text-only models via Groq. Free tier. Skip if you      │
│  only want chat right now.                              │
│  [ Groq key input -- gsk_... ]    [Skip]                │
│  [Back] [Continue]                                      │
├─────────────────────────────────────────────────────────┤
│  Step 4/4 — Approve                                     │
│  Dex will:                                              │
│   ✓ ask before clicking anything                        │
│   ✓ refuse destructive operations by default            │
│   ✓ keep your keys local (never leaves your machine)   │
│  [Back] [Get started]                                   │
└─────────────────────────────────────────────────────────┘
```

Each step calls `UnifiedAgenticCore.*` setters. Step 2's "Sign in with Claude" launches the OAuth flow via OpenClaw's existing `auth.oauth.start` RPC (find via grep — it's the same flow `openclaw onboard` already uses internally; we just trigger it from Flutter). Step 3 is skippable; UFO² + browser-use simply stay disabled until the user adds a key in Settings later.

### 15.3 Re-onboarding

A "Reset Dex…" button in Settings → About lets the user re-run the wizard (config.set with empty `auth.profiles`).

## Phase 16 — Settings surface (the 30+ panels, navigable)

### 16.1 Information architecture

30+ panels organized into 6 nav sections. Sidebar layout (Settings is a separate screen, not a modal):

```
┌─ Settings ──────────────────────────────────────────────────────────┐
│ Nav        │ Panel content                                          │
│            │                                                        │
│ Brain      │ - Model                Auth profiles, fallback         │
│            │ - Auth profiles        api_key / oauth / token / aws   │
│            │ - Provider catalog     Anthropic, OpenAI, Groq, etc.   │
│            │ - Thinking + cost      thinking budget, fast mode      │
│            │                                                        │
│ Tools      │ - MCP servers          windows-desktop-control, etc.   │
│            │ - Skills               .agents/skills/* enable/disable │
│            │ - Tool policy          allow / deny lists              │
│            │ - Approvals            ask-first defaults              │
│            │                                                        │
│ Gateway    │ - Network              port, bind mode                 │
│            │ - Auth                 mode (token/password/none)      │
│            │ - Control UI           allowedOrigins, CORS sandbox    │
│            │ - TLS                  cert/key paths                  │
│            │ - Tailscale            off / serve / funnel            │
│            │ - HTTP endpoints       /v1/chat/completions on/off     │
│            │                                                        │
│ Channels   │ - Defaults             group policy, heartbeat         │
│ (optional, │ - Telegram             pairing, allowFrom, dmPolicy    │
│  collapsed)│ - WhatsApp             ditto                           │
│            │ - Slack / Discord      ditto                           │
│            │ - (each enabled        ...                             │
│            │   channel: one         ...                             │
│            │   panel)                                               │
│            │                                                        │
│ Workspace  │ - Sessions             ttl, default agent              │
│            │ - Memory               backend (builtin / QMD)         │
│            │ - Cron                 scheduled jobs                  │
│            │ - Hooks                Gmail Pub/Sub, webhooks         │
│            │ - Voice / Talk         (off unless toggled)            │
│            │ - Discovery            mDNS, wide-area                 │
│            │ - Web                  reconnect, whatsapp web         │
│            │                                                        │
│ Security   │ - Refusal list         editable destructive patterns   │
│            │ - Sandboxing           non-main session policy         │
│            │ - Audit                suppressed warnings             │
│            │ - Proxy                http / socks                    │
│            │                                                        │
│ About      │ - Version              Dex 1.4, vendor pins            │
│            │ - Licenses             credit OpenClaw, UFO², browser- │
│            │ - Reset Dex            re-run onboarding               │
│            │ - Advanced editor      raw openclaw.json (read-only    │
│            │                        in v1.4, editable in v1.5)      │
└─────────────────────────────────────────────────────────────────────┘
```

### 16.2 Per-panel template

Most panels are the same shape so we build a reusable widget set:

- `SettingsPanel({title, summary, children})` — surface card, breadcrumb
- `SettingsField({label, child, hint})` — labeled row, mono `hint`
- `SettingsToggle({path, label})` — calls `core.patch({path: bool})`
- `SettingsTextField({path, label, isSecret})` — calls `core.patch` or `core.secretsUpsert`
- `SettingsSelect({path, label, options})` — dropdown
- `SettingsList({label, items, onAdd, onEdit, onRemove})` — for `auth.profiles`, `mcp.servers`, etc.

Each setting panel is ~30–80 lines because the heavy lifting is in `UnifiedAgenticCore` and the common widgets. 30 panels = ~1,500 LOC of UI total, not crazy.

### 16.3 Live re-config

Some settings are hot-reloadable; others require a gateway restart. `UnifiedAgenticCore.setX` returns `RestartHint.none | RestartHint.gateway | RestartHint.app`. The Settings panel shows a yellow stripe at top when an applied change wants a restart, with a "Restart now" button.

### 16.4 Acceptance

- Fresh install (`~/.openclaw/` absent) → Dex shows wizard → user enters Anthropic key → wizard finishes → chat works → typing "hi" gets a reply.
- Settings → Brain → Auth profiles → "Add OpenAI" with API key → save → Models panel shows OpenAI option → switch primary model to GPT-5 → next chat goes to OpenAI.
- Settings → Tools → MCP servers → uncheck "browser-control" → restart → asking for a web task fails politely instead of running.
- Settings → Gateway → Port → change 18789→18790 → restart hint shows → Restart → Dex reconnects.

## Phase 17 — Generated `agents.yaml` from unified secrets

UFO² reads its model config from `vendor/UFO/config/ufo/agents.yaml`. Today we ship a hand-edited file with the key inline. v1.4 makes it generated:

- Rename `vendor/UFO/config/ufo/agents.yaml` → `agents.yaml.template` (re-checked in — the template already exists; we keep both for one cycle, then delete the hand-edited one)
- Template uses `${GROQ_API_KEY}` placeholders
- `UnifiedAgenticCore.setGroqApiKey(key)` writes a fresh `agents.yaml` from the template substituting the key value plus a `# THIS FILE IS GENERATED — edit through Dex Settings` banner
- The Groq key itself lives in OpenClaw's secret store (referenced via `@secret:groq_api_key` in `mcp.servers.*.env`); UFO² gets the raw value through the rendered `agents.yaml` because UFO² doesn't read env directly.

browser-use is unchanged — it already reads `GROQ_API_KEY` from env, which we plumb via `mcp.servers.browser-control.env`.

## v1.4 — Files touched

```
NEW
  app/lib/core/agentic_core.dart                     (~600 lines)
  app/lib/core/models/auth_profile.dart
  app/lib/core/models/mcp_server_view.dart
  app/lib/core/models/skill_view.dart
  app/lib/core/agents_yaml_writer.dart               (template -> rendered)
  app/lib/screens/onboarding/welcome.dart
  app/lib/screens/onboarding/brain.dart
  app/lib/screens/onboarding/hands.dart
  app/lib/screens/onboarding/approve.dart
  app/lib/screens/settings/settings_screen.dart      (sidebar + routing)
  app/lib/screens/settings/panels/                   (~30 .dart files)
  app/lib/widgets/settings/                          (panel/field/list primitives)
  vendor/UFO/config/ufo/agents.yaml.template         (already exists; promote it)

EDIT
  app/lib/core/gateway_client.dart                   (+ configGet/Patch/Set, secretsUpsert)
  app/lib/main.dart                                  (+ wire UnifiedAgenticCore, + route to onboarding)
  app/lib/screens/home_desktop.dart                  (+ Settings entry, + onboarded-gate)
  scripts/install-skills.ps1                         (don't write agents.yaml directly anymore)
  vendor/UFO/config/ufo/agents.yaml                  (DELETE -- the generated one supersedes it)
  D:\project1\SECURITY.md                            (note: keys in OpenClaw secrets, not vendor configs)
  D:\project1\LICENSES.md                            (no new deps; same audit)
  D:\project1\PLAN.md                                (Phase 14-17 entries)
  D:\project1\README.md                              ("first run: just launch Dex.exe -- no CLI setup")
```

## v1.4 — Risks

1. **Schema drift on vendor update.** If OpenClaw bumps its config Zod schema (new keys, renamed keys), our typed views break silently. Mitigation: a single `core/schema_compat.dart` translation layer + a smoke test that loads a known-good `openclaw.json` and asserts every `core.model`, `core.tools`, etc. property returns expected values. Re-run on every vendor pin bump.
2. **`config.patch` may reject some writes mid-runtime** (e.g. changing `gateway.port` while the gateway is listening on it). Mitigation: per-setting `RestartHint`. v1.4 surfaces the hint but doesn't auto-restart — user clicks the banner.
3. **OAuth (claude-cli) involves an external CLI we don't bundle yet.** If the user picks the OAuth radio and doesn't have Claude Code installed, the flow errors. Mitigation: detect Claude Code's presence before showing the radio; greyed-out + "Install Claude Code first" link if missing. v1.5 considers bundling.
4. **Secrets handling.** `secretsUpsert` writes to OpenClaw's secret store, which is plaintext on disk for the `env` provider (the user already has it; we just stop adding to the leak). Mitigation: document this honestly in SECURITY.md; v1.5 considers OS keychain integration (Windows DPAPI).
5. **30 settings panels is a lot of UI to maintain.** Mitigation: heavy reliance on the 6-widget `SettingsField`/`SettingsToggle`/etc. primitives. Adding a panel = ~50 lines because the heavy code is in the primitives + `UnifiedAgenticCore`.

## v1.4 — Verification

```powershell
# Fresh-install path
Remove-Item -Recurse -Force ~\.openclaw\         # blow away config
D:\project1\app\build\windows\x64\runner\Debug\dex.exe
# Dex shows wizard. Step 2 = paste Anthropic key. Step 3 = paste Groq key. Done.
# Chat "hi" -> Claude reply.

# Settings hot-path
# Settings -> Brain -> Model -> switch primary -> next chat goes to new model.
# Settings -> Tools -> MCP servers -> add a custom MCP server JSON -> appears in chip routing.

# Re-onboarding
# Settings -> About -> Reset Dex -> wizard runs again on next launch.
```

## v1.4 — Progress log

- [ ] Phase 14 — `UnifiedAgenticCore` + gateway `configGet/Patch/Set/secretsUpsert` wired
- [ ] Phase 15 — 4-step onboarding wizard (API key + claude-cli OAuth radios on step 2)
- [ ] Phase 16 — 6 priority Settings panels (Brain/Tools/Gateway/Security/About) live
- [ ] Phase 16b — Remaining ~24 panels (Channels, Workspace, advanced Tools/Brain)
- [ ] Phase 17 — `agents.yaml` generated from template; the hand-edited file removed from repo

---

# v1.5 — Self-contained installer + source-level brand absorption

## Context

After v1.4, the experience inside Dex is one product, but the installation story still leaks:
- User must `npm install -g openclaw@latest` separately.
- User must install Python 3.11 separately.
- The vendor directory tree under `D:\project1\vendor\` is visible if they ever look.
- Process names, log paths, env vars still say `openclaw`.

v1.5 closes the gap: a single Windows installer (.msi) that drops Dex, a bundled Node runtime, a bundled Python 3.11, and pre-built vendor venvs into one location. The user runs the installer, launches Dex, and never sees Node/Python/OpenClaw. v1.5 also does a **mechanical source-level rename** of `openclaw` → a chosen internal name in the surfaces a user might see (process names, config dir, error messages), keeping the vendor source files themselves named as-is so upstream pulls remain straightforward.

**This is a big phase.** It's installer engineering, runtime bundling, and a careful rename pass. Plan it cleanly; don't start until v1.4 is solid.

## Decision: the internal product name

The Flutter app keeps the product name **Dex**. The internal brain — what we currently call OpenClaw — gets a separate internal name so the two are distinguishable in logs/debugging. Three candidates; lock one before Phase 18 starts (default = first):

1. **`dexcore`** — literal. `~/.dexcore/`, process `dexcore-gateway`, log prefix `[dexcore]`. Recommended.
2. **`agentic`** — generic, vendor-agnostic. `~/.agentic/`, process `agentic-gateway`.
3. **`synapse`** — more product-feeling. `~/.synapse/`, process `synapse-gw`.

Whatever's picked is wired through one constant in v1.5 so changing it later is a single edit.

## Phase 18 — Bundle Node + Python + vendors into one installer

### 18.1 What goes in the installer

```
%LocalAppData%\Programs\Dex\
├── Dex.exe                              (Flutter Windows runner)
├── flutter_windows.dll, data\           (Flutter SDK runtime)
├── runtime\
│   ├── node\                            (Node 24 portable, 50 MB)
│   │   └── node.exe + lib + npm-shrinkwrap'd deps
│   ├── python\                          (Python 3.11 embeddable, 25 MB)
│   │   └── python.exe + standard lib
│   ├── ufo\                             (vendor/UFO + .venv, pre-installed)
│   ├── browser-use\                     (vendor/browser-use + .venv, pre-installed)
│   └── dexcore\                         (renamed copy of vendor/openclaw)
├── data\
│   └── (templates, default config, fonts, tray icon)
└── uninstall.exe
```

User config still goes to `%USERPROFILE%\.<dexcore>\` so updates don't wipe state.

### 18.2 Tooling

- **Installer:** `wix` (WiX Toolset) for an .msi. WiX is verbose but produces clean MSIs that Windows treats as trustworthy. Alternative: Inno Setup (simpler but less integrated).
- **Node bundling:** ship the official Node Windows zip extracted under `runtime\node\`. Don't use `pkg` — it adds complexity and breaks Node 24 features.
- **Python bundling:** Python 3.11 "embeddable" zip (a non-installer Python tree we ship under `runtime\python\`). PyInstaller is overkill; we just ship the embeddable + the pre-built venvs.
- **Vendor venvs prebuilt at build time:** GitHub Actions builds the venvs in a Windows runner, zips them, the WiX project includes the zip as a payload.

### 18.3 Launch flow

`Dex.exe` is still the entrypoint. On launch:
1. Set `PATH` to prepend `runtime\node\` and `runtime\python\` so any child process sees the bundled runtimes first.
2. Spawn the gateway: `runtime\node\node.exe runtime\dexcore\dist\index.js gateway --port 18789` (or auto-pick port). PID tracked; killed on Dex exit.
3. MCP servers spawn automatically as gateway child processes once their config is in `openclaw.json`. The bundled Python venv paths get baked into the registered MCP commands during onboarding.
4. Flutter UI connects to `ws://127.0.0.1:<port>` exactly like today.

No global `npm install`. No global Python install. The user gets one installer.

### 18.4 First-run inside the bundled context

The onboarding wizard from Phase 15 still runs first. It now:
- Doesn't ask the user to install anything externally.
- Pre-fills MCP server paths to point at the bundled venvs (`%LocalAppData%\Programs\Dex\runtime\ufo\.venv\Scripts\python.exe`).
- The Groq + Anthropic keys remain user-provided in Steps 2-3.

### 18.5 Auto-updates (later)

Out of scope for v1.5; document the hook. The installer should leave room for a Squirrel-style updater (or just "download new .msi").

## Phase 19 — Source-level rename of `openclaw` (user-visible surfaces only)

### 19.1 Scope: what gets renamed

A scripted pass over `vendor/openclaw/` that changes ONLY the surfaces a user might see at runtime:

- **Process names** — what shows up in Task Manager. e.g. `argv[0]` in `entry.ts`, the title in `process.title`.
- **Config directory** — `~/.openclaw/` → `~/.dexcore/` (single constant in `src/config/io.ts`).
- **Log subsystem prefixes when they say "openclaw"** — most existing prefixes are role-based (`[gateway]`, `[heartbeat]`) and stay. Only the small set that literally says "openclaw" in user-visible logs gets renamed.
- **CLI binary name** — `bin/openclaw.cmd` → `bin/dexcore.cmd` (we don't expose the CLI in v1.4+ but keep it consistent).
- **package.json `"name"`** — `openclaw` → `dexcore`. We don't publish; this is just for internal consistency.
- **`displayName` strings** in error messages that say "OpenClaw".

### 19.2 What does NOT get renamed

- File paths, class names, TypeScript type names, internal function names (`createGateway`, etc.). These are invisible to the user.
- Test fixtures, comments, docs — they stay so future OpenClaw upstream merges don't conflict on every comment.
- Anything inside `vendor/UFO/` or `vendor/browser-use/` — they don't say "openclaw".

### 19.3 How

Single script `scripts/rebrand-vendor.ps1`:
1. Read a JSON map of `openclaw → dexcore` replacements with their exact match strings (not a blanket grep).
2. Apply on a fresh clone of the pinned commit; produce a `vendor/dexcore-renamed/` directory.
3. The installer ships `vendor/dexcore-renamed/`, not `vendor/openclaw/`.
4. Re-run on every vendor pin bump. Diff the output to catch upstream renames that escape our map.

### 19.4 Open-source attribution

Credit in:
- `LICENSES.md` (already there)
- Settings → About → "Built on OpenClaw, Microsoft UFO², browser-use" with links.
- Source headers preserved in vendor files (MIT requires it).

This is not "hiding" OpenClaw — it's just not putting "OpenClaw" in front of the user. The credit and license obligations are honored.

## Phase 20 — Production polish

- Code-signing the installer (EV cert if available; otherwise SmartScreen warnings on download).
- Auto-update channel.
- Crash reporting (Sentry or simple local-log + send-to-clipboard button on error screen).
- App-uninstall flow that cleanly removes `%LocalAppData%\Programs\Dex\` and offers to keep/delete `~/.<dexcore>/`.

## v1.5 — Files touched

```
NEW
  installer\Dex.wxs                                  (WiX project)
  installer\components\runtime.wxs                   (bundled Node/Python/vendors)
  installer\components\firewall.wxs                  (one allow-local rule for ws://127.0.0.1)
  scripts\rebrand-vendor.ps1                         (the rename pass)
  scripts\rebrand-map.json                           (exact match -> replacement strings)
  scripts\build-installer.ps1                        (orchestrates: build flutter, build vendors, sign, package)
  .github\workflows\release.yml                      (CI builds the venvs + installer)

EDIT
  D:\project1\app\lib\main.dart                      (spawn bundled gateway instead of expecting it externally)
  D:\project1\app\lib\core\gateway_client.dart       (auto-pick port; default 18789 but fall through)
  D:\project1\README.md                              (replace "npm install -g openclaw" with "download Dex.msi")
  D:\project1\SECURITY.md                            (note: rebrand doesn't hide the upstream, just the user-facing label)
  D:\project1\LICENSES.md                            (no new deps; same audit + attribution wording)
  D:\project1\PLAN.md                                (Phase 18-20 entries)
```

## v1.5 — Risks

1. **Installer trust on first run.** Without an EV cert, SmartScreen will warn. Mitigation: document the manual "More info" → "Run anyway" path until we acquire signing. Add a signed binary as a stretch goal.
2. **Bundled Node + Python balloons the installer.** ~100-150 MB before vendor venvs; ~300-400 MB total. Mitigation: WiX's CAB compression + delta updates. Acceptable for v1; revisit if user feedback says it's too heavy.
3. **Rebrand drifts as OpenClaw evolves.** The exact-match map must be re-validated each vendor pin. Mitigation: `scripts/rebrand-vendor.ps1` fails loudly if expected strings aren't found, forcing a human review before bumping the pin.
4. **Bundled Python venv breakage.** Pre-built venvs are OS-specific; we'd need separate ones for Windows/macOS/Linux. Mitigation: v1.5 ships Windows only; macOS/Linux installers are v1.6.
5. **Update story is open.** We don't have an auto-updater in v1.5. Mitigation: ship a one-click "Check for updates" in Settings → About that opens the GitHub releases page.

## v1.5 — Verification

```powershell
# Fresh install on a clean Windows VM
.\installer\Dex.msi   # installs to %LocalAppData%\Programs\Dex
# Launch Dex from Start Menu -> onboarding wizard -> works
# Task Manager shows "Dex.exe" + "dexcore-gateway.exe" + child python processes
# uninstall via Settings -> Apps -> Dex -> removes everything cleanly
```

## v1.5 — Progress log

- [ ] Phase 18 — bundled Node + Python + vendors; Dex.exe spawns the brain on launch; no external installs needed
- [ ] Phase 19 — `rebrand-vendor.ps1` runs cleanly on the pinned commit; renamed dir ships in installer; user-visible surfaces say `dexcore` not `openclaw`
- [ ] Phase 20 — installer signed, About-screen attribution, uninstall flow clean

---

# Phase A — DexCore rebrand FIRST (Ultraplan refinement, NEW execution order)

> **Ordering change locked by Ultraplan.** The original plan placed the rebrand at v1.5 Phase 19, AFTER v1.4's UnifiedAgenticCore + Settings work. That order means every v1.4 file references `openclaw` then gets re-touched by the rebrand. Costly and risky. **New order: rebrand first, as Phase A, before any other new work.** Everything downstream (v1.2, v1.3, v1.4, v1.5) then targets `core/` from the start — no re-work. v1.5 Phase 19 (the original rebrand section above) is **superseded by this section** and is now empty in the v1.5 milestone; v1.5 ships only the installer (Phase 18) and production polish (Phase 20).

## New execution order

1. **Phase A** (this section) — fork OpenClaw into `core/`, rebrand to DexCore, prove it builds.
2. v1.2 — action surface + Windows chrome (unchanged; references `core/` not `vendor/openclaw/`).
3. v1.3 — per-platform UI + mobile (unchanged).
4. v1.4 — UnifiedAgenticCore + onboarding + Settings (unchanged in design; the gateway it talks to is now `dex-core gateway` from `core/`).
5. v1.5 — installer (Phase 18) + production polish (Phase 20). Phase 19 deleted (done in Phase A).

## Phase A.1 — Lock the internal name (single decision, single constant)

Ultraplan's default: **`DexCore`** (PascalCase product) / **`dex-core`** (kebab-case in package ids, CLI binary, config dir, log prefix).

Surfaces this name lands on:
- npm `package.json` `"name"` → `"dex-core"`
- CLI binary: `bin/dex-core.cmd`
- Config dir: `%USERPROFILE%\.dex-core\`
- Process title: `dex-core-gateway`
- Log prefix: `[dex-core]` where currently `[openclaw]` appears
- Display string: `DexCore` in error messages, About screen, CLI usage banner

Lock the choice as a single key in `scripts/rebrand-map.json`. Changing it later is a one-edit replay.

Alternatives if `DexCore` doesn't feel right: `agentic`, `synapse`, `forge`. Locked default: `DexCore`.

## Phase A.2 — Clean-slate fork (per Ultraplan)

Decision: **clean slate**, NOT `git mv`. Copy the pinned OpenClaw source into a fresh `core/` subdirectory; remove its `.git/`; credit the heritage in `core/HERITAGE.md`. Cleaner authorship story than dragging upstream git history through a rename pass.

`scripts/fork-openclaw.ps1`:
1. Verify `vendor/openclaw/` is at the pinned commit recorded in `README.md` (currently `7074cf8e23c1f64362c4f8c4bf32971ca94d5221`).
2. `Copy-Item -Recurse vendor\openclaw core` — original stays in `vendor/` during the rename pass so diffs are easy.
3. `Remove-Item -Recurse -Force core\.git` — clean slate at the git layer.
4. Run `scripts\rebrand.ps1` against `core/` with `scripts\rebrand-map.json`.
5. Write `core/HERITAGE.md`:
   ```markdown
   # DexCore Heritage
   DexCore is a downstream of OpenClaw (github.com/openclaw/openclaw) at commit
   7074cf8e23c1f64362c4f8c4bf32971ca94d5221 (2026-06-03), forked <YYYY-MM-DD>.
   Upstream bug-fix backports welcomed; feature divergence expected.
   MIT-licensed; see core/LICENSE. Original copyright + license preserved per MIT.
   ## Upstream sync
   - Re-clone OpenClaw at the new commit into vendor/openclaw-upstream/
   - Diff vendor/openclaw-upstream/ against core/ (reverse the rebrand-map to compare)
   - Cherry-pick interesting changes; re-run scripts\rebrand.ps1
   ```
6. Update `D:\project1\README.md` so the vendor-pin table lists `core/` as ours (OpenClaw credited as the fork origin commit).
7. Update `LICENSES.md` so OpenClaw appears as the heritage upstream + MIT credit, alongside UFO² and browser-use.

## Phase A.3 — Build the rebrand map by reading source (highest-leverage file)

The map is the single thing that determines whether the rebrand "just works" or causes weeks of whack-a-mole. **Build it by `Grep`-ing the source, not by guessing.**

Methodology:
1. `Grep` for `openclaw` (case-insensitive) across `vendor/openclaw/src/`, `vendor/openclaw/package.json`, `vendor/openclaw/bin/`, all `.md` docs.
2. Bucket every hit:

| Bucket | Rule | Examples |
|---|---|---|
| **Rename** (user-visible) | gets a `rebrand-map.json` entry | CLI usage banners, error messages with `OpenClaw`, log prefix `[openclaw]`, config dir `~/.openclaw/`, process title, `package.json "name"`, README/help text |
| **Keep** (internal-only) | NOT renamed | TS class names, function names, file paths, test fixtures, comments, internal type names |
| **Keep** (public OSS API) | NOT renamed (would break plugins) | `@openclaw/gateway-protocol` and other `@openclaw/*` npm-scoped imports — these are the public plugin SDK surface |

3. For each Rename hit, add an EXACT-match entry to `scripts/rebrand-map.json`:
   ```json
   {
     "replacements": [
       { "find": "\"name\": \"openclaw\"",   "replace": "\"name\": \"dex-core\"",   "files": ["package.json"] },
       { "find": "openclaw onboard",          "replace": "dex-core onboard",         "files": ["src/cli/**/*.ts","docs/**/*.md"] },
       { "find": "~/.openclaw/",              "replace": "~/.dex-core/",             "files": ["src/config/**/*.ts","docs/**/*.md"] },
       { "find": "OpenClaw Gateway",          "replace": "DexCore Gateway",          "files": ["src/**/*.ts"] },
       { "find": "[openclaw]",                "replace": "[dex-core]",               "files": ["src/logging/**/*.ts"] }
       // ...one entry per user-visible string from the Grep pass
     ]
   }
   ```
   Each entry is an EXACT string match scoped to a glob. No regex, no fuzzy, no whole-word. Cheap to read; loud to fail.

4. `scripts/rebrand.ps1`:
   - Reads `rebrand-map.json`.
   - For each entry: globs the files, replaces every `find` with `replace`.
   - **Asserts every `find` was found at least once across its glob.** If even one isn't found, fail loudly with the missing `find` printed — this is the canary for upstream drift on future pin bumps.

## Phase A.4 — Acceptance gate

Phase A is done when ALL of these pass on a clean machine:

```powershell
# 1. Build succeeds under the new identity
cd D:\project1\core
npm install
npm run build

# 2. CLI banner shows DexCore branding
.\bin\dex-core.cmd gateway --help
# Expect: "DexCore Gateway" in the usage text, not "OpenClaw Gateway".

# 3. Gateway starts and logs under the new prefix
.\bin\dex-core.cmd gateway --port 18789 --verbose
# Expect: logs prefixed [dex-core], NOT [openclaw]; config writes
# to %USERPROFILE%\.dex-core\ (file inside may still be openclaw.json
# in v1 -- file-name rename is Phase A.5 follow-up).

# 4. No user-visible "openclaw" strings survive in the built artifact
Get-ChildItem core\dist -Recurse -Include *.js,*.cjs,*.mjs |
    Select-String -Pattern 'OpenClaw|openclaw' -CaseSensitive:$false |
    Where-Object { $_.Line -notmatch '@openclaw/' }
# Expect: empty output (the only allowed survivors are @openclaw/* scoped
# imports we intentionally kept for plugin compat).
```

## Phase A.5 — Quick follow-up (after Phase A merges)

- Rename the on-disk config FILE inside `~/.dex-core/` from `openclaw.json` → `dex-core.json` via a one-step migration in `core/src/config/io.ts`. Phase A landed the directory rename; this is the file rename. Doing them separately means v1.4 only chases one moving target.
- Update `D:\project1\PLAN.md` so Phase A is the new top item; archive the old "Phase 0 Bootstrap" content under "v1.0 history (shipped)".

## Phase A — Files touched

```
NEW
  D:\project1\core\                              (full clean-slate fork; ~19,697 files from OpenClaw)
  D:\project1\core\HERITAGE.md                   (origin commit, fork date, sync method, MIT credit)
  D:\project1\scripts\rebrand-map.json           (exact-match table, ~30-60 entries expected)
  D:\project1\scripts\rebrand.ps1                (applies map, asserts every `find` was found)
  D:\project1\scripts\fork-openclaw.ps1          (orchestrates: copy, strip .git, rebrand, verify)

EDIT
  D:\project1\README.md                          (vendor-pin table now lists core/ as ours, OpenClaw as the fork commit)
  D:\project1\PLAN.md                            (Phase A as the new first step; older phases marked as referencing core/)
  D:\project1\LICENSES.md                        (OpenClaw appears as the upstream heritage with MIT credit)
  D:\project1\scripts\install-skills.ps1         (refer to core/ paths, not vendor/openclaw/)
  D:\project1\app\lib\core\gateway_client.dart   (no code change; the gateway it talks to is now dex-core-gateway, same protocol)
```

## Phase A — Risks (specific)

1. **Missed string in the rebrand-map.** Symptom: `npm run build` works but the banner still says "OpenClaw". Caught by Phase A.4 step 4 (the dist grep). Add the missed string to the map and re-run.
2. **`@openclaw/*` scoped imports get renamed by accident.** Would break plugins that depend on the public SDK. Mitigation: the map's `find` strings should NOT include the `@openclaw` prefix; verify each entry isn't `@openclaw`. The Phase A.4 step 4 grep filter (`-notmatch '@openclaw/'`) catches surviving public imports as the expected residue, NOT a failure.
3. **Upstream surprise rename on pin bump.** If OpenClaw renames a string our map's `find` no longer exists, `scripts/rebrand.ps1` fails loudly — that's the design. Forces a human review of the map before the pin bump lands.
4. **Build-script references to `openclaw` as a CLI name.** Some npm scripts (e.g. `"scripts": { "test:cli": "openclaw doctor" }` in package.json) reference `openclaw` as the bin name. These need entries in the rebrand map. Verify with `npm run build` end-to-end.
5. **Process-name visibility in Task Manager.** `process.title = 'openclaw'` may be set in `src/entry.ts`. Add an entry to the map for it.

## Phase A — Progress log

- [ ] Internal name locked (default: `DexCore` / `dex-core`)
- [ ] `core/` exists, copied from `vendor/openclaw/` at the pinned commit, `.git/` removed
- [ ] `scripts/rebrand-map.json` enumerates every user-visible `openclaw` string (built by `Grep`-ing source, not guessing)
- [ ] `scripts/rebrand.ps1` applies the map and asserts every `find` was found at least once
- [ ] `cd core && npm install && npm run build` succeeds
- [ ] `.\bin\dex-core.cmd gateway --help` shows `DexCore Gateway` banner
- [ ] Gateway starts; logs prefixed `[dex-core]`; config dir is `~/.dex-core/`
- [ ] `Select-String -Pattern openclaw core\dist\` returns empty (except `@openclaw/*` scoped imports)
- [ ] `core/HERITAGE.md` written with fork commit + date + MIT credit
- [ ] `D:\project1\PLAN.md` updated: Phase A is the new top item; v1.0 / v1.1 phases marked as referencing `core/` now
- [ ] `README.md`, `LICENSES.md`, `install-skills.ps1` updated to reference `core/` instead of `vendor/openclaw/`

---

# Phase B — Dex framework ownership migration

> **Status going in.** Phase A landed the CLI surface (`Dex`, `dex`, examples, no Docs:). Phase B is the full ownership migration: every internal identifier, env var, config path, npm scope, telemetry endpoint, and framework directory becomes Dex-native. Legal compliance (MIT preservation, HERITAGE, source-header credit) is non-negotiable per user; everything else is renameable. After Phase B, a developer reading the source perceives Dex as its own framework, not an OpenClaw fork.

## Locked decisions (this session)

1. **npm package name: `dexagent`** — user confirmed `dex` and `dex-cli` are taken; `dexagent` is locked. Binary on PATH stays `dex` via the `bin` field. Install command: `npm install -g dexagent` → `dex` available globally.
2. **Deep rename.** Every identifier (`OpenClawError` → `DexError`, `OPENCLAW_*` → `DEX_*`, `@openclaw/gateway-protocol` → `@dexagent/gateway-protocol`, etc.). Test fixtures updated alongside.
3. **Config-dir auto-migrator.** First launch detects `~/.openclaw/` → copies to `~/.dex/`; idempotent; breadcrumb at old path.
4. **External `@openclaw/*` upstream npm deps (`@openclaw/fs-safe`, `@openclaw/proxyline`)** stay — they're third-party libs we don't own. Credited in HERITAGE; can be forked later.
5. **Legal compliance:** `core/HERITAGE.md`, `core/LICENSE` (MIT), per-file copyright headers, `LICENSES.md` heritage row — all preserved verbatim. The rebrand script excludes the first ~10 lines of each file (the MIT header block) from string replacement.

## Audit summary (raw counts from `D:\project1\core` after Phase A)

| Category | Count | Phase B Action |
|---|---|---|
| User-visible CLI/banner/examples | ~30 strings | Already done in Phase A. Reverify zero leakage post-restructure. |
| Internal `@openclaw/*` workspace packages | ~30 packages under `core/packages/` | Rename to `@dexagent/*` (B.4) |
| External `@openclaw/*` upstream npm deps | 2-5 (`fs-safe`, `proxyline`, …) | KEEP. Document in HERITAGE. |
| Source files referencing `~/.openclaw/` / `openclaw.json` paths | **1,977 files** | Migrate via rebrand-map + add auto-migrator (B.5) |
| Unique `OPENCLAW_*` env vars | **639** | Rename to `DEX_*`; one-cycle back-compat shim (B.6) |
| Internal TS identifiers (`\bOpenClaw[A-Z]\w+\b`) | High thousands | Deep rename via expanded `rebrand-map.json` (B.3) |
| Hardcoded `"openclaw <sub>"` example strings in tests | ~50 | Already auto-renamed via Phase A's `replaceCliName()` injection into `formatHelpExample`. Verify post-rebuild. |
| `docs.openclaw.ai` URLs | ~50 places | Already stubbed by `formatDocsLink → ""` (Phase A). Verify in dist grep. |
| Telemetry / update-channel endpoints | Unknown — audit in B.7 | Audit + stub/repoint |

`docs/migration/openclaw-audit.md` (generated from the same greps) is committed BEFORE B.2 starts — that's the "produce a migration report before making changes" requirement met.

## Architecture after Phase B (target directory tree)

```
D:\project1\
├── dex/                                    # Dex framework root (publishable as `dexagent`)
│   ├── package.json                        # "name": "dexagent", bin "dex": "openclaw.mjs"
│   ├── HERITAGE.md                         # OpenClaw fork commit + MIT credit (preserved)
│   ├── LICENSE                             # MIT (preserved verbatim)
│   ├── core/                               # the brain (was `core/`)
│   ├── drivers/                            # was `glue/` — Dex's first-class driver modules
│   │   ├── windows-desktop/                # UFO² UIA engine
│   │   ├── browser/                        # browser-use engine
│   │   ├── omniparser/                     # NEW (Phase C) — vision engine
│   │   └── _shared/                        # approval gate, refusal list, retry
│   ├── orchestration/                      # NEW (Phase C) — the scoring + routing layer
│   │   ├── context-scanner.ts
│   │   ├── capability-scorer.ts
│   │   ├── router.ts
│   │   ├── engines/
│   │   │   ├── ufo-uia.ts
│   │   │   ├── browser-use.ts
│   │   │   └── omniparser.ts
│   │   ├── telemetry.ts
│   │   └── self-learning.ts
│   └── skills/                             # canonical .agents/skills layout
├── vendor/                                 # read-only upstream (UFO², browser-use, omniparser model weights)
├── app/                                    # Flutter UI
└── scripts/                                # build / rebrand / publish / push
```

## B.0 — npm name locked: `dexagent`

User decision. Binary alias `dex` (decoupled from npm name via `bin` field in `package.json`). Install + run:
```bash
npm install -g dexagent
dex --help                  # banner says "Dex"
dex gateway --help          # banner says "Dex"; Usage: "dex gateway"
```

## B.1 — Generate `docs/migration/openclaw-audit.md`

Script `scripts/audit-openclaw.ps1`:
- Runs the seven category greps above, writes counts + sample paths to the report.
- Commit the report alone (no source changes yet) as the first commit of Phase B.

## B.2 — Expand `scripts/rebrand-map.json` from 18 → ~500-700 entries

Existing map (Phase A) covers user-visible CLI surfaces. Phase B adds:

```json
{
  "internalName": {
    "pascalCase": "Dex", "kebabCase": "dex", "displayName": "Dex",
    "configDirName": ".dex", "envVarPrefix": "DEX_",
    "npmPackageName": "dexagent", "npmWorkspaceScope": "@dexagent"
  },
  "replacements": [
    // Section A: TS identifiers -- generated by `scripts/build-rebrand-map.ps1` from
    //   Grep "\bOpenClaw[A-Z]\w+\b" core/src core/packages core/ui --no-tests
    //   Each unique hit becomes one entry: "OpenClawError" -> "DexError", etc.
    // Section B: Env vars (639 of them)
    //   Grep "OPENCLAW_[A-Z_]+" -> dedupe -> emit {find: "OPENCLAW_X", replace: "DEX_X"}
    //   File-glob restricted to core/src/**/*.ts, core/packages/**/*.ts (NOT tests --
    //   tests use a separate map section)
    // Section C: Workspace scope renames
    //   "\"@openclaw/<pkg>\"" -> "\"@dexagent/<pkg>\"" for each internal package
    //   EXPLICIT exclusion list: @openclaw/fs-safe, @openclaw/proxyline (external deps)
    // Section D: Path constants
    //   "\".openclaw\"" -> "\".dex\"", "openclaw.json" stays (file name preserved for one cycle)
  ]
}
```

The map is BUILT by `scripts/build-rebrand-map.ps1` (a generator), reviewed by a human, then applied. Each entry stays exact-match — no regex, no fuzzy. The script fails loudly on misses (the upstream-drift canary).

## B.3 — Internal rename pass

Run `scripts/rebrand.ps1` against `core/`, `glue/*`, `scripts/*`, all `.md` docs (except `HERITAGE.md`, `LICENSES.md`, `CHANGELOG.md` — historical). Sentinel-aware: writes `<target>/.dex-rebranded` after success so re-runs of already-rebranded directories don't false-positive on misses.

**MIT header preservation:** the script's per-file step has an `--exclude-header-lines 10` mode that skips replacements in the first 10 lines of any source file whose header contains `Copyright` or `MIT` or `Microsoft Corporation`. This preserves attribution per MIT's terms.

**Test-fixture handling:** tests with hardcoded `name: "openclaw"` get a separate rebrand pass (`--include-tests`) with a tests-specific map that also updates assertions.

## B.4 — Internal `@openclaw/*` → `@dexagent/*` workspace migration

For each `core/packages/<pkg>/package.json` whose `name` starts with `@openclaw/`:
1. Rename to `@dexagent/<pkg>`.
2. Update every import in source and `dependencies`/`devDependencies` in sibling `package.json`s.
3. Keep `@openclaw/fs-safe`, `@openclaw/proxyline` (external upstream deps) untouched.
4. `pnpm install` regenerates the lockfile.
5. Update `pnpm-workspace.yaml`'s `minimumReleaseAgeExclude` — external `@openclaw/*` entries stay; internal references migrate.

## B.5 — Config dir migration: `~/.openclaw/` → `~/.dex/`

### B.5.1 Source migration
Canonical change in `core/src/config/io.ts` (single source-of-truth):
```typescript
const CONFIG_DIR_NAME = ".dex";  // was ".openclaw"
```
The 1,977 file references compose paths off this constant; touched by the rebrand map for hardcoded strings.

### B.5.2 First-launch auto-migrator
New module `core/src/migrations/config-dir-migrate.ts`:
```typescript
export async function migrateOpenClawConfigDir(): Promise<MigrationResult> {
  const oldDir = path.join(os.homedir(), ".openclaw");
  const newDir = path.join(os.homedir(), ".dex");
  if (!fs.existsSync(oldDir) || fs.existsSync(newDir)) return { migrated: false };
  await fsExtra.copy(oldDir, newDir, { preserveTimestamps: true });   // copy, NOT move
  await fs.writeFile(path.join(oldDir, "MOVED-TO-DEX.txt"),
    `Migrated to ${newDir} on ${new Date().toISOString()}.\n` +
    "Dex now reads from ~/.dex/. Delete this old dir once Dex starts cleanly.\n");
  return { migrated: true, from: oldDir, to: newDir };
}
```
Called once at gateway startup. Idempotent (the existence check on `newDir` short-circuits). Logs `[dex] migrated config from ~/.openclaw/ to ~/.dex/` on success.

## B.6 — Env var migration: `OPENCLAW_*` → `DEX_*` with back-compat shim

639 env var renames as a flat replace would break user shell profiles + CI. Solution: central shim, one-cycle deprecation warning.

New `core/src/env/dex-env.ts`:
```typescript
const DEPRECATION_LOGGED = new Set<string>();
export function dexEnv(name: string, env = process.env): string | undefined {
  if (env[name] !== undefined) return env[name];                          // new canonical
  if (name.startsWith("DEX_")) {
    const legacy = "OPENCLAW_" + name.slice(4);
    const val = env[legacy];
    if (val !== undefined) {
      if (!DEPRECATION_LOGGED.has(legacy)) {
        DEPRECATION_LOGGED.add(legacy);
        process.stderr.write(
          `[dex] ${legacy} is deprecated; use ${name} instead. Falling back for this run.\n`,
        );
      }
      return val;
    }
  }
  return undefined;
}
```
Every `process.env.OPENCLAW_X` read in source becomes `dexEnv("DEX_X")` via the rebrand map. Tests get a separate fixture map. Generated `docs/migration/env-vars.md` lists every `OPENCLAW_X` → `DEX_X` pair the deprecation message hints at.

## B.7 — Telemetry / update channels audit

Audit needed (not done in this session):
1. Grep `core/src/` for outbound HTTP/WS calls to `openclaw.ai`, `clawhub`, or similar upstream infrastructure.
2. Find the auto-update mechanism (likely in `core/src/cli/update-cli/`): does it query npm only, or a specific OpenClaw-controlled URL?
3. Find any analytics / error-reporting beacons.

For each:
- **External OpenClaw endpoint** → disable (no-op) or repoint to Dex-owned stub.
- **NPM registry queries** → fine; npm is canonical. Update to query the `dexagent` package.
- **Auto-update channel** → point at the `dexagent` npm release feed.

Acceptance: fresh Dex install makes **zero** outbound calls to `*.openclaw.ai` hosts.

## B.8 — Framework root: directory restructure

`git mv core/ dex/core/`, `git mv glue/ dex/drivers/`, rename children (e.g. `dex/drivers/windows-desktop/`). Single commit. All path references in `scripts/install-skills.ps1`, `app/`, `README.md`, `PLAN.md` updated in the same commit — no half-state on `main`.

New top-level `dex/package.json` workspace-includes `dex/core/`, `dex/drivers/*`, `dex/orchestration/` (Phase C).

## B.9 — `.gitignore` audit + updates

Adds for the post-restructure layout:
```gitignore
# Dex framework
dex/core/node_modules/
dex/core/dist/
dex/core/.turbo/
dex/core/coverage/
dex/drivers/*/node_modules/
dex/drivers/*/.venv/
dex/orchestration/coverage/
dex/.dex-rebranded                      # rebrand idempotency sentinel
docs/migration/.scratch/                # generator scratch

# vendor/ stays ignored except snapshot pins documented in README
vendor/UFO/.venv/
vendor/UFO/logs/
vendor/browser-use/.venv/
vendor/browser-use/playwright-cache/
vendor/omniparser/                      # Phase C — model weights are large

# Local config never committed
.dex/                                   # if anyone runs Dex from the repo root
**/agents.yaml                          # secrets file (vendor/UFO/config/ufo/agents.yaml)
```

## B.10 — Build + test verification

```powershell
cd D:\project1\dex
pnpm install                # regenerates bin: node_modules/.bin/dex shim
pnpm build                  # exit 0
pnpm test                   # exit 0; test-fixture rebrand handles assertions
node openclaw.mjs --help    # banner says Dex; no openclaw in user output
node openclaw.mjs gateway --help

# Residual grep (only allowed survivors):
Get-ChildItem dex\core\dist -Recurse -Include *.js,*.mjs |
  Select-String -Pattern 'OpenClaw|openclaw|OPENCLAW' -CaseSensitive:$false |
  Where-Object { $_.Line -notmatch '@openclaw/(fs-safe|proxyline)' -and $_.Line -notmatch 'openclaw\.mjs' }
# Expected: empty
```

Failures block migration; no publish until clean.

## B.11 — Logical commit grouping (11 commits, each individually green)

```
1. chore(audit): generate docs/migration/openclaw-audit.md
2. chore(rebrand-map): expand to 500+ entries; add build-rebrand-map.ps1
3. refactor(env): dexEnv() shim with one-cycle OPENCLAW_* fallback
4. refactor(config): ~/.openclaw -> ~/.dex auto-migrator
5. refactor(workspace): rename internal @openclaw/* -> @dexagent/*
6. refactor(identifiers): mechanical rename pass (rebrand-map.json)
7. chore(structure): git mv core/ -> dex/core/, glue/ -> dex/drivers/
8. chore(scripts): update install-skills.ps1, run-dev.ps1 to new paths
9. docs(heritage): expand HERITAGE.md, LICENSES.md attribution
10. chore(gitignore): cover dex/ subtree + sentinel files
11. chore(publish): wire dex/package.json publishConfig for `dexagent`
```

## B.12 — npm publish prep + dry-run

`dex/package.json`:
```json
{
  "name": "dexagent",
  "version": "0.1.0",
  "description": "Dex — a calm cockpit for commanding agents you can trust.",
  "license": "MIT",
  "bin": { "dex": "openclaw.mjs" },
  "files": ["openclaw.mjs", "dist/", "skills/", "drivers/", "orchestration/", "README.md", "LICENSE", "HERITAGE.md"],
  "publishConfig": { "access": "public" },
  "repository": { "type": "git", "url": "<user-confirmed remote>" }
}
```

```powershell
cd dex
npm pack --dry-run          # review tarball file list
npm publish --dry-run       # validate auth + manifest, no upload
```
Real `npm publish` is a separate human-approved step.

## B.13 — Push to remote (entire project tree)

From `D:\project1\` (NOT from `dex/` alone — pushes the whole project including `vendor/`, `app/`, `scripts/`, `PLAN.md`, etc.):
```powershell
git remote -v
git status -sb
git branch --show-current
git push -u <remote> <branch>
```

## B.14 — Final migration report

`docs/migration/dex-migration-report.md`:
1. Files changed (counts per category)
2. Remaining OpenClaw references with one-line reason each (heritage / external dep / file-name kept / etc.)
3. NPM readiness: package name, version, dry-run output
4. Git push status: remote, branch, commit hashes
5. Verification matrix snapshots (`dex --help`, `dex gateway --help`, residual grep)

User reads this before announcing the rebrand publicly.

## Heritage commitments (preserved — DO NOT REMOVE)

Per user's explicit instruction:
- `dex/core/HERITAGE.md` — origin commit + fork date + MIT credit
- `dex/core/LICENSE` (MIT) — verbatim preserved
- Per-source-file copyright headers — preserved verbatim. Rebrand script excludes the first 10 lines per file via `--exclude-header-lines 10` if header contains `Copyright`/`MIT`/`Microsoft`.
- `LICENSES.md` heritage row for OpenClaw + UFO² + browser-use — preserved
- External `@openclaw/fs-safe`, `@openclaw/proxyline` deps — preserved + credited

The "looks completely independent to users" goal is achieved via CLI output, env vars, config paths, error messages, banners, examples — all of which Phase B touches. Source-file MIT attribution stays. Legally safe.

## Phase B — Risks

1. **Test cascade.** 1,977 files touched in B.5 alone; some snapshot tests assert hash contents that include "openclaw". Mitigation: run `pnpm test` after each commit; fix incrementally.
2. **`dexEnv()` indirection in hot paths.** 639 env reads switch from inline property access to function call. Benchmark gateway startup + per-request paths after migration; exempt any hot path if regressed.
3. **Upstream sync gets harder.** Future OpenClaw bug-fix backports require reverse-applying the map. Documented in HERITAGE.md. Selective cherry-picks instead of bulk merges.
4. **`dexagent` already taken?** B.0 ran `npm view dexagent` and got user confirmation. If it's actually taken at publish time, fall through to `dexagentic` or `dex-agent` (with a `-` — different package). Plan re-verifies at B.12 dry-run.
5. **Restructure (B.8) breaks every script.** Single commit (#7) updates everything atomically; no half-state.

## Phase B — Progress log

- [ ] B.0 — `dexagent` confirmed via `npm view dexagent`
- [ ] B.1 — `docs/migration/openclaw-audit.md` generated + committed
- [ ] B.2 — `scripts/build-rebrand-map.ps1` emits 500+ entry `rebrand-map.json`
- [ ] B.3 — Rebrand pass clean across `core/`, `drivers/`, `app/`, `scripts/`
- [ ] B.4 — Internal `@openclaw/*` → `@dexagent/*`; `pnpm install` clean; external deps documented
- [ ] B.5 — `config-dir-migrate.ts` ships + smoke-tested with seeded `~/.openclaw/`
- [ ] B.6 — `dexEnv()` shim deployed; `docs/migration/env-vars.md` published
- [ ] B.7 — Zero outbound `.openclaw.ai` calls from fresh install
- [ ] B.8 — `git mv core/ dex/core/`, `git mv glue/ dex/drivers/`; path refs updated
- [ ] B.9 — `.gitignore` covers new layout
- [ ] B.10 — `pnpm build` + `pnpm test` green; residual grep matches expected list only
- [ ] B.11 — 11 logical commits pushed
- [ ] B.12 — `npm publish --dry-run` clean
- [ ] B.13 — Full project tree pushed; `git status` clean
- [ ] B.14 — `docs/migration/dex-migration-report.md` written

---

# Phase C — Orchestration architecture (hybrid capability scoring)

> **Goal.** Replace SKILL.md-driven LLM routing with a hybrid capability-scoring system that picks the right execution engine in <100 ms with high reliability. Engines are pluggable; new ones (Android, macOS Accessibility, API, RemoteDesktop) slot in by implementing one interface. The system learns from telemetry: engines that historically succeed on a class of tasks score higher over time.

## C.0 — Why hybrid (not rule-based, not pure-LLM)

- **Rule-based router** (`if process == chrome.exe: browser`) misses edge cases like Electron apps (look like native but have DOM), and breaks every time a new app pattern appears.
- **Pure LLM router** spends 500-2000 ms on a Claude/Gemini call per task just to decide. That's the single biggest latency win available.
- **Hybrid scoring** does cheap deterministic context detection (~30 ms) + per-engine score functions (~5 ms each) = ~50 ms total decision, with the LLM only invoked WITHIN an engine for fine-grained planning (e.g., browser-use's per-step reasoning). Decision latency drops 10-40× vs pure-LLM routing.

## C.1 — Engine roster

Phase C lands three engines as Dex-native modules (not external glue):

| Engine | Driver under | Reach | Latency profile | Cost profile |
|---|---|---|---|---|
| `UfoUIAEngine` | `dex/drivers/windows-desktop/` (wraps UFO²) | Native Win32 apps via UIA tree | Low (no vision) | Free (text-only LLM in agents.yaml) |
| `BrowserUseEngine` | `dex/drivers/browser/` (wraps browser-use) | Anything inside a browser tab | Medium (Playwright + DOM-only by default) | Per-LLM-call |
| `OmniParserEngine` | `dex/drivers/omniparser/` **NEW** | Pixel-only apps (games, custom-drawn, image-heavy UIs) | High (vision required) | Per-vision-call |

Future engines slot in by implementing `AutomationEngine`:
```typescript
interface AutomationEngine {
  id(): string;
  /** Cheap synchronous score for this engine on the given context. 0..1 */
  score(ctx: RuntimeContext, task: TaskIntent): number;
  /** Best-effort time to first action for this task. ms. */
  estimateLatencyMs(ctx: RuntimeContext, task: TaskIntent): number;
  /** Best-effort success-rate prior (Beta-distribution mean from telemetry). 0..1 */
  estimateSuccessRate(ctx: RuntimeContext, task: TaskIntent): number;
  execute(ctx: RuntimeContext, task: TaskIntent, opts: ExecOpts): Promise<ExecResult>;
  /** Optional: attempt recovery from a known failure mode. */
  recover?(error: ExecError): Promise<RecoveryAction>;
}
```

## C.2 — Why OmniParser specifically

OmniParser v2 (Microsoft, MIT, repo: `https://github.com/microsoft/OmniParser`) is a YOLO-style screen parser that takes a screenshot and outputs `[(bbox, label, type)]` for every interactive element — without needing UIA or DOM. It's the ONLY reliable bridge for:
- Games (no UIA tree)
- Photoshop / Premiere / Figma desktop (custom-drawn canvases)
- Java Swing / SWT apps (broken UIA)
- Older Win32 apps with bad accessibility
- Cross-app workflows where the target app is unknown ahead of time

It's heavy (~2 GB model weights, runs on GPU or CPU) so we ONLY invoke it when UIA/DOM are unavailable or have failed. Setup:
- Vendor `microsoft/OmniParser` to `vendor/omniparser/` (pinned commit)
- Bundle the ONNX model in `vendor/omniparser/weights/` (downloadable separately; not committed)
- Driver `dex/drivers/omniparser/server.py` wraps it as another MCP server
- Score function returns ~0.05 for tasks with rich UIA, ~0.95 for tasks with no structural access

## C.3 — Runtime Context Scanner (target <50 ms)

`dex/orchestration/context-scanner.ts` — synchronous parallel fact-gathering:

```typescript
interface RuntimeContext {
  // Active window (Win32 API: GetForegroundWindow + process info)
  process: { name: string; exePath: string; pid: number };

  // App-family classification (regex-keyed table; not LLM)
  appFamily: "browser" | "office" | "ide" | "game" | "media" | "system" | "unknown";

  // Browser-specific (browser-control engine queries via CDP if process is a browser)
  browser?: { kind: "chromium" | "firefox" | "webkit"; activeTabUrl?: string; domAvailable: boolean };

  // UIA tree availability (cheap walk to check first level)
  uia: { available: boolean; rootChildCount: number; estimatedDepth: number };

  // Vision availability (always true on Windows; false in headless CI)
  visionCapable: boolean;

  // Historical metrics for the current process (loaded from ~/.dex/telemetry.sqlite)
  history: {
    perEngine: Record<EngineId, { runs: number; successes: number; avgLatencyMs: number }>;
  };

  // Wall-clock budget (Dex planner can pass a "fast" hint)
  budget: { latencyMs?: number };
}
```

Implementation notes:
- Parallel fan-out: Win32 API + UIA root probe + browser CDP probe run concurrently. Total wall-clock ~30 ms.
- `appFamily` is keyed from a static table (`{"chrome.exe": "browser", "winword.exe": "office", ...}`); zero LLM.
- History fetched from per-process bucket in the telemetry DB (Phase C.7); single SQL query indexed by exePath.

## C.4 — Capability Scoring Engine (target <10 ms)

`dex/orchestration/capability-scorer.ts`:

```typescript
interface TaskIntent {
  kind: "click" | "type" | "navigate" | "extract" | "compose" | "compound";
  hints: string[];        // tokens from user prompt: "github.com", "Excel", etc.
  text?: string;          // raw user prompt for engines that want it
}

interface ScoreBreakdown {
  engine: EngineId;
  score: number;          // 0..1 (composite)
  components: {
    base: number;         // hand-tuned per (engine, appFamily)
    historyPrior: number; // Beta-mean(successes+α, failures+β) from telemetry
    latencyPenalty: number; // -ve weight on slow engines when budget tight
    confidence: number;   // engine's self-reported confidence on this context
  };
  estimatedLatencyMs: number;
}

function scoreAll(ctx: RuntimeContext, task: TaskIntent): ScoreBreakdown[] {
  return ENGINES.map((e) => ({
    engine: e.id(),
    score: w_base * e.baseFor(ctx, task)
         + w_history * priorFromHistory(ctx.history[e.id()])
         + w_latency * latencyPenalty(e.estimateLatencyMs(ctx, task), ctx.budget)
         + w_confidence * e.score(ctx, task),
    components: { /* break out for telemetry */ },
    estimatedLatencyMs: e.estimateLatencyMs(ctx, task),
  })).sort((a, b) => b.score - a.score);
}
```

Weights live in `dex/orchestration/scorer-weights.ts` — single constants file. Tunable. Default: `w_base=0.40, w_history=0.30, w_latency=0.10, w_confidence=0.20`.

Base score table (hand-tuned; refined by telemetry over time):

| Engine | browser | office | ide | game | media | system | unknown |
|---|---|---|---|---|---|---|---|
| UfoUIA | 0.10 | 0.92 | 0.65 | 0.05 | 0.45 | 0.85 | 0.55 |
| BrowserUse | 0.95 | 0.05 | 0.10 | 0.00 | 0.20 | 0.05 | 0.20 |
| OmniParser | 0.30 | 0.40 | 0.45 | 0.92 | 0.70 | 0.30 | 0.60 |

Numbers feed `e.baseFor(ctx, task)`. The router doesn't ask Claude "which engine?" — the table answers in microseconds.

## C.5 — Execution Router (target <5 ms)

`dex/orchestration/router.ts`:
```typescript
export async function route(ctx: RuntimeContext, task: TaskIntent): Promise<RoutedExecution> {
  const scored = scoreAll(ctx, task);          // <10 ms
  const primary = scored[0];
  const fallbacks = scored.slice(1, 3);        // top 2 alternates
  return { primary, fallbacks, scoreBreakdown: scored };
}
```

The router is dumb on purpose — picks the highest score, returns the fallback chain. No LLM, no further reasoning. Total <5 ms (sort + slice).

## C.6 — Fallback chain (graceful degradation)

When `primary.execute()` returns `{ok: false, kind: "recoverable"}`:
1. Try `primary.recover?(error)` if defined.
2. If unrecovered, try `fallbacks[0].execute(ctx, task)`.
3. If unrecovered, try `fallbacks[1].execute(ctx, task)`.
4. If all engines fail OR a `kind: "user-confirmation-required"` is returned, surface to the Flutter app as an Action Preview asking the user to take over manually.

Failure classifications go into telemetry (Phase C.7) so the scorer learns "engine X often fails on app Y → reduce X's base score for that appFamily."

## C.7 — Telemetry + self-learning

`dex/orchestration/telemetry.ts` writes to `~/.dex/telemetry.sqlite`:

```sql
CREATE TABLE engine_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  engine_id TEXT NOT NULL,
  process_name TEXT NOT NULL,
  app_family TEXT NOT NULL,
  task_kind TEXT NOT NULL,
  task_hint TEXT,
  latency_ms INTEGER,
  outcome TEXT NOT NULL,  -- 'success' | 'failed' | 'recovered' | 'aborted'
  fallback_used INTEGER DEFAULT 0,
  error_class TEXT
);
CREATE INDEX engine_runs_lookup ON engine_runs (process_name, engine_id);
```

`self-learning.ts` runs every 100 task executions OR on app shutdown:
1. Pulls last N runs per `(process_name, engine_id)`.
2. Computes success-rate prior as Beta(α+successes, β+failures), default α=β=2 (weakly-informative).
3. Writes back a per-context history snapshot the scanner loads on next request — fast read.

No retraining, no models — just statistical priors. Honest and cheap.

## C.8 — Gemini Flash-Lite integration (new LLM option)

User asked: add Gemini 2.0 Flash-Lite as an LLM option across Dex brain, UFO², and browser-use. Surface in Flutter UI alongside Anthropic + Groq.

### C.8.1 Why Flash-Lite specifically
- Multimodal (text + vision) — same key works for OmniParser fallback reasoning.
- Cheapest tier in Google's pricing ($0.075 per M input tokens, ~10× cheaper than Sonnet).
- Low latency (similar to Groq Qwen 3, ~200-400 ms first token).
- Google's OpenAI-compatible endpoint exists: `https://generativelanguage.googleapis.com/v1beta/openai/` — works as a drop-in OpenAI provider for both UFO² (`agents.yaml`) and browser-use.

### C.8.2 Integration points

**Dex brain (`dex/core/`):** add `google` provider to the auth catalog (OpenClaw already has a Google adapter; verify with grep). Onboarding wizard Step 2 adds a third option: "Use Google Gemini (paste API key)".

**UFO² (`vendor/UFO/config/ufo/agents.yaml.template`):** add a commented Gemini block alongside the Groq block:
```yaml
# Gemini Flash-Lite via Google's OpenAI-compatible endpoint:
# HOST_AGENT:
#   VISUAL_MODE: True       # Gemini IS multimodal -- can use vision
#   API_TYPE: "openai"
#   API_BASE: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
#   API_KEY: "<paste your AIza... key>"
#   API_MODEL: "gemini-2.0-flash-lite"
```
Flutter Settings generates this file's `agents.yaml` from the unified config when the user picks Gemini in Settings → Hands (UFO²).

**browser-use (`dex/drivers/browser/server.py`):** browser-use has a native `ChatGoogle` adapter. Server picks the right adapter from the unified config:
```python
def build_llm(provider: str, key: str, model: str):
    if provider == "google":
        from browser_use import ChatGoogle
        return ChatGoogle(model=model, api_key=key)
    elif provider == "groq":
        from browser_use import ChatGroq
        return ChatGroq(model=model, api_key=key)
    elif provider == "anthropic":
        from browser_use import ChatAnthropic
        return ChatAnthropic(model=model, api_key=key)
    raise ValueError(f"unknown provider {provider}")
```

**Flutter Settings panel (`app/lib/screens/settings/panels/brain.dart`):** the Brain → Provider Catalog panel adds a Gemini row:
- Provider: Google
- Model: `gemini-2.0-flash-lite` (or `gemini-2.5-flash`, user-pickable)
- API key input (secret field; writes to `secrets.gemini_api_key` via `core.secretsUpsert`)
- Apply: `UnifiedAgenticCore.setGeminiApiKey(key)` plumbs the key into all three places (Dex brain auth profile + UFO² agents.yaml + browser-use MCP env)

**Flutter onboarding (`app/lib/screens/onboarding/brain.dart`):** Step 2 of the wizard adds a third radio: "Google Gemini (Flash-Lite — free tier available)".

## C.9 — Performance budget (acceptance criteria)

| Phase | Target | Measure |
|---|---|---|
| Context scan | <50 ms | `perf.measure("ctx-scan")` averaged over 100 runs |
| Capability scoring | <10 ms | `perf.measure("score")` |
| Routing decision | <5 ms | `perf.measure("route")` |
| **Total Dex overhead** | **<100 ms** | sum of above |
| Engine planning (within selected engine) | dominant latency | LLM call dominates, as expected |

Fails any of these → revisit weights / hot-path inlining.

## Phase C — Files (NEW)

```
dex/orchestration/
├── context-scanner.ts                    (Win32 + UIA + browser CDP fan-out)
├── capability-scorer.ts                  (base table + history prior + composite)
├── scorer-weights.ts                     (constants)
├── router.ts                             (sort, pick top, return fallback chain)
├── telemetry.ts                          (sqlite writer/reader)
├── self-learning.ts                      (periodic Beta-prior update)
├── engines/
│   ├── ufo-uia.ts                        (adapter for windows-desktop driver)
│   ├── browser-use.ts                    (adapter for browser driver)
│   └── omniparser.ts                     (adapter for omniparser driver)
├── types.ts                              (RuntimeContext, TaskIntent, ScoreBreakdown, ExecResult)
└── README.md                             (orchestration design doc)

dex/drivers/omniparser/
├── server.py                             (FastMCP wrapper around omniparser inference)
├── SKILL.md                              (when Dex should invoke vision; very narrow)
├── requirements.txt                      (torch, onnxruntime, opencv)
└── inference.py                          (load ONNX weights, run on screenshot, return bboxes)

vendor/omniparser/                        (pinned MIT fork from microsoft/OmniParser)

app/lib/screens/settings/panels/
└── brain_gemini.dart                     (provider catalog row for Gemini)
app/lib/screens/onboarding/
└── brain.dart                            (edit: add Gemini radio)
```

## Phase C — Risks

1. **OmniParser model weight footprint.** ~2 GB. Cannot ship in npm package. Mitigation: lazy-download on first OmniParser invocation, cache under `vendor/omniparser/weights/`. Surface a "downloading vision model (one-time, ~2 GB)" UI in Flutter.
2. **Inference cost.** OmniParser on CPU is 3-8 s per screenshot. Mitigation: route to OmniParser ONLY when score table says so (game / custom-drawn / no-UIA contexts). Most users never invoke it.
3. **Score-table tuning is hand-wavy.** Mitigation: ship with the table from §C.4 and let telemetry adjust per-process priors over 100+ runs. Document weights as "v1 estimates; expected to evolve."
4. **Self-learning could amplify a bad early run.** Beta-prior with α=β=2 keeps the impact small until ~20 runs accumulate. Mitigation already in formula.
5. **Multi-engine fallback explodes latency.** If primary fails AND falls back twice, total wall-clock could exceed 30 s. Mitigation: per-engine timeout ladder (UfoUIA: 15 s, Browser: 60 s, OmniParser: 30 s — totals capped).
6. **Gemini's OpenAI-compat endpoint may not support every UFO² feature.** Tool calling and structured outputs differ subtly between providers. Mitigation: validate with a smoke task per provider in onboarding.

## Phase C — Verification

```powershell
# 1. Orchestration unit tests
cd dex/orchestration && pnpm test

# 2. Performance bench
cd dex && pnpm bench:orchestration
# Expected: ctx-scan p95 <50ms, scoring <10ms, route <5ms

# 3. Engine selection smoke (dex chat):
# - "list my desktop"                  -> Shell (OpenClaw built-in; Phase C doesn't touch shell)
# - "compute 12 x 9 in Calculator"     -> UfoUIA selected (app_family=system, base 0.85)
# - "take typing test at livechat.com" -> BrowserUse selected (app_family=browser, base 0.95)
# - "click Start in <game.exe>"        -> OmniParser selected (app_family=game, base 0.92)

# 4. Telemetry write smoke:
node openclaw.mjs gateway --once-task "compute 12 x 9 in Calculator"
sqlite3 ~/.dex/telemetry.sqlite "SELECT engine_id, outcome, latency_ms FROM engine_runs ORDER BY id DESC LIMIT 1;"

# 5. Gemini smoke (when user selects it in Settings):
# - Flutter Settings -> Brain -> select Google Gemini -> paste AIza... key
# - Chat: "hi" -> reply streams (proves brain works)
# - "open Notepad" -> routes to UfoUIA engine driven by Gemini (proves agents.yaml regen worked)
```

## Phase C — Progress log

- [ ] C.0 — Architecture design committed (`dex/orchestration/README.md`)
- [ ] C.1 — `AutomationEngine` interface + types in `dex/orchestration/types.ts`
- [ ] C.2 — `vendor/omniparser/` cloned + pinned; weight-download placeholder
- [ ] C.3 — `context-scanner.ts` runs Win32 API + UIA + browser CDP probes in parallel; p95 <50 ms on smoke
- [ ] C.4 — `capability-scorer.ts` + base table + Beta-prior history blend
- [ ] C.5 — `router.ts` sorts + returns fallback chain; p95 <5 ms
- [ ] C.6 — Fallback chain wired in driver dispatch; failure-class telemetry recorded
- [ ] C.7 — `telemetry.sqlite` schema + writer; self-learning Beta-prior update job
- [ ] C.8 — Gemini Flash-Lite available as a third LLM provider in onboarding + Settings + UFO² + browser-use
- [ ] C.9 — Performance bench passes all four budgets
- [ ] C.10 — Three-app routing smoke: Calculator/UFO, livechat/Browser, game/OmniParser
- [ ] C.11 — End-to-end through Flutter: "click Start in Hollow Knight" lights up OmniParser chip in the Live panel

---

# Execution roadmap (the order everything lands)

Per current state and locked decisions:

1. **Finish Phase A acceptance follow-ups** if any test/fixture residual: not required for B/C.
2. **Phase B — ownership migration** (this section's top). 11 commits.
3. **Phase C — orchestration architecture + Gemini + OmniParser**. Lands after B because B renames every file C will create.
4. **v1.2 / v1.3 / v1.4 / v1.5** (earlier sections in this plan) — sequence unchanged, but all of them target the post-B directory layout (`dex/core/`, `dex/drivers/`, `dex/orchestration/`).

When resuming a session: open `D:\project1\PLAN.md`, find the lowest unchecked item, continue from there.

---

# FINAL — Ultraplan-approved execution plan (supersedes earlier Phase B / Phase C drafts above)

> The earlier Phase B (11 commits) + Phase C (8 commits) drafts above were the working sketch. Ultraplan refined them into a tighter 12-commit / 8-commit shape with explicit gates between commits. **This section is canonical** for execution; the earlier drafts remain for context but where they disagree, this section wins.

## B.0 result — npm name availability (locked)

Verified live with `npm view <name>` on 2026-06-04:

| Candidate | npm registry response | Status |
|---|---|---|
| `dexagent` | 404 Not Found | **AVAILABLE** ✅ (locked) |
| `dex-agent` | 404 Not Found | Available (fallback #1) |
| `dexagentic` | 404 Not Found | Available (fallback #2) |

**Locked: `dexagent`** is the npm package name. Binary alias remains `dex`. Install command: `npm install -g dexagent` → `dex --help` works.

## Phase B — refined 12-commit grouping (the actual execution order)

Each commit has a **Gate** that must pass before the next commit lands. Failure rolls back THAT commit only, fixes, re-commits. No `--no-verify`.

```
1. chore(audit):         generate docs/migration/openclaw-audit.md
   GATE: report exists; category counts within ±10% of pre-audit summary
2. chore(rebrand-map):   build-rebrand-map.ps1 emits 500+ entry JSON
   GATE: valid JSON; every entry has find+replace+files glob
3. refactor(env):        dexEnv() shim, OPENCLAW_* one-cycle fallback
   GATE: pnpm test green; bench shows <1% overhead vs raw process.env
4. refactor(config):     ~/.openclaw -> ~/.dex auto-migrator + canonical const
   GATE: seeded ~/.openclaw fixture migrates; idempotent on re-run
5. refactor(workspace):  internal @openclaw/* -> @dexagent/*
   GATE: pnpm install regenerates lockfile clean; pnpm build green
6. refactor(identifiers, src): rebrand.ps1 against core/src (excl. tests)
   GATE: pnpm build green; residual grep on core/dist matches expected list
7. refactor(identifiers, tests): rebrand against tests + fixtures
   GATE: pnpm test green; snapshot tests regenerated cleanly
8. chore(telemetry):     audit + stub outbound .openclaw.ai endpoints
   GATE: fresh-install smoke -- zero outbound calls to *.openclaw.ai
9. chore(structure):     git mv core/->dex/core/, glue/->dex/drivers/
   GATE: pnpm install+build green from D:\project1\dex
10. chore(refs):         update install-skills.ps1, run-dev.ps1, app/, README, PLAN
    GATE: scripts/run-dev.ps1 brings stack up end-to-end
11. docs(heritage):      HERITAGE.md + LICENSES.md attribution + migration report
    GATE: human review of attribution wording
12. chore(publish):      wire dex/package.json publishConfig + npm pack/publish --dry-run + git push
    GATE: dry-run clean; git status clean; remote updated
```

## Phase C — refined 8-commit grouping (after B is on main)

```
C.0  feat(orchestration): types + AutomationEngine interface
C.1  feat(orchestration): context-scanner.ts (Win32 + UIA + browser CDP, parallel)
C.2  feat(orchestration): capability-scorer.ts + scorer-weights + base table
C.3  feat(orchestration): router.ts + fallback chain wired into MCP dispatch
C.4  feat(orchestration): telemetry.sqlite + Beta-prior self-learner
C.5  feat(driver):        dex/drivers/omniparser/ + lazy ONNX weight download
C.6  feat(llm):           Gemini Flash-Lite across core + UFO² + browser-use
C.7  test(orchestration): perf bench + 3-app routing smoke + Flutter chip
```

## Open decisions (defaults locked; user can override at the gate)

| # | Decision | Default | Revisit at |
|---|---|---|---|
| 1 | npm package name | `dexagent` (verified available) | locked |
| 2 | dexEnv() perf cost | ship shim; bench at B.3 gate; inline if >5% regression | B.3 |
| 3 | filename inside ~/.dex/ | keep `openclaw.json` for one cycle; rename in v1.4 | locked |
| 4 | OmniParser weights | lazy-download on first invocation; cache in ~/.dex/models/omniparser/ | C.5 |

## Critical files (where the work concentrates)

Phase B:
- `scripts/build-rebrand-map.ps1` — map generator; quality determines B's success
- `scripts/rebrand.ps1` — existing from Phase A; gains `--exclude-header-lines 10` mode
- `core/src/env/dex-env.ts` — perf-sensitive shim
- `core/src/migrations/config-dir-migrate.ts` — idempotency-critical
- `core/src/config/io.ts` — single source of truth for config dir name
- `dex/package.json` — workspace root post commit 9; npm publish target

Phase C:
- `dex/orchestration/context-scanner.ts` — <50 ms budget; parallel probes
- `dex/orchestration/capability-scorer.ts` — base table + Beta-prior blend
- `dex/orchestration/router.ts` — sort + slice + fallback chain
- `dex/orchestration/telemetry.ts` — sqlite writer; learner input
- `dex/drivers/omniparser/server.py` — ONNX inference behind FastMCP
- `vendor/UFO/config/ufo/agents.yaml.template` — Gemini provider block (C.6)
- `app/lib/screens/onboarding/brain.dart` — third radio for Gemini

## Phase B — verification (must pass before declaring B done)

```powershell
cd D:\project1\dex
pnpm install                                          # bin/.bin/dex regenerated
pnpm build                                            # exit 0
pnpm test                                             # exit 0
node openclaw.mjs --help                              # banner says Dex
node openclaw.mjs gateway --help                      # banner says Dex; "Usage: dex gateway"

# Residual grep -- only allowed survivors: external deps + binary file name
Get-ChildItem dex\core\dist -Recurse -Include *.js,*.mjs |
  Select-String -Pattern 'OpenClaw|openclaw|OPENCLAW' -CaseSensitive:$false |
  Where-Object {
    $_.Line -notmatch '@openclaw/(fs-safe|proxyline)' -and
    $_.Line -notmatch 'openclaw\.mjs'
  }
# Expect: empty

# Auto-migrator smoke
Remove-Item -Recurse -Force ~\.dex -ErrorAction SilentlyContinue
New-Item -ItemType Directory ~\.openclaw | Out-Null
'{"test":true}' | Out-File ~\.openclaw\openclaw.json
node openclaw.mjs gateway --port 18789 --once
Test-Path ~\.dex\openclaw.json                        # True
Test-Path ~\.openclaw\MOVED-TO-DEX.txt                # True

# NPM dry-run
cd dex
npm pack --dry-run                                    # review tarball
npm publish --dry-run                                 # validate manifest

# Git
git status -sb                                        # clean
git push -u origin <branch>                           # full tree
```

## Phase C — verification

```powershell
cd dex && pnpm bench:orchestration
# Expect: ctx-scan p95 <50 ms, scoring <10 ms, route <5 ms

# 4-app routing smoke (in Dex app)
# "list my desktop"                  -> Shell chip
# "compute 12 x 9 in Calculator"     -> Windows app chip (UfoUIA)
# "take typing test at livechat"     -> Browser chip (BrowserUse)
# "click Start in <game.exe>"        -> Vision chip (OmniParser)

# Telemetry
sqlite3 ~\.dex\telemetry.sqlite "SELECT engine_id, outcome, latency_ms FROM engine_runs ORDER BY id DESC LIMIT 5;"

# Gemini
# Settings -> Brain -> Google Gemini -> AIza... key
# Chat "hi" -> reply streams; "open Notepad" -> UfoUIA driven by Gemini
```

## When this plan completes

Phase B leaves `dex/` as the framework root, `dexagent` ready to publish, every user-visible identifier rebranded, env-var deprecation shim in place, config-dir auto-migrator running on first launch. Phase C adds <100 ms tool routing, OmniParser vision fallback, Gemini Flash-Lite as a third LLM provider, and a self-tuning Beta-prior learner.

Next milestone after both: **v1.2 Live action surface + Windows chrome** (existing plan, re-targeted to the post-B directory layout).

## Phase B / C — progress log (canonical, supersedes the per-section logs above)

- [ ] B.0  `dexagent` confirmed AVAILABLE on npm — locked as package name
- [ ] B.1  `docs/migration/openclaw-audit.md` generated + committed
- [ ] B.2  `scripts/build-rebrand-map.ps1` emits 500+ entry `rebrand-map.json`
- [ ] B.3  `dexEnv()` shim; bench <1% overhead at gate
- [ ] B.4  `~/.openclaw` → `~/.dex` auto-migrator; idempotent smoke passes
- [ ] B.5  Internal `@openclaw/*` → `@dexagent/*`; pnpm install clean
- [ ] B.6  Rename pass on core/src; build green; residual grep clean
- [ ] B.7  Rename pass on tests/fixtures; pnpm test green
- [ ] B.8  Outbound `*.openclaw.ai` audited; zero hits on fresh-install smoke
- [ ] B.9  `git mv core/ dex/core/`, `glue/ dex/drivers/`; build green from dex/
- [ ] B.10 install-skills.ps1, run-dev.ps1, app/, README, PLAN updated; run-dev brings stack up
- [ ] B.11 HERITAGE.md + LICENSES.md + dex-migration-report.md written; human review
- [ ] B.12 npm pack/publish --dry-run clean; git push full tree from D:\project1\
- [ ] C.0  `AutomationEngine` interface + types
- [ ] C.1  `context-scanner.ts` p95 <50 ms
- [ ] C.2  `capability-scorer.ts` + base table
- [ ] C.3  `router.ts` + fallback chain; p95 <5 ms
- [ ] C.4  `telemetry.sqlite` + Beta-prior learner
- [ ] C.5  `dex/drivers/omniparser/` + lazy weight download
- [ ] C.6  Gemini Flash-Lite available across core + UFO² + browser-use + Flutter Settings
- [ ] C.7  Perf bench green; 4-app routing smoke passes; Flutter chip lights up correctly

---

# Locked direction (post-2026.6.8 — supersedes v1.3 + parts of v1.4)

> The sections above describe the original plan that ran through Phase B
> (rebrand) and Phase C (orchestration). This section captures direction
> changes locked AFTER the first npm publish. Where this section
> contradicts earlier text, **this section wins**. Earlier sections stay
> for historical context only.

## Direction summary

1. **One channel: `dex client`.** Drop every third-party messenger.
2. **Mobile is native** (Kotlin + Jetpack Compose, Swift + SwiftUI). Flutter is desktop-only.
3. **Onboarding/setup/configure moves into the desktop GUI.** CLI stays as headless fallback.
4. **Every API-key prompt links to the issuer's "get a key" page.**
5. **UI bar: Linear / Raycast / Arc tier.** No compromises.

These five items rewrite v1.3 (per-platform UI + mobile pairing) and expand v1.4 (UnifiedAgenticCore + onboarding) — see per-section detail below.

## D.1 Channel consolidation: only `dex client`

### Decision
Dex is **not** a multi-channel agent. The only way a user talks to their Dex is through the official Dex client app (desktop or mobile). No Telegram bot, no WhatsApp pairing, no Slack workspace, no Discord server.

### What this means for `dex/core/extensions/`
The ~25 channel plugins under `extensions/` (telegram, whatsapp, discord, slack, signal, imessage, irc, matrix, msteams, feishu, line, mattermost, nextcloud-talk, nostr, synology-chat, tlon, twitch, zalo, zalouser, qqbot, sms, voice-call, google-meet, googlechat) are demoted from "bundled" to "opt-in plugin install".

Two options for execution:
- **Option A (recommended, less destructive):** keep them in `extensions/` source but exclude them from the npm tarball + bundled plugin metadata. Users who explicitly install one (`dex plugins install @dexagent/telegram`) get the old behaviour. The bundled default ships with **only** the `dex-client` channel.
- **Option B (clean cut):** delete the 25 channel plugins outright. Smaller npm tarball (~30 MB savings), simpler maintenance, but irreversible without re-vendoring.

Pick A first. If the user never touches the channel plugins for 3 months, switch to B in v1.5.

### What `dex-client` channel does
A single bundled plugin under `extensions/dex-client/` that handles:
- WebSocket connection from the local Dex app (desktop or mobile)
- Pairing tokens (QR-based for mobile, auto-token for local desktop)
- Encrypted message stream (gateway ↔ client)
- Push notifications (APNs for iOS, FCM for Android — through the Dex-owned push relay, replacing the `ios-push-relay.openclaw.ai` endpoint that B.8 stubbed)

This replaces the v1.3 "QR pairing + dex-relay/" design. The relay lives **inside** the gateway as a built-in plugin; no separate `dex-relay/` Dart server.

## D.2 Mobile = native, not Flutter

### Android client (`apps/mobile/android/` — NEW path)
- **Language**: Kotlin 2.x
- **UI toolkit**: Jetpack Compose + Material 3 Expressive
  - Use the JetBrains Compose + AndroidX Material 3 1.4+ `MaterialExpressiveTheme` APIs natively: `ButtonShapes` morph animations, the morphing-polygon `LoadingIndicator`, large-area carousel components, expressive typography
  - Wallpaper-derived dynamic color via `dynamicColorScheme()` on Android 12+
  - Edge-to-edge with adaptive insets, predictive-back animations
- **Networking**: Ktor client over WebSocket to the user's paired gateway
- **Local storage**: SQLDelight for the conversation cache + pairing tokens
- **Minimum Android version**: 12 (API 31) for Material You + adaptive icons
- **Build system**: Gradle with version catalogs

### iOS client (`apps/mobile/ios/` — NEW path)
- **Language**: Swift 6
- **UI toolkit**: SwiftUI with iOS 18+ Liquid Glass
  - `.glassEffect()` for floating cards
  - `Material.regular` / `Material.thin` for nav bars, sidebars
  - SF Symbols 6 with monochrome/hierarchical/palette rendering modes
  - System tinting follows iOS user setting
- **Networking**: URLSessionWebSocketTask
- **Local storage**: SwiftData for messages + pairings
- **Minimum iOS**: 18.0 (Liquid Glass requires it)
- **Build system**: XcodeGen + xcconfig (matches the existing `apps/ios/` upstream patterns we kept for reference)

### Flutter scope (LOCKED: desktop only)
In `app/pubspec.yaml`:
- **Keep**: `flutter run -d windows`, `flutter run -d linux`, `flutter run -d macos`
- **Disable / remove**: `flutter run -d android`, `flutter run -d ios`
- The mobile platform abstraction work from v1.3 (DexCard / DexButton factory based on `Theme.of(context).platform`) is reduced to **three** platforms: Windows / Linux / macOS
- macOS gets liquid-glass-style blocks via `BackdropFilter` + translucent `Material` overlay; the iOS/Android-targeted Flutter code paths from v1.3 are removed

### Heritage code under `dex/core/apps/{android,ios,macos}/`
- These were the OpenClaw native apps. They become **reference material** for the new native clients but the new clients live at `D:\project1\apps\mobile\{android,ios}\` (or similar new path, decided when work starts) — NOT inside `dex/core/`.
- The macOS native app under `dex/core/apps/macos/` is **deleted in v1.5** — Flutter desktop covers macOS.

## D.3 Desktop GUI absorbs CLI onboarding

### What moves from CLI → GUI

All of the following CLI commands get a GUI screen in the Flutter desktop app:

| CLI command | GUI screen |
|---|---|
| `dex onboard` | First-run wizard (welcome → brain → hands → approve) |
| `dex setup` | Settings → "Reset Dex" → re-run wizard |
| `dex configure` | Settings → all 30+ panels (already planned in v1.4 §16) |
| `dex doctor` | Settings → Diagnostics → "Run health check" button + repair UI |
| `dex doctor --fix` | "Apply recommended repairs" within the same screen |
| `dex channels add` | Settings → Channels → Pair device flow |
| `dex models status` | Settings → Brain → Provider Catalog (live status badges) |
| `dex models set primary` | Settings → Brain → Model dropdown |
| `dex plugins list` | Settings → Tools → MCP servers + Skills |
| `dex plugins enable/disable` | Toggle inside the same Tools panel |
| `dex update` | Settings → About → "Check for updates" button |
| `dex auth` | Per-provider auth flow inside Brain panel (api key paste + OAuth + claude-cli) |

The CLI commands stay for headless / SSH / scripting use, but the canonical user experience is **GUI**.

### Implementation lift on top of v1.4

v1.4 (Phase 14-17 in earlier sections) already planned the Flutter onboarding wizard + 30+ settings panels via `UnifiedAgenticCore`. D.3 just locks the scope: every CLI flow that the upstream OpenClaw shipped must have a GUI equivalent. Estimate: +30% on the v1.4 budget (roughly 1 extra week for the doctor + diagnostics + update UI on top of what v1.4 already covered).

## D.4 API-key links in every prompt

Wherever the GUI asks the user to paste a credential, render a "Don't have one? Get it here →" link that opens the issuer's signup / key-management page.

### Authoritative URL table
Keep this list in `dex/core/src/auth/key-issuer-urls.ts` (new file). Single source of truth that every GUI form imports.

| Provider | Get-key URL | Notes |
|---|---|---|
| Anthropic | https://console.anthropic.com/account/keys | Also supports `claude-cli` OAuth — show both options |
| Google AI Studio (Gemini API key) | https://aistudio.google.com/app/apikey | Free tier exists |
| Google Cloud (Vertex / Workspace OAuth) | https://console.cloud.google.com/apis/credentials | Need a GCP project first |
| Groq | https://console.groq.com/keys | Free tier; default for UFO² + browser-use |
| OpenAI | https://platform.openai.com/api-keys |  |
| OpenRouter | https://openrouter.ai/keys | Routes to many providers |
| Mistral | https://console.mistral.ai/api-keys |  |
| Perplexity | https://www.perplexity.ai/settings/api |  |
| ElevenLabs (TTS) | https://elevenlabs.io/app/settings/api-keys |  |
| Deepgram (STT) | https://console.deepgram.com/project/default/keys |  |
| Azure Speech | https://portal.azure.com → Cognitive Services → Keys | Region-specific |
| Brave Search | https://brave.com/search/api/ |  |
| Tavily | https://app.tavily.com/home |  |
| Firecrawl | https://www.firecrawl.dev/app/api-keys |  |
| Exa | https://dashboard.exa.ai/api-keys |  |

Pattern in the GUI:
```
┌──────────────────────────────────────────────────┐
│  Anthropic API key                               │
│                                                  │
│  [ sk-ant-...                              ]     │
│                                                  │
│  Don't have one yet? → Get an Anthropic API key  │
│                                                  │
│  [Skip] [Continue]                               │
└──────────────────────────────────────────────────┘
```

Link styling: subtle, underlined, accent color (sand). Click opens the URL in the user's default browser via `url_launcher`.

## D.5 UI quality bar

### Reference UIs
- **Linear** for the desktop chat density + keyboard-first feel
- **Raycast** for the command bar + ⌘K interactions
- **Arc / Vivaldi** for the multi-panel layout flexibility
- **Material 3 Expressive showcase** for Android animation language
- **iOS 18 Apple stock apps** for Liquid Glass usage

### Concretely
- Every screen has a keyboard shortcut (visible in `?` overlay)
- Motion respects `MediaQuery.disableAnimations`
- All colors come from `tokens.dart` / `palette.ts` — no hex literals anywhere else
- Empty states have illustrations or animated placeholders, never blank screens
- Loading states are M3 morphing polygons (Android), Liquid Glass shimmer (iOS), and a subtle dot pulse (Desktop)
- Error states give the user a next action ("Retry", "Open settings", "Contact support") — never just dump a stack trace

## D — Open questions before execution

1. **Option A vs B for channel plugins** (keep-as-opt-in vs delete). Locked default: A. Revisit at v1.5 if no one installs them.
2. **macOS native app deletion** — drop `dex/core/apps/macos/` in v1.5 (Flutter desktop covers macOS). Confirmed.
3. **iOS minimum 18.0** locks out users on iOS 17 hardware. Acceptable tradeoff for Liquid Glass. If we need iOS 17 support later, add a non-glass fallback theme.
4. **Mobile-app distribution**: Play Store + App Store TestFlight initially. Open-source codebase, signed builds via the user's own developer accounts.

## D — Execution order (added to the canonical roadmap)

The post-2026.6.8 roadmap is:

1. **Phase C** (orchestration + OmniParser + Gemini Flash-Lite) — as already planned. Still next.
2. **v1.2** (Live action surface + Stop button + Windows chrome) — as planned.
3. **D.3 implementation** — move CLI onboarding into the desktop GUI. This was v1.4 §15-§16; D.3 widens scope to cover doctor, update, models, plugins, etc.
4. **D.4 implementation** — `key-issuer-urls.ts` + GUI form components. Small (~1 day) but high-impact.
5. **D.1 implementation** — channel consolidation. Build the `dex-client` channel plugin; demote the rest behind a feature flag.
6. **D.2 mobile clients** — Android (Kotlin Compose) + iOS (SwiftUI Liquid Glass). Separate workstream from desktop; mobile MVP timeline ~6-8 weeks for both platforms.
7. **v1.5** (installer + production polish) — unchanged except for the macOS-native-app deletion.

## D — Concrete first commits when greenlit

- `feat(channel): scaffold dex-client channel plugin (one channel to rule them all)` — D.1 starter
- `feat(auth): central key-issuer URL registry` — D.4 starter (`dex/core/src/auth/key-issuer-urls.ts`)
- `feat(app): GUI doctor screen (CLI alias kept)` — D.3 starter
- `feat(mobile-android): scaffold Kotlin Compose client at apps/mobile/android/` — D.2 Android starter
- `feat(mobile-ios): scaffold SwiftUI client with Liquid Glass at apps/mobile/ios/` — D.2 iOS starter

Each is a single commit that lands a working scaffold. Layering the real features on top happens in subsequent commits per phase.

---

## Plan-file consolidation note

After this section lands, the canonical plan lives **only** in this file. The supporting docs in `D:\project1\docs\` stay as reference material:

- `docs/usecases.md` — end-user use cases (not plan)
- `docs/architecture/apps-and-extensions.md` — repo-tree map (not plan)
- `docs/architecture/what-is-next.md` — short pointer to this file (the long-form plan lives here, not there)
- `docs/migration/openclaw-audit.md` + `dex-migration-report.md` — Phase B artifacts (not plan)
- `PLAN.md` at repo root — mirrored progress tracker, checks off phases as they land

When resuming work on Dex, open this slash-plan file first.

---

# Phase E — Shared VisionService (post-C, before v1.2)

> **Why this lands now.** The Phase C plan registered OmniParser as the
> fourth `AutomationEngine` and let the router pick it in pure-vision
> contexts (games, fully unmapped surfaces). That's still correct for
> the "no DOM, no UIA" case. But for the user's locked target use cases
> (designing in Figma in a browser, automating Miro / Canva, driving a
> legacy Win32 app whose UIA tree is *sparse* not *empty*), the right
> shape is **OmniParser as a shared vision SERVICE that the
> already-chosen engine can call mid-run**, not as a sibling engine
> that replaces it.
>
> The router still owns the "who drives this task" decision. The
> executing engine — browser-use for the browser, ufo-uia for the
> desktop — owns "how do I find an element". When its primary probe
> (DOM / UIA) returns nothing actionable for the target region, it
> hands the screenshot to the vision service, gets back `[(bbox,
> label, type)]`, then completes the click / type via ITS OWN
> input channel (Playwright / Win32 SendInput). OmniParser the
> engine stays for pure-pixel surfaces where there is no input
> channel except SendInput-on-screen-coords.
>
> This came out of a 2026-06-05 review of an external proposal that
> wanted to make OmniParser the only vision path AND change the
> routing default to "canvas → UFO²". The first half is right
> (vision should be a service); the second half is wrong (UFO² has
> no business inside a browser canvas). Phase E keeps the good
> half.

## E.0 — What changes vs. the Phase C / C.7 shape

| Surface | Before (Phase C) | After (Phase E) |
|---|---|---|
| `AutomationEngine` registry | shell, ufo-uia, browser-use, omniparser (peers) | unchanged — OmniParser stays as a peer for pure-pixel surfaces |
| Capability scorer | picks one engine, that engine runs the whole task | unchanged — single-engine-per-task is still the model |
| Browser-use on a Figma canvas | router scores it low → OmniParser wins (incoherent: OmniParser can't click in the browser) | router still picks browser-use; **browser-use calls VisionService internally** to map canvas elements |
| UFO² on a sparse-UIA app | router scores it lower → OmniParser may win | router still picks ufo-uia; **ufo-uia calls VisionService** when UIA returns no actionable hit |
| Telemetry | `engine_runs` rows only | adds `vision_calls` column + a `vision_assist_used` boolean so the learner notices "browser-use needed vision 80% of the time on figma.com" → next time, raise OmniParser's base score for that origin |
| Live panel chip | shows engine | shows engine + a tiny "vision-assist" sub-state when the running engine borrowed vision mid-task |

## E.1 — `VisionService` interface (new)

`dex/core/src/orchestration/vision.ts`:

```typescript
export interface VisionService {
  /**
   * Ask the vision service to locate UI elements on the current screen.
   * Returns `[]` when stub mode is active OR the service is unavailable;
   * callers MUST treat empty as "no help, fall back to your normal
   * 'element not found' branch" -- NOT as success-with-zero-elements.
   */
  locate(req: VisionRequest): Promise<VisionHit[]>;

  /** Cheap availability probe; cached. */
  ready(): Promise<boolean>;
}

export interface VisionRequest {
  /** Optional screen region (relative to the running engine's target
   *  surface — browser viewport for browser-use, native window for
   *  ufo-uia). When undefined, vision uses the full active surface. */
  region?: { x: number; y: number; w: number; h: number };
  /** Free-form hint about what we're looking for ("Export button",
   *  "the blue cart icon"). Helps the vision model when it has to
   *  rank multiple candidate elements. */
  hint?: string;
  /** Caller's wall-clock budget. Vision honors this. */
  timeoutMs: number;
}

export interface VisionHit {
  bbox: [number, number, number, number]; // x, y, w, h
  label: string;
  type: string;     // button | input | image | text | ...
  confidence: number; // 0..1
}
```

Implementation lives in `dex/drivers/omniparser/server.py` (the existing
FastMCP server). The TS service is a thin adapter that calls the same
`parse_screen` MCP tool the OmniParser engine already uses. One MCP
server, two callers (the engine + the service) — no duplicate Python
process, no FastAPI sidecar.

## E.2 — Engine adapters get an optional `vision` slot

`AutomationEngine` interface grows ONE optional field on construction:

```typescript
export interface AutomationEngineOptions {
  vision?: VisionService;
}
```

`BrowserUseEngine` and `UfoUiaEngine` accept it and call
`vision.locate(...)` when their normal lookup falls through. OmniParser
the engine doesn't need a service — it IS one. Shell engine doesn't
need vision. So only two engines change.

## E.3 — Canvas detection hook (browser-use only)

`dex/drivers/browser-control/server.py` learns one extra check: before
each `Agent.run()` step, peek at the active element shape. If
Playwright reports the active region is a `<canvas>` (or a
`<div>` with no descendant interactive elements that covers >60% of
the viewport), call vision PROACTIVELY before consulting the LLM
about the next action. This is the Figma / Miro / Canva fix.

When vision returns hits, browser-use's prompt to its LLM includes
them as text:
```
The visible canvas has these interactive elements (from screen
parser, may be partial):
  - "Export" (button) at viewport (1180, 28, 64, 24)
  - "Frame 1" (image) at viewport (60, 80, 200, 320)
  - "Tools" (toolbar) at viewport (0, 60, 56, 600)
Pick one and click it via mouse.click({x, y}).
```

The LLM stays in the loop — vision feeds it candidates, doesn't
replace it. browser-use then completes the click via `page.mouse.click`
at viewport coords. The user sees the Browser engine chip light up in
the Live panel WITH a `vision-assist` sub-tag.

## E.4 — UFO² gets the same hook

`dex/drivers/windows-desktop-control/server.py` already shells out to
UFO². UFO² already has built-in OmniParser integration (Microsoft's
own design). Phase E just makes sure Dex's vision service and UFO²'s
internal call BOTH route to the same `parse_screen` MCP tool so we
don't run inference twice for the same screenshot — single cache, one
backend.

## E.5 — Scorer + telemetry update

`telemetry.ts` `EngineRunRecord` schema gains:
- `visionAssistUsed: boolean` — true when the engine called the
  vision service at least once during the run
- `visionLatencyMs: number | null` — total wall-clock spent in
  `vision.locate(...)` for this run

`self-learning.ts` adds a rule: if for a given `(process_name,
domain)` pair, `visionAssistUsed` is true on ≥70% of recent runs AND
the run still succeeded, bump that engine's base score DOWN by 0.1
and OmniParser engine's base score UP by 0.1 for that
`(process_name, domain)`. This lets the router learn over time
"figma.com always needs vision → schedule OmniParser engine
directly next time" without hand-tuning the table.

The rule is conservative — it only fires after telemetry crosses
20 runs in that bucket so a single noisy session can't move the
weights.

## E.6 — Live panel chip sub-state

`Message.engine` already carries the routed engine (shipped in
C.7-flutter). Add `Message.visionAssist: bool` defaulting to false.
When the gateway emits a `vision-assist` event mid-run, the
ConversationStore flips the running chip's `visionAssist` to true.
The chip renders a tiny eye-icon badge next to the engine pill so
the user can SEE "browser-use is currently borrowing vision".

If vision-assist fires for >3 consecutive steps in one run, the
LiveEntry card (v1.2) elevates a hint: "browser-use is leaning on
vision a lot here — consider letting Dex switch engines."

## E.7 — Acceptance

1. **Figma export smoke (the user's stated target).**
   - Open a Figma file in Chrome.
   - Ask Dex: "Open this Figma file, click Export, export the
     current frame as PNG to my Downloads folder."
   - Expected:
     - Router picks `browser-use` (chrome.exe → browser family, DOM
       available)
     - browser-use detects the canvas, asks VisionService for
       "Export"
     - Vision returns the bbox, browser-use clicks via Playwright
     - Live panel chip shows `Browser` engine pill + a small
       `vision-assist` eye badge
     - File lands in Downloads

2. **Cross-app data bridge smoke (the killer use case).**
   - Web phase: scrape supplier invoices from a portal (browser-use)
   - Shell phase: parse the downloaded PDFs (shell engine)
   - Desktop phase: type the data into a legacy Win32 ERP (ufo-uia,
     with vision-assist on the un-mapped fields)
   - The Live panel shows three engine chips in sequence — one for
     each phase — and the second + third each get their own
     vision-assist badge where needed.

3. **No regression on pure-vision smoke.** A game running
   fullscreen still routes to OmniParser engine directly (router's
   BASE_SCORE_TABLE still says game family → omniparser=0.92).
   VisionService never enters the picture for that run because the
   primary engine IS the vision engine.

## E.8 — Risks

1. **Two callers, one MCP server.** If we accidentally let the
   engine + the service both spawn separate parse_screen runs on the
   same screenshot, we double the inference cost. Mitigation: the
   vision service caches the most-recent screenshot+result for 500
   ms, keyed by screenshot SHA. Both callers go through the cache.

2. **Vision becomes a crutch.** Engines might lean on vision when
   their primary probe would have worked with one more retry.
   Mitigation: the self-learning rule from E.5 catches this
   indirectly — if vision is called often AND the run succeeds, we
   route to OmniParser engine next time, eliminating the vision-call
   overhead on the wrong engine.

3. **LLM-in-the-loop bloat.** Feeding vision hits as text into the
   browser-use LLM prompt grows tokens. Mitigation: cap to the 12
   highest-confidence hits, sorted by distance from the cursor /
   active region center.

## E.9 — Order of execution

After Phase C.7 (shipped) and before v1.2:

```
E.0 — vision.ts interface
E.1 — VisionService impl in dex/orchestration; wraps existing
       OmniParser MCP server (no new Python process)
E.2 — BrowserUseEngine.vision + UfoUiaEngine.vision option
E.3 — Canvas detection hook in browser-control/server.py
E.4 — Cache layer so engine + service share one parse_screen result
E.5 — telemetry schema bump + self-learning Beta-prior adjustment
E.6 — Flutter: Message.visionAssist + chip eye badge
E.7 — Acceptance: Figma export smoke + cross-app data bridge smoke
```

## E.10 — What we explicitly REJECTED from the external proposal

- "Route canvas / Figma tasks to UFO²" — incoherent. UFO² uses
  Windows UIA; a browser canvas has no UIA tree. Browser-use
  remains the executor, vision is the assistant.
- "FastAPI on localhost:8000 for OmniParser" — the rest of Dex
  speaks MCP/FastMCP. Keeping one transport is a maintenance
  win that outweighs the cosmetic upgrade of REST endpoints.
- "Replace the system prompt with a 'Thinking Process:' template"
  — leaks chain-of-thought into user-facing replies. The Dex
  brain prompt stays minimal; the Live panel + tool chips are
  where the user sees Dex's reasoning, not in the prose stream.

## Phase E — Progress log

- [x] E.0  `vision.ts` interface + `VisionRequest` / `VisionHit` types
- [x] E.1  `OmniParserVisionService` wraps the existing parse_screen MCP tool
- [x] E.2  BrowserUseEngine + UfoUiaEngine accept optional `vision`
- [x] E.3  Canvas detection hook in browser-control/server.py
       (heuristic domain match shipped 2026.6.20; Playwright DOM scan
       + OmniParser pre-parse deferred until OmniParser MCP installable)
- [ ] E.4  500 ms screenshot cache shared between engine + service
- [ ] E.5  telemetry visionAssistUsed + self-learning rule
- [ ] E.6  Flutter: chip eye badge when vision-assist fires
- [ ] E.7  Figma export smoke passes; cross-app data bridge smoke passes
- [ ] E.8  Pure-vision smoke (game fullscreen) unchanged — no regression

---

# D.2 expanded — Native mobile architecture (codegen, parity, build)

> **Status going in.** The earlier D.2 section locked the high-level
> call: Android = Kotlin + Jetpack Compose + Material 3 Expressive,
> iOS = Swift 6 + SwiftUI + iOS 18 Liquid Glass, Flutter is desktop-
> only. This sub-block (added 2026-06-05) formalizes the *how* —
> the bridge-cost ledger that justifies going native, the codegen
> rule that keeps the wire protocol consistent across three
> codebases, the design parity contract that prevents UI drift, the
> CI pipeline per platform, and the explicit MVP scope.
>
> Sequence does NOT change: Phase E (VisionService) and v1.2
> (desktop Live action surface + Stop + Windows chrome) still come
> first. Native mobile work is its own ~6-8 week chunk that begins
> after v1.2 ships. This block makes that chunk executable without
> re-deciding architecture later.

## D.2.1 — Why native, concretely (the bridge-cost ledger)

Going native is justified because the mobile Dex client needs OS
surfaces Flutter would platform-channel into. Each item below is
~1 native file vs a MethodChannel + Flutter plugin maintenance
burden on the desktop side. Naming them here makes the trade
explicit so future "why not Flutter Mobile?" questions have a
concrete answer.

**Android (Kotlin + Compose):**
- Foreground Service for the persistent WebSocket → keeps the
  desktop connection alive when the app is backgrounded. Pure
  `Service` + `ServiceCompat.startForeground` — no Flutter
  equivalent that survives Doze without third-party plugins.
- App Widget on the home screen → live "what's Dex doing right
  now" tile using `AppWidgetProvider` + `RemoteViews`. Flutter has
  no first-class App Widget API.
- Quick Settings Tile ("wake Dex desktop") → `TileService`.
- Share Sheet receiver → declare `<intent-filter>` for
  `ACTION_SEND` and Dex appears in every app's share menu.
- BiometricPrompt for pairing-token unlock → `androidx.biometric`
  one-liner; Flutter's `local_auth` is a wrapper that lags real
  API.
- NotificationListenerService → opt-in cross-app routing
  (read incoming notifications, forward selected ones to the
  desktop). Privileged on Android; no Flutter plugin offers it.
- Wear OS sibling target (optional, post-MVP) → same Gradle
  project, separate `wear/` module. Flutter has no Wear OS path.

**iOS (Swift 6 + SwiftUI):**
- Background URL Session → keeps the WebSocket alive under iOS's
  strict background rules; `URLSessionWebSocketTask` with
  background configuration.
- Live Activities + Dynamic Island → `ActivityKit` showing the
  desktop's currently-running engine (the running-engine card
  from C.7-flutter, but in your peripheral vision on the lock
  screen and the Dynamic Island). No Flutter path exists.
- WidgetKit home + lock screen widgets → SwiftUI widget targets.
- Share Extension → separate target, ships in the same app
  bundle.
- App Intents → Siri / Shortcuts integration ("Hey Siri, ask
  Dex to ..."). Swift-only API surface.
- Face ID via `LocalAuthentication` → for pairing-token unlock.
- watchOS sibling target (optional, post-MVP) → same Xcode
  workspace, separate target.

**Cross-platform (would also apply to Flutter, listed for
completeness):**
- APNs / FCM push receipt → Dex desktop wakes the phone via the
  Dex push relay. Both ecosystems have idiomatic native APIs;
  Flutter's `firebase_messaging` works fine here, so this is the
  one surface where native isn't a clear win — we still pick
  native to keep the codebase shape consistent with the rest.

## D.2.2 — Protocol layer stays shared (codegen, NOT KMP)

The 2× codebase risk (Kotlin + Swift hand-translation of the
same wire shapes) is mitigated by codegen, not by adopting Kotlin
Multiplatform or Compose Multiplatform — both of those are
separate build systems that we'd have to learn + maintain.

**Single source of truth:**
`dex/core/packages/gateway-protocol/src/schema/*.ts` Zod schemas.
Every wire frame, error code, session token shape, pairing
envelope already lives there because the desktop client uses it.

**Codegen pipeline:**
1. New script `scripts/codegen-mobile-protocol.ps1` runs
   `quicktype` (or `zod-to-typescript-to-quicktype` if Zod direct
   isn't clean) over the schema files.
2. Emits Kotlin data classes to
   `apps/mobile/android/shared/protocol/src/main/kotlin/com/chethan/dex/protocol/`.
3. Emits Swift structs to
   `apps/mobile/ios/Shared/Protocol/Sources/DexProtocol/`.
4. Each emitted file gets a banner:
   `// GENERATED FROM dex/core/packages/gateway-protocol/...
    DO NOT EDIT BY HAND.`
5. CI checks `git diff --exit-code` after regen — drift fails the
   build, forcing a re-gen commit.

**What we generate:**
- Wire frame shapes (`ConnectParams`, `ChatSendParams`,
  `ChatAbortParams`, `GatewayEvent` variants)
- Error code enums (`ConnectErrorDetailCodes`)
- Session / pairing structs
- Engine ids (mirror the TS `EngineId` union as a sealed Kotlin
  class + Swift enum so the routing chip vocabulary stays in
  sync across all three clients)

**What we do NOT generate:**
- UI state machines (each platform writes idiomatic state for
  itself)
- Animations / theme tokens (see D.2.3)
- Network transport logic (Ktor on Android, URLSession on iOS)

## D.2.3 — Design parity contract (what's shared, what's native)

Side-by-side screenshots of the Android client and the iOS
client should read as "same product, native idioms" — not
"Flutter app twice" and not "two unrelated apps that share a
backend".

**Shared (identical hex values, identical timing constants):**
- Color tokens: Dex sand palette pulled from
  `app/lib/theme/tokens.dart` and mirrored verbatim into
  `apps/mobile/android/.../theme/DexColors.kt` and
  `apps/mobile/ios/.../Theme/DexColors.swift`. Codegen could
  do this too; for v1 we hand-mirror because there are ~30
  colors total and they rarely change.
- Motion timing budgets: 120 ms fade-rise, 160 ms color
  cross-fade, 220 ms slide. Same numbers in both native
  animation systems.
- Copy: error messages, empty-state hints, button labels.
  English source-of-truth lives in `apps/mobile/_strings/en.json`;
  each platform imports it into its native string resource format
  (`strings.xml`, `Localizable.strings`).
- Iconography family: SF Symbols 6 on iOS, equivalent Material
  Symbols on Android (Material Symbols is a 1:1 design alignment
  with SF Symbols where possible — same metaphors for the same
  actions).
- State vocabulary: `idle`, `thinking`, `acting`, `awaiting`,
  `error`. Same enum values, same colors, same glyphs.
- Engine pill rendering rules: engine icon + lowercase label
  (`shell`, `ufo-uia`, `browser-use`, `omniparser`), same color
  per engine.

**Platform-native (intentionally different):**
- Navigation patterns: back-swipe-edge on iOS, predictive-back
  on Android. No custom navigation override.
- System controls: `SegmentedControl` / `UIDatePicker` / native
  share sheet on iOS; `SegmentedButton` (M3) / Android share
  sheet on Android.
- Gestures: native long-press / 3D-touch peek on iOS, hold-
  context on Android.
- Haptic feedback: `UIImpactFeedbackGenerator` (iOS) vs
  `HapticFeedback.performHapticFeedback` (Android). Both fire on
  the same product moments (approval click, run start, run
  done); the *intensity* picks the platform-native default.
- System integration affordances: Dynamic Island (iOS only),
  Quick Settings Tile (Android only). Each platform gets its own
  feature; we don't try to fake the other.

**The contract:** if a future PR adds a new color or motion
duration to one platform without adding it to the other two,
the design-parity lint (a small script that diffs the three
token files) flags it.

## D.2.4 — Build pipeline + signing

Each platform stays in its native build system. No `flutter
build` indirection on mobile.

**Android:**
- Gradle + version catalogs (`gradle/libs.versions.toml`)
- Kotlin 2.x, Compose BOM, Material 3 Expressive 1.4+
- `./gradlew assembleRelease` on a Linux GitHub Actions runner
- Signing: Play App Signing (Google holds the upload key; we
  sign with an upload-only key checked into `apps/mobile/android/
  signing/upload-key.jks` — encrypted via git-crypt, NOT
  committed in plaintext)
- Output: `.aab` for Play Store, `.apk` for sideload-able
  builds posted to GitHub releases

**iOS:**
- XcodeGen + xcconfig (declarative project generation; the
  `.xcodeproj` is regenerated from `apps/mobile/ios/project.yml`
  on every build, so the file isn't a giant merge-conflict
  vector)
- Swift 6, SwiftUI iOS 18+, Swift Package Manager for deps (no
  CocoaPods)
- `xcodebuild -workspace ... -scheme Dex archive` on a macOS
  GitHub Actions runner
- Signing: ASC API key for the developer account (env-injected
  in CI). Fastlane match optional but not v1-required.
- Output: `.ipa` for TestFlight (initially) + App Store

**Desktop (Flutter, unchanged):**
- `flutter build windows` on a Windows runner
- `flutter build macos` on a macOS runner
- `flutter build linux` on a Linux runner

**Shared CI step (runs first on every platform):**
- `scripts/codegen-mobile-protocol.ps1` (or `.sh` for Linux/mac
  runners) regenerates the protocol files; if `git diff` is
  non-empty, the job fails with a "run codegen and commit"
  message.
- `scripts/check-design-parity.ps1` diffs the three token
  files; non-zero diff fails the job.

**Release flow:**
- Tag `v1.5-android-N` cuts an `.aab` to Play Store internal
  track.
- Tag `v1.5-ios-N` cuts a TestFlight build.
- Tag `v1.5` (no suffix) cuts the desktop installer (existing
  v1.5 flow).
- Each platform tags independently so a bad mobile build doesn't
  block the desktop release.

## D.2.5 — Mobile feature MVP scope (what ships first)

The locked direction said "~6-8 weeks for mobile MVP". This
sub-section names what lands in that window and what's
explicitly deferred. The phone is a remote-control surface for
the desktop, not a standalone agent.

**MVP — ships first (both platforms, feature-parity):**
1. **Pairing flow** — scan QR from desktop tray menu, store
   continuation token in OS keychain/keystore, biometric-unlock
   on every app open.
2. **Chat surface** — single-column conversation, message
   bubbles for human + agent, tool chips (with engine pill from
   C.7-flutter mirrored), input field that respects native keyboard.
3. **Live status** — when desktop is running an engine, the
   phone shows it:
   - iOS: Live Activity in Dynamic Island + lock screen
   - Android: persistent foreground notification with the
     engine name + current step
   - Both: a "currently running" banner at the top of the chat
4. **Push wake** — desktop tells the push relay "ping device X",
   phone receives APNs/FCM, opens to the relevant turn.
5. **Send a prompt** — user types into the phone chat, message
   appears on desktop, agent runs there, reply streams back to
   both surfaces.

**NOT in mobile MVP (explicit deferrals):**
- Settings panels — settings live on desktop only. Phone has a
  single "Paired with: <hostname>" + "Disconnect" screen, nothing
  more. The user configures Dex on the desktop where they sit to
  do real work.
- Spotlight overlay / global hotkey — no equivalent on phones.
  Top-bar mono input is always-on instead.
- LiveEntry full list (v1.2's right-column rebuild) — phone
  collapses it into a swipe-up bottom sheet.
- Local LLM / offline mode — phone always relies on the desktop's
  brain. If desktop is offline, phone shows "Dex desktop is
  asleep" + a "wake" button that triggers a Wake-on-LAN packet
  to the desktop's MAC (post-MVP).
- Multi-account / multi-desktop pairing — one phone pairs with
  one desktop in MVP. Multi-desktop is a v1.6 ask.

**Watch / wearable companions** — out of scope for v1.5 mobile
MVP; the project structure supports them (separate Wear / watchOS
target in each platform's repo layout) but no UI work happens
until the phone clients ship.

## D.2.6 — Open decisions (parked for the next session block)

These need a yes/no when the mobile chunk starts, not now:

1. **Push relay deployment** — self-host (smallest, free) vs
   Cloudflare Workers (cheap, reliable) vs Firebase (free for
   FCM, paid for APNs proxy). Default: self-host on the same VPS
   as the docs site; revisit if scale demands it.
2. **Repo layout** — keep `apps/mobile/android/` and
   `apps/mobile/ios/` inside the monorepo (this plan's default)
   vs split into `Dex-Android` + `Dex-iOS` repos. Default:
   monorepo, matches the rest. Split only if mobile teams are
   completely separate humans (not the case for solo Chethan).
3. **Min Android API** — locked at 31 (S, 2021) for Material You
   dynamic colors. If user data later shows significant pre-S
   audience, drop to 26 and skip dynamic colors on those.
4. **iOS minimum** — locked at 18 for Liquid Glass. iOS 17 users
   are locked out. Confirmed acceptable per earlier session.
5. **Distribution beyond Play / App Store** — Android: sideload
   `.apk` published on GitHub releases (yes). iOS: TestFlight
   only until App Store review can be navigated (yes, MVP
   doesn't require App Store listing).

## D.2 expanded — Files this block touches (when execution starts)

```
NEW (Android)
  apps/mobile/android/build.gradle.kts
  apps/mobile/android/settings.gradle.kts
  apps/mobile/android/gradle/libs.versions.toml
  apps/mobile/android/app/build.gradle.kts
  apps/mobile/android/app/src/main/AndroidManifest.xml
  apps/mobile/android/app/src/main/kotlin/com/chethan/dex/MainActivity.kt
  apps/mobile/android/app/src/main/kotlin/com/chethan/dex/theme/DexColors.kt
  apps/mobile/android/app/src/main/kotlin/com/chethan/dex/theme/DexMotion.kt
  apps/mobile/android/app/src/main/kotlin/com/chethan/dex/net/GatewayClient.kt
  apps/mobile/android/app/src/main/kotlin/com/chethan/dex/ui/chat/ChatScreen.kt
  apps/mobile/android/app/src/main/kotlin/com/chethan/dex/ui/pairing/PairScreen.kt
  apps/mobile/android/app/src/main/kotlin/com/chethan/dex/service/GatewayForegroundService.kt
  apps/mobile/android/app/src/main/kotlin/com/chethan/dex/widget/StatusWidget.kt
  apps/mobile/android/shared/protocol/                  (generated, gitignored except banner stub)

NEW (iOS)
  apps/mobile/ios/project.yml                           (XcodeGen)
  apps/mobile/ios/Dex/DexApp.swift
  apps/mobile/ios/Dex/Theme/DexColors.swift
  apps/mobile/ios/Dex/Theme/DexMotion.swift
  apps/mobile/ios/Dex/Net/GatewayClient.swift
  apps/mobile/ios/Dex/UI/Chat/ChatScreen.swift
  apps/mobile/ios/Dex/UI/Pairing/PairScreen.swift
  apps/mobile/ios/Dex/LiveActivity/DexLiveActivity.swift
  apps/mobile/ios/Dex/Widgets/StatusWidget.swift
  apps/mobile/ios/Shared/Protocol/                      (generated, gitignored except banner stub)

NEW (shared)
  apps/mobile/_strings/en.json                          (copy SoT)
  scripts/codegen-mobile-protocol.ps1                   (Windows dev)
  scripts/codegen-mobile-protocol.sh                    (CI runners)
  scripts/check-design-parity.ps1                       (token diff lint)
  .github/workflows/mobile-android.yml
  .github/workflows/mobile-ios.yml

EDIT
  D:\project1\README.md                                 (platform matrix shows native mobile)
  D:\project1\LICENSES.md                               (add Kotlin / AndroidX / Swift / SwiftUI rows)
  D:\project1\SECURITY.md                               (keystore + ASC key handling)
  app/lib/theme/tokens.dart                             (becomes the SoT all three mirror)
```

## D.2 expanded — Progress log (for the mobile chunk)

- [ ] D.2.1 — Native-feature ledger committed to README + plan
- [ ] D.2.2 — `scripts/codegen-mobile-protocol.*` emits Kotlin + Swift; CI fails on drift
- [ ] D.2.3 — Three token files (`DexColors.dart`, `.kt`, `.swift`) carry identical hex; parity lint green
- [ ] D.2.4 — Android `./gradlew assembleRelease` green on Linux runner
- [ ] D.2.4 — iOS `xcodebuild archive` green on macOS runner
- [ ] D.2.4 — Codegen drift detection blocks PRs
- [ ] D.2.5 — Android: pairing + chat + foreground notif + push wake working on a real device
- [ ] D.2.5 — iOS: pairing + chat + Live Activity + Dynamic Island + push wake working on a real device
- [ ] D.2.5 — Send-from-phone smoke: prompt typed on phone runs on desktop, reply streams to both
- [ ] D.2.6 — Open decisions resolved in the session that starts this chunk

---

# Next session — start here

When you open Claude Code next, the canonical order is:

1. **Phase E** (VisionService) — starts with `E.0: vision.ts interface +
   types`. Small contained commit; ~80 lines of TS + 1 test file.
2. **v1.2** (desktop Live action surface rebuild + Stop button +
   Windows tray + Ctrl+K Spotlight) — bigger chunk; ~10 days of work.
3. **D.2 expanded** (native mobile MVP) — the ~6-8 week chunk. Start
   with `scripts/codegen-mobile-protocol.*` so the protocol layer
   exists before either native target is scaffolded.
4. **v1.5** (installer + production polish) — last.

`PLAN.md` at the repo root mirrors the checkboxes from this file.
Read this slash-plan first, find the lowest unchecked item, continue
from there.

---

# Phase I — Make Dex actually work + absorb agent-zero (2026-06-11)

> **This phase supersedes "Next session — start here" above. It is the
> new top item.** Everything in I.1 is a P0 fix for tonight's failures;
> I.2-I.5 are the feature absorption Chethan asked for ("DO WHATEVER IT
> TAKES TO MAKE THIS THE SUPERIOR AGENTIC FRAMEWORK").

## Context

Tonight's sessions proved the watchdog fix worked (`blocked_tool_call`
classification, no more mid-call aborts) but EVERY `run_desktop_task`
still ground to its full timeout — even "open notepad". The UFO² task
log (`vendor/UFO/logs/dex/dex-20260611T141619Z-14a1b0.log`) contains
the smoking gun:

```
RateLimitError: 429 — Quota exceeded:
generativelanguage.googleapis.com/generate_content_free_tier_requests
limit: 20, model: gemini-3.5-flash
quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier
```

`vendor/UFO/config/ufo/agents.yaml` points all four UFO² agents at
`gemini-flash-latest`, which Google resolves to **gemini-3.5-flash —
free tier = 20 requests/DAY**. Exhausted. The OpenAI SDK retries 429s
with backoff (max_retries=3, ~48s waits), the startup probe itself
burns a request, so every UFO² run sits silent until the 300-600s cap.
Not a code bug — a model-quota landmine. (Cold-start slowness on top:
Defender venv scans; warmup shipped 2026-06-11, Defender exclusion
recommended to Chethan.)

Second structural find (tool-catalog exploration): Dex desktop
sessions run tool profile **"coding"**
(`dex/core/src/agents/tool-catalog.ts:356-369`), which DENIES:
- `message` — the channel send tool (WhatsApp/Telegram/Discord/Slack
  text+file send via paired channels,
  `dex/core/src/agents/tools/message-tool.ts`). With WhatsApp paired,
  "send my wallpaper to myself" should be ONE tool call — but the tool
  is stripped from the session.
- `browser` — OpenClaw's OWN built-in browser tool
  (`dex/core/extensions/browser/`), which supports driving the USER'S
  logged-in browser (`profile: "user"`, any Chromium v144+ — Vivaldi,
  Brave, Edge) via CDP. Exactly the "use the user's default browser"
  ask — already built, just blocked by the profile.

So GUI automation was the only door left open, against a dead-quota
model. Phase I fixes the doors first, then absorbs agent-zero's
strengths (step-label UI, modes, speed), re-scopes Connectors & Apps
to REAL app integrations (ClawHub skills — search/install RPCs already
exist in `dex/core/src/gateway/server-methods/skills.ts`), and adds
composer prompt history (up-arrow).

agent-zero research summary (MIT, confirmed): its speed comes from
(a) early tool-call dispatch on the first closed JSON object,
(b) compact <3K-token prompts with dynamic tool loading, (c) step
events streamed as typed log items with 3-letter codes
(GEN/EXE/USE/WWW/SUB/END) rendered as collapsed one-line steps that
expand on click, auto-collapsing 2-4s after completion. Its browser is
Playwright with a "bring your own browser" mode; its modes are
read / read-write plus per-feature toggles. We port the concepts onto
Dex's existing event stream — NOT the Python.

## I.1 — P0 unblock (land first, in this order)

### I.1.a Switch UFO² off the dead-quota model
- `vendor/UFO/config/ufo/agents.yaml` lines 42/70/98/122:
  `API_MODEL: "gemini-flash-latest"` → `"gemini-2.5-flash-lite"`
  (same key, separate and far higher free quota; the brain already
  runs this model). Mirror in `agents.yaml.template`.
- Note: brain + UFO² + browser-use then share one flash-lite RPM pool.
  If RPM collisions appear, flip UFO²/browser-use to a Groq key
  (one-line flips: agents.yaml + DEX_BROWSER_PROVIDER) — documented,
  not done now.

### I.1.b Fail fast on quota exhaustion (no more silent 300s burns)
- `dex/drivers/windows-desktop-control/server.py`: watch the UFO²
  subprocess stderr incrementally during the wait loop. On
  `RateLimitError` / `RESOURCE_EXHAUSTED` / `Error code: 429` match:
  kill the subprocess, return `{ok:false, summary:"LLM quota exhausted
  for <model> — switch the desktop-automation model or wait for quota
  reset (<retry hint from the error>)"}`. ≤30s to a clear answer.
- Same detection in `dex/drivers/browser-control/server.py` (browser-
  use surfaces 429s in its run history/logs).

### I.1.c Unblock `message` + `browser` tools for Dex sessions
- `dex/core/src/agents/tool-catalog.ts`: add `"message"` and
  `"browser"` to the **coding** profile allow list (we own the fork;
  Dex's product default is "the desktop agent can message paired
  channels and drive the browser"). `gateway`/`nodes`/`agents_list`/
  `tts` stay denied.
- Routing hints: `dex/core/src/orchestration/preflight.ts` hint gains
  one line — "Sending a message/file via WhatsApp/Telegram/Discord/
  Slack when that channel is paired → use the `message` tool (one
  call); GUI automation of messenger apps is the LAST resort." Same
  cross-reference added to
  `dex/drivers/windows-desktop-control/SKILL.md`.

### I.1.d Default-browser support (Vivaldi/Brave/Edge, not bundled Chromium)
- **Built-in browser tool** (now allowed by I.1.c): supports
  `profile: "user"` already — surface a Connectors entry + document the
  config; smoke "open whatsapp web in my browser".
- **browser-use driver**: `dex/drivers/browser-control/server.py:258`
  constructs `BrowserSession(headless=headless)`. Add:
  - Windows default-browser detection: registry
    `HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice`
    ProgId → executable path map (VivaldiHTM, BraveHTML, ChromeHTML,
    MSEdgeHTM, ...);
  - pass `executable_path=` to `BrowserSession` when resolved
    (supported natively — `browser_use/browser/profile.py:417`);
  - env overrides `DEX_BROWSER_EXECUTABLE` / `DEX_BROWSER_CHANNEL`
    beat detection; fall back to bundled Chromium when detection
    fails (e.g. Firefox default — not Chromium-compatible).

### I.1.e Acceptance for I.1
- "open notepad and write a prime-check program" → completes < 60s.
- "send my current wallpaper to myself on WhatsApp" with WhatsApp
  paired → `message` tool path, < 30s, no UFO².
- Same prompt, WhatsApp NOT paired → UFO² path completes; file lands.
- Quota-exhausted simulation (point agents.yaml at the dead model):
  tool returns a clear quota error < 30s; the chat shows it.
- A browser task opens the USER'S default browser (Vivaldi), not
  Playwright Chromium.

## I.2 — Composer prompt history (up-arrow)

`app/lib/widgets/composer/dex_composer.dart` `_Input` already has a
`KeyboardListener` (~line 265, Enter handling). Add:
- `_historyIndex` in `_DexComposerState` (-1 = live input). Arrow-up
  with caret at start (or empty field) recalls the previous
  `MessageSpeaker.human` text from `ConversationStore.messages`;
  arrow-down walks forward; submit/edit resets to -1. Caret placed at
  end after recall.
- Same behavior in `spotlight_window.dart`'s input (local ring buffer
  there, since the spotlight has no store).

## I.3 — agent-zero absorption (step UI + modes + speed)

Clone `https://github.com/agent0ai/agent-zero` → `vendor/agent-zero`
(MIT; pin commit; LICENSES.md row). Reference for UI/UX + prompt
shapes during this phase; concepts ported, not Python.

### I.3.a Step-label stream (the "GEN/EXE" feel)
Map events Dex ALREADY emits to typed steps — zero extra LLM calls:
- New `app/lib/widgets/chat/step_row.dart`: one collapsed line =
  `[CODE] short heading · status/duration`, expand-on-click to the
  full ActivityCard detail (args, output, log path). Codes:
  `GEN` model streaming · `USE` tool call announced · `EXE` exec/shell
  · `WWW` browser tools · `WIN` run_desktop_task · `END` final reply.
- Headings derive from tool args (goal/command head), not narration.
- `ConversationStore` maps toolCall/toolResult/delta events to step
  entries (the ToolActivity list already tracks most of this); chat
  renders step rows inline; completed steps auto-collapse after ~3s
  (respect disableAnimations).

### I.3.b Modes (read / work / computer-use)
- Composer mode pill gains real modes mapped to tool profiles:
  - **Chat (read)** → read-only tools (no write/exec/GUI engines)
  - **Work (read-write)** → coding profile (with I.1.c additions)
  - **Computer use ON/OFF** → gates windows-desktop-control /
    browser-control / omniparser MCP tools per session (session
    tools.allow/deny via config or chat.send option — verify the
    gateway's per-session tool override surface during execution).
- Settings → Preferences mirrors the toggles, persisted.

### I.3.c Speed
- Implement v1.3.B auto-fast: when preflight routes `shell` with
  score > 0.9 and non-compound kind, send the turn with thinking off /
  fast model (gateway-side, no persistent config change).
- Audit Dex desktop-session system prompt size; trim toward the
  agent-zero <3K-token envelope for fast mode.

## I.4 — Connectors & Apps re-scope (REAL app integrations)

What Chethan meant: app-level skills/MCPs that make GUI automation
unnecessary (WhatsApp send, Gmail, Discord, Slack, Blender...). The
machinery already exists in dex-core:
- **60+ bundled skills** under `dex/core/skills/` (discord, github,
  slack, notion, himalaya (email), apple-notes, 1password, ...)
- **ClawHub remote registry** with gateway RPCs `skills.status`,
  `skills.search`, `skills.detail`, `skills.install`, `skills.update`
  (`dex/core/src/gateway/server-methods/skills.ts`; client
  `dex/core/src/skills/lifecycle/clawhub.ts`)
- Catalogs to draw names from: docs.openclaw.ai/tools/skills +
  github.com/VoltAgent/awesome-openclaw-skills

Rework the tab (`app/lib/core/connectors.dart` +
`widgets/settings/tabs/connectors_tab.dart`, reusing
`GatewayClient.request()`):
1. **Installed**: live from `skills.status` (bundled + workspace
   skills, enable state) + the engines (UFO², browser-use, OmniParser)
   + built-in tools (now incl. `browser`, `message`).
2. **Browse & install**: the search field also queries `skills.search`
   (ClawHub); results show Install → `skills.install`; detail via
   `skills.detail`.
3. Channels become one "Paired messengers" group whose detail explains
   the `message` tool the agent now has.
4. **Recommended** rows for the named asks: WhatsApp (pair channel →
   message tool), Email/Gmail (himalaya skill), Discord/Slack/GitHub/
   Notion (bundled skills), Blender (ClawHub skill if published, else
   "add custom MCP server" affordance).

## I.5 — Packaging toward "the superior agentic framework"

Defer heavy bundling (v1.5 installer owns it), but land now:
- `dexagent` npm README repositioned: brain + engine drivers + skills
  + connectors; document driver setup.
- Ship `dex/drivers/` + an install script in the npm tarball `files`
  list so a fresh `npm i -g dexagent` can register engines without the
  repo checkout (paths resolved via a `DEX_DRIVERS_DIR`).

## Phase I — Critical files

```
vendor/UFO/config/ufo/agents.yaml (+ .template)          I.1.a
dex/drivers/windows-desktop-control/server.py             I.1.b
dex/drivers/browser-control/server.py                     I.1.b + I.1.d
dex/core/src/agents/tool-catalog.ts                       I.1.c
dex/core/src/orchestration/preflight.ts                   I.1.c routing line
dex/drivers/windows-desktop-control/SKILL.md              I.1.c routing
app/lib/widgets/composer/dex_composer.dart                I.2 + I.3.b
app/lib/spotlight_window.dart                             I.2
vendor/agent-zero/                                        I.3 (new clone, pinned)
app/lib/widgets/chat/step_row.dart (new)                  I.3.a
app/lib/core/state/conversation_store.dart                I.3.a step mapping
app/lib/core/connectors.dart                              I.4
app/lib/widgets/settings/tabs/connectors_tab.dart         I.4
app/lib/core/gateway_client.dart                          I.4 (skills.* via request())
LICENSES.md                                               I.3 agent-zero row
```

## Phase I — Verification

```powershell
# P0 smokes (after gateway restart):
#  "open notepad and write a python prime checker"   -> done < 60s
#  "send my wallpaper to myself on whatsapp"         -> message tool (paired) OR UFO² completes
#  "take the typing test at livechat.com"            -> opens VIVALDI (default browser)
# Quota sim: agents.yaml -> dead model -> tool fails < 30s with quota message in chat
# Up-arrow in composer recalls last prompt; down-arrow walks back
# Chat shows collapsed step rows (USE/EXE/WIN/WWW) expanding on click
# Connectors & Apps: search "github" -> ClawHub results -> Install -> shows Installed
cd dex/core; pnpm test src/agents src/orchestration   # profiles + routing green
cd app; flutter analyze; flutter build windows --debug
```

## Phase I — Progress log

- [x] I.1.a agents.yaml → gemini-2.5-flash-lite (4 agents + template) — 2026-06-11
- [x] I.1.b fail-fast 429 detection in both MCP drivers (desktop: live
      stderr scan in a Popen poll loop kills the run in ≤~2s of the 429
      landing; browser: exception-text classification) — 2026-06-11
- [x] I.1.c coding profile gains message + browser (tool-catalog.ts +
      test); preflight hint + SKILL.md teach channel-send-over-GUI —
      2026-06-11
- [x] I.1.d default-browser detection (registry UserChoice ProgId →
      executable) wired into browser-control; DEX_BROWSER_EXECUTABLE /
      DEX_BROWSER_CHANNEL overrides; verified live (found Vivaldi) —
      2026-06-11
- [ ] I.1.e all five P0 acceptance smokes pass (needs gateway restart +
      Chethan driving)
- [x] I.2  composer + spotlight up/down-arrow prompt history
      (PromptHistory ring buffer; caret-aware so multi-line arrowing
      still works) — 2026-06-11
- [x] I.3.a step-label rows in chat: StepRow (WIN/WWW/EXE/EYE/MSG/DOC/
      USE badges) replaces ToolChip in the conversation; expands on
      click into the correlated ToolActivity detail — 2026-06-11
- [x] I.3.b PARTIAL: composer modes wired to REAL chat.send params
      (Fast → fastMode+thinking off; Think deeper → thinking high —
      ChatSendParamsSchema supports both natively). The read-only /
      computer-use-off tool-profile gating still needs a per-session
      tool-override surface in the gateway — follow-up.
- [ ] I.3.c auto-fast for high-confidence simple turns (gateway-side;
      client-side Fast mode shipped instead — revisit)
- [x] I.4  Connectors & Apps wired: skills.status (Installed skills
      section), skills.search on Enter (registry results), one-click
      skills.install; channels category renamed Paired messengers —
      2026-06-11
- [x] I.5  PARTIAL: npm README repositioned as the agentic framework;
      tarball-embedding the drivers deferred to v1.5 (files must live
      under the package root — needs a prepack copy step).
- [x] vendor/agent-zero cloned (inner .git stripped), pinned
      f9d8167a, LICENSES.md row added — 2026-06-11

## Locked delivery order (2026-06-12, Chethan)

**Framework + functionality first → Dex Voice → Dex Vision LAST.**
Dex Vision only starts after everything else in this plan is complete.
UI reference for Vision when its turn comes: the Copilot Vision
screenshots in `D:\project1\copilot-ref\` (image0/image1 — floating
"Screen 1 · Stop" pill with X/chat/glasses/mic/settings controls, and
the screen-share chat layout). copilot-ref/ is gitignored on purpose —
reference only, never push.

Packaging: after Phase J (GUI onboarding) lands, everything compiles
into the Flutter app + the WiX installer (v1.5 Phase 18) so users
install one .msi instead of cloning GitHub and building.

---

# Phase J — GUI onboarding + Secrets + functional connects (branch: onboard)

> Chethan's 2026-06-12 ask: everything `dex onboard` does, inside the
> app — keys, model selection, channel pairing with in-app QR — premium
> Apple-inspired, zero command prompt. Supersedes/concretizes v1.4
> Phase 15-16 and D.3 for the surfaces it covers.

## J.1 — Where every key actually lives (write targets)

| Consumer | What | Write path |
|---|---|---|
| Brain (dexagent) | Gemini API key | auth profile store (`~/.dex/agents/<id>/agent/auth-profiles.json`) — verify exact shape from `dex onboard` source before writing; prefer a gateway RPC if one exists |
| Brain | primary model + fallbacks | `agents.defaults.model.primary` + `.fallbacks` in `~/.dex/dex.json` via gateway `config.patch` (preferred) or direct file write |
| UFO² | API key + model (×4 agents) | `vendor/UFO/config/ufo/agents.yaml` — direct file write from Flutter (templated replace of API_KEY / API_MODEL) |
| browser-use | GEMINI_API_KEY + DEX_BROWSER_MODEL/PROVIDER | `mcp.servers.browser-control.env` in `~/.dex/dex.json` via `config.patch` |
| web_search tool | Gemini key (observed `missing_gemini_api_key`) | tools/web config or env — locate during build |
| OmniParser | none yet (model download later) | n/a — show as "coming with vision phase" |

## J.2 — Onboarding screen (first-run)

Route to `OnboardingScreen` instead of HomeDesktop when no gateway
config/auth exists (GatewayConfig.fromLocalConfig already detects
missing config). Steps, each a glossy card with the living background:

1. **Welcome** — what Dex is; "Allow Dex to connect to the web" framing.
2. **Brain** — Gemini API key field (masked, paste-friendly) with
   "Get a free key → aistudio.google.com/app/apikey" link
   (url_launcher); model dropdown (GlossyDropdown) of Gemini models;
   writes brain auth + model.
3. **Hands** — same key reused by default for UFO² + browser-use
   (single-key UX), optional separate Groq key field; writes
   agents.yaml + mcp env.
4. **Apps** — channel pairing offers: WhatsApp (in-app QR), Telegram
   (bot-token field), others as "later in Settings".
5. **Done** — summary + Start.

## J.3 — Settings → Account → Secrets

- Masked key fields with reveal/copy, per-consumer status (set/unset),
  one "Apply" that fans out to all write targets from J.1.
- Model picker: GlossyDropdown bound to `agents.defaults.model.primary`
  (+ fallbacks list), applied via config.patch; restart-hint banner
  when the gateway needs a bounce.

## J.4 — Functional Connect buttons

- WhatsApp: in-app pairing — invoke the channel login surface and
  render the QR inside the dialog (find the gateway/CLI seam the
  control-ui or `dex channels login` uses; worst case spawn
  `dex channels login --channel whatsapp` and parse the QR payload to
  render with qr_flutter). Status auto-refreshes on link.
- Telegram/Discord/Slack: guided token form → writes channel config
  (channels.add equivalent via config) → restart hint.
- All other connectors keep the copyable command as fallback.

## J.4b — Identity flow (added 2026-06-12)

Login / Create-account screen (UI-only, local prefs via DexAccount —
no backend yet; the flow exists so future auth slots in cleanly).
Launch routing: signed-out → Login → (engine/key missing → Onboarding)
→ cockpit. Profile menu Sign out clears the flag and returns to Login.
Account tab shows the stored name/email. Shared SecretField (focus
ring + proper hover reveal-toggle) used by login password, onboarding
key, and Settings Secrets.

## J.5 — Acceptance

- Fresh `~/.dex` → app shows onboarding → paste one Gemini key →
  pick model → pair WhatsApp via in-app QR → land in chat → "open
  notepad and write hello" works → "send hi to myself on whatsapp"
  works. Zero terminal usage.
- Settings → Secrets shows the key (masked) + model; changing model
  takes effect next turn (or after restart with banner).

---

# Phase K — Built-in engines: dexagent ships its own hands (2026-06-12)

> Chethan's direction: "integrate dexagent with built-in UFO and
> Browser-use — it will be the novelty of the project, not some
> openclaw clone or fork." Correct call. Today the engines are
> externally-registered MCP glue (install-skills.ps1 + user config);
> any OpenClaw user could do that. Phase K makes the engines part of
> the FRAMEWORK: `npm i -g dexagent` / the MSI = a complete agentic
> stack with desktop + browser hands, zero registration.

## K.1 — Architecture

The merge seam already exists: `loadMergedBundleMcpConfig`
(dex/core/src/agents/bundle-mcp-config.ts) combines plugin bundle
servers + user `mcp.servers`. Built-in engines become the THIRD,
lowest-precedence layer:

    builtin engines  <  plugin bundle servers  <  user mcp.servers

- New `dex/core/src/engines/builtin-engines.ts`:
  `resolveBuiltinEngineServers(cfg)` returns
  `{ "windows-desktop-control": {...}, "browser-control": {...} }`
  ONLY when each engine's pieces resolve on this machine:
    - drivers dir: env DEX_DRIVERS_DIR → `<pkgRoot>/drivers` (npm
      carry, publish-time copy) → `<pkgRoot>/../drivers` (dev repo AND
      the MSI bundle layout — runtime/dexagent + runtime/drivers)
    - venv python: env DEX_UFO_PYTHON / DEX_BROWSER_PYTHON →
      `<driversBase>/../vendor/<x>/.venv` (bundle) →
      `<driversBase>/../../vendor/<x>/.venv` (dev)
  Product defaults BAKED IN: requestTimeoutMs 330s/210s, browser env
  (provider google, flash-lite model), and GEMINI_API_KEY injected
  from `cfg.models.providers.google.apiKey` — the one key the Flutter
  Secrets panel already writes. No user MCP config needed at all.
- Disable switch: a user `mcp.servers.<name>.enabled=false` entry
  already suppresses same-name servers in the merge — no new config
  surface.
- install-skills.ps1 demoted to dev-utility; the framework self-
  registers.

## K.2 — Bundling + launch model (revised 2026-06-12, Chethan: "no auto-spawn")

The MSI bundles app + node + dexagent + drivers + vendor venvs
(installer/Dex.wxs + scripts/build-installer.ps1, already scaffolded).

**Launch model — managed gateway, NOT app auto-spawn.** Chethan was
explicit: he does not want the Flutter app to spawn a gateway child
process as the product mechanism. Instead the installer registers
dexagent's gateway as a managed background service that starts at
login (`dex gateway install` — dexagent already ships this; managed
installs use `dex gateway restart/status --deep`). Once running, that
gateway ALREADY has UFO² + browser-use built in via Phase K.1, so the
bundle is: MSI → managed gateway service (with built-in engines) →
the app simply connects over ws://127.0.0.1:18789. No terminal, no
app-spawned child, no separate registration step.

`app/lib/core/gateway_process.dart` (GatewayManager.ensureRunning) is
DEMOTED to a dev-only fallback: when running from a source checkout
with no managed service present, it can still launch a gateway so the
app is usable during development. It is NOT the shipped product path.
The installer's service registration is. (Open: decide whether to
keep the dev fallback or delete it once the service path is wired —
default keep, it's harmless and dev-only.)

## K.3 — npm carry (publish-time)

`npm pack` must include `drivers/` under the package root: add a
prepack copy (dex/drivers → dex/core/drivers) + `files` entry when
publishing the next dexagent version. Until then, dev + MSI layouts
resolve via `../drivers`.

## K.4 — Acceptance

- Delete `mcp.servers` from dex.json entirely → restart gateway →
  agent still has windows-desktop-control + browser-control tools
  (gateway log: `[engines] desktop (UFO²): ready`, `browser: ready`).
- Onboarding on a fresh MSI: paste key → engines just work — no
  registration step anywhere.
- A user mcp.servers entry with the same name overrides the builtin.

## Phase K — Progress log

- [x] K.1 builtin-engines.ts + merge layer (lowest-precedence) +
      gateway-start log line; 6 tests green; resolves on dev machine.
      Commit c5b739dd on onboard. — 2026-06-12
- [x] K.2 launch model REVISED to managed gateway service (no app
      auto-spawn per Chethan); gateway_process.dart demoted to
      dev-only fallback (probe-then-spawn = no-op when the service is
      up). MSI payload layout matches builtin resolution paths
      (runtime/dexagent beside runtime/drivers + runtime/vendor).
      Installer service-registration step still TODO (Task #112).
- [x] K.3 prepack drivers copy + `files` entry DONE (commit 3fdbe823):
      openclaw-prepack.ts copies dex/drivers -> dex/core/drivers,
      package.json files carries drivers/; npm pack verified to include
      all 15 driver files. venv resolves from ~/.dex/engines/<x>/.venv.
- [ ] K.4 acceptance: delete mcp.servers from dex.json -> restart
      gateway -> engines still present (needs Chethan to restart +
      drive; logic + paths verified)

## Post-K improvements (2026-06-13, all on onboard branch)

Chethan: "anymore ways to improvise dex?" → picked all four.

- [x] #1 `dex engines setup` + `dex engines status` (commit cfbde3e0):
      one-command venvs into ~/.dex/engines (browser-use fully; UFO²
      clone), status readout. DEX_UFO_ROOT plumbed through server.py +
      builtin-engines so UFO works from the npm location. `status`
      verified live (both ready); long installs run on user's machine.
- [x] #2 Engine health readout in app (commit a15bb416):
      Settings → Diagnostics leads with an Engines card (ready/amber +
      reason + refresh), via DexSetup.engineStatus() reading dex.json
      mcp.servers + on-disk python/driver checks.
- [x] #3 Installer auto-starts gateway (commit bdc33b03): Startup-folder
      shortcut → start-gateway.vbs (windowless `gateway run`). Chose the
      shortcut over a `dex daemon install` WiX CustomAction (no
      Util-extension/deferred-CA risk to the MSI build). Not
      MSI-build-verified (needs WiX toolset).
- [x] #4 Quota resilience UX: quota-aware error message in the chat
      (points to the Groq option) + DexSetup.applyGroqKey() moving the
      hands (UFO² + browser-use) onto a free Groq key, isolating their
      quota from the brain's Gemini; Gemini/Groq made symmetric so
      re-applying the Gemini key cleanly reverts. Groq field +
      get-key link in Settings → Account → Secrets.

All need a gateway restart to take effect; acceptance smokes are
Chethan-driven.

## Repo = dexagent + Flutter app only (2026-06-13/14)

Chethan: "the repo should contain only dexagent and flutter app …
integrate everything in dex/core … different and better than OpenClaw,
not a simple fork."

- [x] vendor/ removed from the repo (commit b13bbfab): agent-zero
      deleted (reference, concepts already ported); UFO²/browser-use
      gitlinks untracked. Nothing in dex/core depends on vendored
      source. /vendor/ gitignored. Engines come from `dex engines
      setup` (~/.dex/engines) or the MSI; build-installer sources venvs
      from ~/.dex/engines.
- [x] dex/drivers → dex/core/drivers (`git mv`): the MCP drivers now
      live INSIDE the npm package, so a published `dexagent` carries
      them directly (no prepack copy hack — removed). builtin-engines
      resolveDriversBase finds `<pkgRoot>/drivers` for dev + npm + MSI;
      resolveVenvPython now walks 1-3 levels up (drivers are one level
      deeper) + ~/.dex/engines. server.py REPO_ROOT parents[3]→[4];
      DEX_UFO_ROOT still authoritative. Updated: prepack, package.json
      files, install-skills.ps1, run-dev.ps1, verify-phase.ps1,
      build-installer.ps1 (drivers ship inside dexagent →
      runtime/dexagent/drivers; dropped the separate copy), Dex.wxs
      comment, DexSetup.registerBundledEngines + agentsYamlFile (3-hop),
      orchestration doc comments. 7 engine/merge tests green.
- [x] In-app "Restart gateway" (Diagnostics): GatewayManager.restart()
      kills the port listener (netstat→taskkill) + respawns + reconnects
      — dev iteration and recovery need no terminal.
- [x] version bump 2026.6.21 → 2026.6.22 for npm publish.

Dev note after the move: the running gateway's dex.json mcp.servers
still point at the OLD dex\drivers paths. Re-run scripts\install-skills
.ps1 (now points at dex\core\drivers) OR delete the two engine entries
from mcp.servers and let built-in resolution take over (it finds
dex\core\drivers + the repo-root vendor venv via the 3rd hop).

## vendor/ deleted from disk — engines migrated to ~/.dex/engines (2026-06-14)

Executed the "build replacement then delete" migration:
- browser-use: `dex engines setup` built a fresh venv at
  ~/.dex/engines/browser-use (pip + Playwright Chromium) — works.
- UFO²: the fresh `dex engines setup` pip build FAILED (UFO pins an old
  pandas that builds from source; its setup.py imports pkg_resources,
  which setuptools 81+ removed). Instead of fighting the rebuild, MOVED
  the working vendor/UFO → ~/.dex/engines/UFO (robocopy /MOVE), keeping
  its installed deps + the Dex-configured agents.yaml (Gemini key, model,
  endpoint). Smoke-verified: pandas/numpy/ufo import + `python -m ufo
  --help` runs from the moved venv.
- Hardened engines-cli setupUfo for future installs: pin setuptools<81 +
  wheel + cython + numpy, then `pip install -r requirements
  --no-build-isolation` (uses the venv's pkg_resources). Best-effort,
  not fully verified against UFO's whole dep tree.
- Removed the two stale engine entries from ~/.dex/dex.json mcp.servers
  (backup: dex.json.bak-premigrate) so built-in resolution takes over.
- Deleted vendor/ from disk entirely. `dex engines status` → both
  engines ready (resolved at ~/.dex/engines).
- agentsYamlFile() resolves DEX_UFO_ROOT → vendor fallback → the
  ~/.dex/engines/UFO home, so Secrets key writes still hit the right
  agents.yaml.

Needs a gateway restart (Diagnostics → Restart gateway) for the running
gateway to pick up built-in resolution instead of the removed
mcp.servers entries.

---

## Evaluated and SCRAPPED: trycua/cua (2026-06-12)

Chethan asked about https://github.com/trycua/cua. Decision: **not
integrating.** cua is a VM/container computer-use sandbox — agents
drive macOS/Linux VMs (Lume on Apple Silicon) or cloud containers,
NOT the user's real desktop. That's the exact shape we rejected in
agent-zero (its Docker/XFCE desktop): Dex's locked principle is
controlling the REAL desktop, no VM. UFO² (real Windows UIA) + the
built-in browser tool (user's own browser) + OmniParser (real pixels)
already cover that surface, and cua's Windows story is the weakest of
its platforms. Revisit ONLY if either need appears: (a) sandboxed
execution of risky/destructive tasks, (b) macOS desktop automation
when Dex goes cross-platform (cua's macOS VM tech is its strongest
asset). Until then: scrapped, not vendored.

---

# Open test-suite debt (2026-06-06)

After the 2026.6.9 rebrand sweep that landed in commit `e136e08e`,
the dex/core vitest run sits at **4392 / 4636 passed (~186 failures
across 38 test files)**. The failures are NOT production bugs — they
are long-tail fixture / snapshot mismatches in tests that assert exact
strings now containing "dex" instead of "openclaw".

What's confirmed green:
- Orchestration suite (Phase C + Phase E.0/E.1/E.2): 145 / 145
- Spot-checked command tests (status-overview-rows, status-all/format,
  doctor-security): 49 / 49
- Flutter app: 11 / 11 tests + analyze clean
- browser-control provider resolver: 8 / 8
- pnpm build: green

What's red and why:
- ~186 tests in dex/core/src/{agents, gateway, infra, config, plugins,
  cli, daemon, ...} test files. Each is a string-equality assertion
  against a fixture that still says "openclaw security audit" /
  "openclaw gateway install --force" / "installed by OpenClaw" etc.
- The first sweep targeted backtick + quoted patterns; the second
  pass got `openclaw <subcmd>` unquoted in tests. Some tests use
  exotic patterns (template literals split across lines, fixtures
  loaded from sibling .json files, snapshot files under
  `__snapshots__/`) that neither sweep caught.

Cleanup plan when we get back to it:
- [ ] Audit `test/__snapshots__/**/*.snap` for surviving `openclaw`
      strings; regenerate snapshots with `pnpm test -u`.
- [ ] Run a third sweep that handles template literals:
      `` `... openclaw <subcmd> ...` `` patterns across lines.
- [ ] Update test fixtures in `test/fixtures/**/*.json` and
      `test/fixtures/**/*.txt`.
- [ ] Re-run `pnpm test` and confirm 4636 / 4636.

Until that lands, the user-visible CLI works (Chethan verified
2026.6.9 install + `dex gateway` + `dex doctor` show clean Dex
branding). The test debt is documentation-quality, not user-impact.
Do NOT block shipping E.3 / v1.2 on this — track here and clear in
a focused "test fixture cleanup" commit when there's spare time.

## Internal OpenClaw refs (post-2026.6.13 census, locked plan: option B)

After commits `e136e08e` (CLI command refs), `8e7e224b` (wizard
prose + filename rename), `8467bf22` (agent system prompt + tool
fallback prose), all the user-visible surfaces (CLI banners,
wizard intros/outros, doctor output, agent identity, error
messages, docs URLs, config filename) are clean.

What's still there, by category — counted 2026-06-06:

- **18,462** total OpenClaw lines across **2,693 files**
- **3,507** in prod (non-test) source
- **14,955** in test fixtures (most mirror prod; auto-fix when
  prod regens)

By kind:
- **12,941** lowercase-in-string-literal — paths like
  `types.openclaw.js`, `vendor/openclaw/...`, identifier-shaped
  values inside JSON-like config snippets. Internal only.
- **3,498** uncategorized — mix of comments, dotted-access
  (`config.openclaw.something`), import declarations.
- **1,211** capitalized OpenClaw in strings — bulk in test
  fixtures; the prod ones that surface to users were already
  fixed by the three commits above.
- **519** comment lines — developer-facing only.
- **293** TS function / variable identifiers
  (`buildOpenClawToolFallbackText` and similar). Internal-only;
  renaming them requires touching every import site and offers
  zero behavior change.
- **0** class / type declarations — none left to rename.

**Locked decision (2026-06-06): option B.** Chethan picked B
after the census. We accept the user-visible cleanup as done and
treat the long tail as cosmetic / dev-quality cleanup. NOT
blocking shipping Phase F / E.3 / v1.2. When we get back to it,
the focused cleanup pass goes in this order:

- [ ] Source comments referring to OpenClaw heritage in random
      files (519 lines). Either rebrand to Dex or tag as
      heritage attribution; default: rebrand unless the comment
      is in a file explicitly tagged as upstream-credit.
- [ ] String-literal `OpenClaw` in prod source (the prod subset
      of the 1,211 — probably ~300 lines). Each one belongs to
      a log line, error message, or template-literal prose.
      Rebrand verbatim.
- [ ] Internal function / variable identifiers (293). Rename in
      bulk with a follow-the-symbol refactor (TypeScript
      Language Server can do this). Update import sites
      atomically.
- [ ] Lowercase-in-string-literal occurrences in prod (~2,400
      after subtracting test fixtures). Most are file paths or
      identifier-shaped values; only some surface to logs.
      Audit first, then rebrand only the surfaced ones; the
      rest stay as-is until v1.5's installer rebrand pass.
- [ ] Test fixture cascade (14,955 lines). After all prod
      changes land, `pnpm test -u` regenerates snapshots.

Why option B is the right call: F.1.a (orchestrator wiring)
gives Chethan immediately-visible product behavior change (the
agent stops picking the wrong tool). The long-tail cleanup is
zero behavior change and lives entirely below the user-visible
surface. Ship behavior, defer aesthetics.

## Residual OpenClaw text in `dex onboard` wizard

The 2026.6.10 sweep caught all the **CLI command** strings (`dex
security audit`, `dex gateway install --force`, etc.) but missed the
**prose** in the onboarding wizard. Chethan ran `dex onboard` on
2026-06-06 and saw these surfaces still saying OpenClaw:

```
Windows detected - OpenClaw runs great on WSL2!
Guide: https://docs.openclaw.ai/windows
┌  OpenClaw setup
│
│  OpenClaw is a hobby project and still in beta.
│  By default, OpenClaw is a personal agent...
│  This bot can read files and run actions if tools are enabled.
│  OpenClaw is not a hostile multi-tenant boundary by default.
│  If you're not comfortable with security hardening..., don't run OpenClaw.
│  - https://docs.openclaw.ai/gateway/security
│
│  Running agents on your computer is risky — harden your setup:
│  https://docs.openclaw.ai/security
```

These live in `dex/core/src/wizard/setup.*.ts` + `dex/core/src/cli/
onboard-cli/*.ts` + locale files under `dex/core/src/wizard/i18n/
locales/`. The reason they slipped past Phase B + the 2026.6.10
sweep: my regex patterns targeted backtick/quote-enclosed CLI command
references, but these are plain narrative prose in template strings.

Cleanup plan when we get back to it:
- [ ] Grep `dex/core/src/wizard/` and `dex/core/src/cli/onboard-cli/`
      for `OpenClaw`, `openclaw.ai`, `OpenClaw runs`, `OpenClaw is a`,
      `OpenClaw setup`, etc.
- [ ] Decide per-string: prose-rebrand to "Dex", or keep as heritage
      attribution. Default to rebrand; only keep heritage refs in
      files explicitly tagged as such.
- [ ] Decide the docs URL story: `docs.openclaw.ai` resolves to
      OpenClaw's upstream docs (heritage), not Dex's docs. Either
      stub the URLs to `""` (the same trick C.5 used elsewhere), OR
      replace with a placeholder + TODO once docs.dexagent.app exists.
- [ ] Update the relevant locale files (en.ts, zh-CN.ts, zh-TW.ts).
- [ ] Re-run `dex onboard` + `dex doctor --fix` to verify clean.

User priority signal: Chethan called this out on 2026-06-06 with "ur
not making this any easy for me it still says openclaw that also in
the most important location". Not blocking E.3 / v1.2 -- they asked
for it AFTER the MCP wiring + ASCII fix -- but this is the next
brand-cleanup item to land.

---

# How to publish dexagent to npm

> Memo to future-Chethan so the publish flow isn't relearnt each
> time. Triggered by the 2026.6.8 publish 404 (auth) and the
> follow-up 2026.6.9 build that fixed the gemini.cmd spawn.

## Pre-flight (always)

1. **Make sure auth works.**
   ```powershell
   npm whoami
   # if empty or wrong account:
   npm login
   # verify you own the package:
   npm access list packages | Select-String dexagent
   ```
   The 2026.6.8 PUT 404 was npm's polite "you can't publish here"
   when `whoami` was empty / not the owner.

2. **Bump the version** in `dex/core/package.json`. Convention
   is `YYYY.M.D[-beta.N]`:
   ```powershell
   # in dex/core
   npm version 2026.6.10 --no-git-tag-version
   ```
   Then update `CHANGELOG.md` (if dex-core's release flow expects
   it; check before publishing).

3. **Build first.** Yes -- `pnpm build` ships the `dist/`,
   `dist/control-ui/`, `dist/cli-startup-metadata.json`, and
   the plugin-sdk dts files into the tarball. Skipping build
   leaks stale `dist/` from the prior version OR fails to include
   the runtime-postbuild assets the gateway expects.
   ```powershell
   cd dex/core
   pnpm install
   pnpm build
   ```
   Build is slow (~5-8 min) because tsdown bundles the whole
   gateway + UI vite build runs + cli-startup-metadata writes.
   Wait for it.

## Dry run (always before real publish)

```powershell
cd dex/core
npm pack --dry-run
# look at the file list; verify it includes:
#   - openclaw.mjs (the launcher; bin -> "dex")
#   - dist/**
#   - dist/control-ui/**
#   - README.md, LICENSE, HERITAGE.md

npm publish --dry-run
# validates the manifest and that auth works without uploading
```

If the dry-run is clean, do the real publish.

## Real publish

```powershell
cd dex/core
npm publish --access public
# tag is "latest" by default; for prereleases:
npm publish --access public --tag beta
```

Then verify:
```powershell
npm view dexagent version
# expect the version you just bumped to
```

## Install + smoke

```powershell
# uninstall any stale global first
npm uninstall -g dexagent
npm install -g dexagent@<version>
dex --version          # banner shows the new version
dex gateway --port 18789  # gateway starts on Gemini Flash-Lite
```

## Common failures

- **PUT 404 / E404** -- not authenticated, or not an owner of the
  `dexagent` package. Fix with `npm login` + `npm access list`.
- **Tarball missing dist/** -- forgot to `pnpm build`. Re-run
  build, then `npm pack --dry-run` to confirm dist/ files appear.
- **`dex` not on PATH** after install -- the user installed
  locally (`npm install dexagent`) instead of globally
  (`npm install -g dexagent`). Reinstall with `-g`.
- **Gateway still spawning the old gemini-cli error** -- their
  shell PATH is stale; open a new terminal. Or the gateway
  service installed by an older version is hanging onto its
  cached binary path; `dex gateway install --force` to rebuild
  the service registration.

## Local install (when you can't publish)

If you can't publish (auth failing, npm down, etc.), the user can
install from the local source tree:

```powershell
cd D:\project1\dex\core
pnpm install
pnpm build
npm install -g .
dex --version
```

Same result, no registry hit. Useful for testing a new build
before the npm publish lands.

---

# Phase F — Wire the orchestrator into the gateway agent loop

> Chethan's ask (2026-06-06): "i need a deeper clearer integration
> to the UFO2 and Browser-use and all stuff like dex like a single
> AI Core brain that handles stuff". This phase makes that real.

## F.0 — What's actually built vs. what's wired

**Already built** (under `dex/core/src/orchestration/`):
- `AutomationEngine` interface + `RuntimeContext` + `TaskIntent` types (C.0)
- `scanRuntimeContext` — parallel probes for foreground / UIA / browser / history (C.1)
- `capability-scorer` + `BASE_SCORE_TABLE` + Beta-prior history (C.2)
- `router.ts` + `executeWithFallbacks` + onAttempt / onFallback hooks (C.3)
- `MemoryTelemetryStore` + `self-learning.ts` Beta-prior update (C.4)
- `OmniParserEngine` adapter class (C.5)
- `BrowserUseEngine` + `UfoUiaEngine` adapter classes with optional
  `vision?: VisionService` (E.2)
- `OmniParserVisionService` impl (E.1)
- 145 / 145 tests green; perf bench shows ctx-scan p95 <50 ms,
  score <10 ms, route <5 ms — well under the locked budget.

**NOT yet wired** (the gap Chethan is seeing in practice):
- The gateway's agent loop still uses the upstream OpenClaw model
  router (Claude / Gemini cli-backend) which calls MCP servers
  directly via the agent's tool-use turn. The orchestrator under
  `orchestration/` is a parallel scaffold; the gateway doesn't
  consult it before picking an engine.
- That's why a turn like "open WhatsApp and send a screenshot"
  goes to Claude → no UFO² tool routing → agent says "the tool
  isn't available in this session" (image1.png) OR runs the
  wrong engine (Claude spawning a Python program instead of UFO²
  driving the GUI, image2.png).

## F.1 — Where the wiring happens

`dex/core/src/agents/cli-runner/execute.ts` (where the gateway
hands a user turn to claude-cli / gemini-cli today) needs a
preflight that asks the orchestrator "given this user task, which
engine should drive the next tool call?" — then biases the agent's
tool selection toward that engine.

Three integration points, in order of effort:

### F.1.a — Preflight engine pick (smallest cut)

Before each agent turn, run:
```typescript
const ctx = await scanRuntimeContext({ latencyMs: 30_000 }, probes);
const task = parseTaskIntent(userText);
const routed = route(engines, ctx, task);
```

Take `routed.primary.engine` and inject it as a system-prompt hint
into the agent's next turn: *"For this task the orchestrator
suggests engine `<id>` (score=<n>); prefer the matching MCP
tool."* The agent still has freedom — but the score table biases
it strongly enough that the right tool wins.

Smallest cut because we don't change the agent's tool-call
mechanics; we only nudge its choice. 4-6 commits worth of work.

### F.1.b — Hard routing (medium cut)

The agent loses tool-pick freedom on routed turns. The preflight
picks the engine, the gateway then narrows the agent's available
MCP tools to JUST that engine's tool — claude-cli sees only
`run_desktop_task` for a Win32 task, only `run_browser_task` for
a browser task, etc. On `recoverable` failure the gateway widens
to the fallback chain.

This makes the score table authoritative. Routes faster (no
agent indecision) and lets us measure engine telemetry cleanly.
8-10 commits.

### F.1.c — Native orchestrator turn (largest cut)

The gateway runs the orchestrator natively for routed turns and
only consults the LLM (Claude / Gemini / etc.) for in-engine
step planning. The orchestrator owns the turn boundary; the LLM
owns the per-step decisions within an engine. The brand promise
of "single AI core brain that handles stuff" lands cleanly here
— Dex IS the brain, the LLM is a sub-skill.

Larger because it requires the gateway to take over event
streaming (chip + Action card emission), not the LLM. v2-ish.

## F.2 — Order of execution

Locked direction post-2026-06-06:

1. **F.1.a (preflight engine pick)** — start here. Smallest
   incremental change to the existing claude/gemini-cli loop.
   Doesn't risk regressions on turns the orchestrator doesn't
   want to route.
2. Phase E.3 (canvas detection hook) — was next per the previous
   ordering; still lands here so vision-assist works inside
   browser-use turns the preflight routed to it.
3. Phase E.4 — screenshot cache.
4. F.1.b (hard routing) — only after F.1.a has telemetry showing
   the preflight picks the right engine ≥85% of the time.
5. v1.2 — Live action surface + Stop button.
6. F.1.c — much later; v2 candidate.

## F.3 — Acceptance for F.1.a

- Type "open Notepad and write a C program" → preflight picks
  `ufo-uia`, system-prompt hint mentions it, agent calls
  `run_desktop_task` (not `bash` to spawn `notepad.exe`).
- Type "take this typing test at livechat.com" → preflight picks
  `browser-use`, agent calls `run_browser_task` (not UFO²).
- Type "list my desktop" → preflight picks `shell`, agent uses
  built-in `bash`.
- Type "click Start in <game.exe>" → preflight picks `omniparser`,
  agent's reply gets the hint and either calls `parse_screen` or
  surfaces "vision engine not yet wired" (clean UX, not silent
  fail).
- Telemetry row written per turn so the self-learner can update
  the score table.

## F.4 — Why this isn't done yet

C.7-flutter shipped the UI chip + engine pill (the user can see
which engine was picked). E.0/E.1/E.2 shipped the engine classes
+ vision service. F.1.a is the connecting tissue — explicitly
NOT wired before today because the user hadn't asked for the
unified brain yet. Now they have.

## Phase F — Progress log

- [ ] F.1.a — Preflight engine pick injected into agent turn
- [ ] F.1.a — Telemetry row per turn (engine, score, outcome,
            duration)
- [ ] F.1.a — Self-learner consumes telemetry and refreshes the
            score table
- [ ] E.3 — Canvas detection (post F.1.a, before hard routing)
- [ ] F.1.b — Hard routing: narrow available MCP tools to the
            picked engine
- [ ] F.1.c — Native orchestrator turn (v2)

---

# Phase G — Local file intelligence + cross-device retrieval

> Chethan's ask (2026-06-06): "go retrieve / fetch my aadhar card
> from my laptop" — natural-language file retrieval across the user's
> own connected devices, local-first, privacy-respecting, with smart
> delivery (Dex client / WhatsApp / email / clipboard / share link).
> Plus: scan GitHub for open-source projects FIRST before building
> from scratch.

## G.0 — Why this matters (and why it's not a search engine)

Dex should not behave like a desktop search box that returns paths.
Dex should behave like a personal operating system assistant:

```
User (on phone): "Fetch my Aadhaar card from my laptop"

Dex:
  → discovers connected devices
  → finds "Personal Laptop", "Work Laptop" (both match "laptop")
  → asks: which one? (smart fallback: "search all" -> Dex merges)
  → searches the local index on the chosen device
  → ranks results by semantic similarity
  → confirms the top hit
  → asks: how do you want to receive it?
        1. download in this Dex client
        2. send to another paired Dex device
        3. email to me
        4. WhatsApp to me
        5. clipboard
        6. secure share link
        7. save to Downloads
  → executes the chosen delivery
```

The user never needs to know the path or folder. The file finds them.

## G.1 — Research-first directive (MANDATORY before writing code)

Before any G.* implementation commit lands, the agent (Chethan or
me) must perform a GitHub research pass and produce a comparison
report. Reuse > extend > build. Don't reinvent.

Categories to audit:

| Category | Candidates to evaluate (at least these) |
|---|---|
| Desktop search | Everything (voidtools), DocFetcher, Recoll, Catfish, Search Monkey |
| Semantic search / RAG | Semantra, AnythingLLM, Open WebUI, MemOS, LangChain RAG starter kits, txtai |
| OCR | Tesseract, PaddleOCR, OCRmyPDF, EasyOCR |
| Document parsing | Docling (IBM, the spec named), Apache Tika, Unstructured, marker |
| Vector DBs | Qdrant (the spec named), Chroma, Weaviate, LanceDB |
| Full-text search | Meilisearch, Typesense, Tantivy, ZincSearch |

Per-repo evaluation matrix:
- Stars + recent commits (recency = maintenance signal)
- License (must be MIT / Apache / BSD-style — no AGPL inside Dex
  distribution)
- Local-first (no mandatory cloud endpoint)
- Resource footprint (RAM, disk, CPU at idle and indexing)
- Embedding / extensibility surface (plugin? CLI? library?)
- Node / TS bindings if available
- Multi-platform (must work on Windows / Linux / macOS — desktop)
- Active maintainer responsiveness (issue / PR turnaround)

Output: `docs/g-research/file-intelligence-comparison.md` with a
final per-category recommendation: "use X", "wrap X behind interface",
"build minimal own because X is unmaintained".

Default lean (subject to research overriding it):
- Indexing: **chokidar** for the file watcher (well-maintained, Node-
  native, the spec named it).
- Parsing: **Docling** for PDFs / DOCX (the spec named it; IBM's
  recent project with strong layout understanding).
- Embeddings: **Ollama** + `nomic-embed-text` (local, fast, the spec
  named it).
- Vector DB: **Qdrant** (the spec named it; Rust core, has Node
  client, good local-mode story).
- OCR (image / scanned PDF fallback): **Tesseract** wrapped via
  `tesseract.js` or a child process to native Tesseract.
- Full-text fallback: **Tantivy** or **MiniSearch** (in-process, no
  separate daemon).
- Classification: lightweight rules + embedding-based zero-shot
  classifier; no separate ML model unless research shows we need one.

## G.2 — Local-first architecture

Hard rules:
- Zero cloud calls during indexing, search, or retrieval. Period.
- Indexes never leave the device they were built on.
- Cross-device search exchanges **search results + file metadata
  only**, never raw file content, until the user explicitly picks a
  delivery channel.
- Embeddings computed locally via Ollama.
- All state under `~/.dex/file-intel/` (gitignored, per-device).

Privacy posture: a user can revoke a paired device, and the device's
index disappears with it. No central manifest. No telemetry on file
contents — only anonymous metrics on "how many files indexed", "p95
search time", aggregated per-device.

## G.3 — Project layout

New TypeScript package under `dex/core/packages/file-intel/`:

```
dex/core/packages/file-intel/
├── package.json                          (private: false; named @dexagent/file-intel)
├── src/
│   ├── index.ts                          (public surface — facade)
│   ├── indexer/
│   │   ├── scanner.ts                    (chokidar recursive scan)
│   │   ├── extractor.ts                  (Docling + Tika fallback)
│   │   ├── ocr.ts                        (Tesseract wrapper)
│   │   ├── classifier.ts                 (regex + zero-shot)
│   │   └── incremental.ts                (mtime + hash diff)
│   ├── store/
│   │   ├── qdrant.ts                     (vector store adapter)
│   │   ├── fulltext.ts                   (MiniSearch / Tantivy)
│   │   └── metadata.ts                   (sqlite via Kysely)
│   ├── search/
│   │   ├── query-parser.ts               (natural-language → filter)
│   │   ├── hybrid-search.ts              (vector + full-text rerank)
│   │   └── ranker.ts                     (cross-encoder rerank)
│   ├── delivery/
│   │   ├── provider.ts                   (DeliveryProvider interface)
│   │   ├── dex-direct.ts                 (download via gateway WS)
│   │   ├── email.ts                      (SMTP — opt-in)
│   │   ├── whatsapp.ts                   (existing extensions/whatsapp)
│   │   ├── device-transfer.ts            (paired device transfer)
│   │   ├── clipboard.ts                  (paste to active device)
│   │   ├── local-save.ts                 (write to current device's
│   │   │                                  Downloads)
│   │   └── share-link.ts                 (signed ephemeral URL)
│   └── mesh/
│       ├── device-discovery.ts           (list paired devices)
│       ├── remote-search.ts              (search a paired device's
│       │                                  index over the LAN relay)
│       └── result-merger.ts              (multi-device rank fusion)
└── test/
    └── e2e/
        └── aadhaar-fetch.test.ts         (the killer use-case test)
```

## G.4 — Database schema (per-device SQLite + Qdrant)

SQLite (Kysely-managed) — file metadata + classifications:

```sql
CREATE TABLE files (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  path            TEXT NOT NULL UNIQUE,
  filename        TEXT NOT NULL,
  extension       TEXT,
  size_bytes      INTEGER NOT NULL,
  created_at_ms   INTEGER NOT NULL,
  modified_at_ms  INTEGER NOT NULL,
  content_hash    TEXT NOT NULL,     -- xxhash64 for incremental
  classification  TEXT,              -- aadhaar | pan | passport | ...
  ocr_used        INTEGER DEFAULT 0,
  extracted_text  TEXT,
  qdrant_point_id TEXT,              -- back-reference to vector
  last_indexed_ms INTEGER NOT NULL
);
CREATE INDEX files_classification ON files(classification);
CREATE INDEX files_modified ON files(modified_at_ms);
CREATE INDEX files_content_hash ON files(content_hash);
```

Qdrant collection `dex_files`:
- Vector size: 768 (nomic-embed-text default)
- Distance: Cosine
- Payload: `{ file_id, filename, extension, classification }`

## G.5 — Indexing pipeline

```
chokidar.watch([Desktop, Documents, Downloads, Pictures], {
  ignored: GIT_VENDOR_NODEMODULES_IGNORE,
  awaitWriteFinish: { stabilityThreshold: 500 },
}).on('add'|'change', handlePath)

handlePath(path):
  1. mtime + size + xxhash64 of head/tail blocks → quick skip if unchanged
  2. extract:
     - PDF / DOCX / TXT / MD → Docling (with Tika fallback)
     - PNG / JPG / WEBP → OCR (Tesseract)
     - Scanned PDF → page-by-page OCR
  3. classify:
     - Quick regex on filename ("aadhaar", "PAN", "passport", ...)
     - Embedding zero-shot vs label prototypes
  4. embed via Ollama (nomic-embed-text)
  5. upsert sqlite metadata + Qdrant point
  6. emit incremental telemetry (no file contents)
```

Background worker architecture:
- `chokidar` watcher in the main process; emits jobs to a queue.
- Worker pool (default: 2) processes jobs concurrently.
- Backpressure: pause watcher if queue > 10k jobs.
- Resume on next startup from the last `last_indexed_ms` cursor.

## G.6 — Search pipeline

```
search(query: string, deviceScope: 'local' | DeviceId[]):
  1. parse query → filters + free text
       "screenshots from last month containing API keys"
       → {classification:'screenshot', date:[lastMonth], text:'API keys'}
  2. local scope:
       - Qdrant similarity search on embedding(text)
       - MiniSearch full-text on extracted_text
       - merge via Reciprocal Rank Fusion (RRF)
       - filter by classification + date
       - rerank top-50 with cross-encoder (optional, gated by latency)
  3. multi-device scope:
       - fan out search() to each paired device over LAN relay
       - each returns top-20 with normalized scores
       - merge_global() does RRF across devices
  4. return [{path, filename, extension, similarity, classification,
              device_id, device_name, preview_text}]
```

## G.7 — Cross-device intelligent retrieval

This is the killer UX. Flow:

```
[User's phone] "Fetch my Aadhaar card from my laptop"
     ↓
[Dex mobile client] -> nlu-parse(query)
     intent: retrieve
     scope: device-of-type "laptop"
     concept: aadhaar
     ↓
[Dex gateway] device-discovery
     paired_devices = [
       Personal Laptop (Windows, online),
       Work Laptop (macOS, online),
       Android Phone (current, online),
     ]
     matching_devices = filter(devices, type='laptop')
     ↓
if len(matching) > 1:
   reply: "Found multiple laptops:
            1. Personal Laptop  2. Work Laptop
            Which one?"
   ↓ user picks OR says "search all"
   ↓
fan_out_search → each laptop returns top-20 with classification=aadhaar
     ↓
merge_global() → top-1 = "Aadhaar.pdf on Personal Laptop"
     ↓
Dex doesn't auto-transfer. Asks:
   "Found your Aadhaar card. How would you like to receive it?
    1. Download directly in this Dex client
    2. Open on the source device
    3. Send to another Dex device
    4. Email to me
    5. Send via WhatsApp
    6. Copy to clipboard
    7. Generate secure temporary link
    8. Save to Downloads on this device"
     ↓
[Selected: WhatsApp]
     ↓
DeliveryProvider.whatsapp(file_metadata):
   1. opens encrypted WS to source device
   2. streams file content to gateway
   3. gateway hands off to extensions/whatsapp/send-to-self
   4. WhatsApp message arrives in user's chat
   5. file on source device never moved
```

## G.8 — Delivery adapters

`DeliveryProvider` interface in `delivery/provider.ts`:

```typescript
export interface DeliveryProvider {
  /** Stable id used in UI + config. */
  id: string;
  /** Display name shown in the "How would you like to receive it?" prompt. */
  displayName: string;
  /** Available iff the user has configured / paired this channel. */
  isConfigured(): boolean;
  /** Cheap availability probe before showing in the menu. */
  isReachable(): Promise<boolean>;
  /** Deliver the file. May stream, may invoke other channels. */
  deliver(file: FileMetadata, ctx: DeliveryContext): Promise<DeliveryResult>;
}
```

v1 implementations:
- **DexDirectDownloadProvider** — streams file over the gateway WS to
  the requesting Dex client.
- **DeviceTransferProvider** — Dex device A → Dex device B over the
  paired-device relay.
- **ClipboardProvider** — copies a file path or base64 inline to the
  active device's clipboard.
- **LocalSaveProvider** — writes to `~/Downloads/` (or platform
  equivalent) on the requesting device.
- **ShareLinkProvider** — generates a signed time-limited URL served
  by the gateway, fetchable from any browser; URL expires in 5 min by
  default.

v1.1+ implementations (gated on existing extensions being present):
- **EmailProvider** — SMTP send via `dex configure` SMTP block.
- **WhatsAppProvider** — reuses `extensions/whatsapp/` send-to-self.
- **TelegramProvider**, **DiscordProvider**, **SlackProvider** — same
  pattern.

## G.9 — Performance + reliability

- **Incremental indexing**: xxhash64 of file head + tail (first 64 KB
  + last 64 KB) → skip unchanged files. Full re-hash only on size
  change or mtime regression.
- **100k+ files**: target index size < 5 GB for 100k typical docs
  (vectors dominate). Qdrant local mode handles this comfortably.
- **Index lag SLO**: a new file appears in search results within 30 s
  of being saved.
- **Cold-start**: first-time full scan paces itself to ≤ 25% CPU /
  500 MB RAM by default; user-tunable.
- **Search latency**: < 200 ms p95 for single-device semantic search
  on a 100k-file index. < 800 ms p95 for cross-device fanout to 3
  devices.

## G.10 — Setup / install story

`dex file-intel setup` (new CLI subcommand):
1. Detects available local OCR (Tesseract) and Docling.
2. Pulls `nomic-embed-text` via `ollama pull` if not present.
3. Starts Qdrant local instance (downloaded on demand to
   `~/.dex/file-intel/qdrant/`).
4. Asks which folders to index (default: Desktop / Documents /
   Downloads / Pictures, all opt-in).
5. Starts the watcher daemon as a Dex sidecar process.

`dex file-intel status` / `dex file-intel rebuild` / `dex file-intel
forget <path>` for operational control.

## Phase G — Acceptance (the killer demos)

1. **Single-device Aadhaar fetch:**
   - Place an Aadhaar PDF in Downloads.
   - From the Flutter desktop client: type "find my aadhaar card".
   - Within < 1 s, Dex shows the PDF as the top hit with
     classification badge "aadhaar" + 96%+ similarity score.
   - Click "Open on this device" → file opens in the default PDF
     viewer.

2. **Cross-device fetch with disambiguation:**
   - Pair the Personal Laptop and the Android Phone (D.2 mobile work
     ships this prerequisite).
   - From the phone Dex app: "fetch my resume from my laptop".
   - Dex on phone asks the gateway → laptop returns "resume_v3.pdf"
     top-1.
   - Phone shows delivery picker; user picks WhatsApp.
   - File arrives in the user's WhatsApp chat with themselves.

3. **Smart fallback ("search all"):**
   - User has two laptops paired.
   - Asks: "find my passport scan".
   - Reply: "Found multiple laptops. 1. Personal Laptop  2. Work
     Laptop  Which one?"
   - User: "search all".
   - Both laptops searched; the Personal Laptop hit wins with higher
     score; merged result shown.

## Phase G — Risks

1. **Docling install footprint.** IBM's Docling pulls in heavy
   Python deps. Mitigation: gate behind a `dex file-intel setup
   --with-docling` flag; if not installed, fall back to Tika +
   `pdf-parse` Node libs (lower fidelity but no install).
2. **Ollama may not be present.** First-run setup downloads it. If
   the user refuses, the embedder falls back to a small ONNX model
   shipped with the package (lower-quality but zero-config).
3. **False classification.** A PDF named "aadhaar.pdf" that's
   actually unrelated would mis-classify. Mitigation: classification
   uses BOTH filename heuristics AND content embedding zero-shot;
   disagreement surfaces a "Verify classification?" prompt the user
   can correct (and the correction trains a per-device prior).
4. **Privacy in cross-device search.** A malicious paired device
   could spam fake high-similarity results to extract metadata.
   Mitigation: only paired devices the user explicitly approved get
   queries; each query rate-limited; result schemas are strict.
5. **Index drift on aggressive file movement.** A `mv` across drives
   trips chokidar's delete + add fires. Mitigation: same xxhash
   → re-link existing index row to new path, avoid re-extracting.

## Phase G — Progress log

- [x] G.1 — `docs/g-research/file-intelligence-comparison.md`
            comparison report shipped 2026-06-07. Verification gate
            still requires four spot-checks before G.2 commits land
            (live GitHub state, Docling install size, Qdrant local
            latency, tesseract cross-OS availability) -- see §11 of
            the report. Open questions for Chethan in §12.
- [x] G.2 — `dex/core/packages/file-intel/` scaffold + types
            (interface + facade shipped 2026-06-07; every method
            returns `not-yet-implemented` until G.3+). Implementation
            still gated on G.1 §11 verification spot-checks.
- [ ] G.3 — `indexer/scanner.ts` (chokidar) + `extractor.ts`
            (Docling / Tika)
- [ ] G.4 — SQLite metadata schema via Kysely + Qdrant local mode
- [ ] G.5 — `embedder/ollama.ts` + `classifier.ts`
- [ ] G.6 — Single-device search (hybrid vector + full-text)
- [ ] G.7 — `mesh/device-discovery.ts` +
            `mesh/remote-search.ts` + result merge
- [ ] G.8 — `delivery/provider.ts` interface + v1 providers
            (DexDirect, DeviceTransfer, Clipboard, LocalSave,
            ShareLink)
- [ ] G.9 — `delivery/whatsapp.ts` + `delivery/email.ts` (gated on
            existing extensions)
- [ ] G.10 — `dex file-intel setup` / `status` / `rebuild` CLI
- [ ] G.acceptance — three killer demos pass end-to-end

---

# Phase H — Live screen context system + non-disruptive observation

> Chethan's second ask (2026-06-06): when the user opens Dex on
> their phone and asks "What am I looking at?" or "Why is this error
> happening?", Dex should be able to SEE the connected laptop's
> screen and reason about it — without ever stealing focus, raising
> a window, or interrupting whatever the user was doing.

## H.0 — The two locked principles

1. **Observer mode by default.** Dex never brings an app to the
   foreground, never switches tabs, never minimizes / maximizes /
   rearranges windows, never steals keyboard or mouse focus, never
   interrupts a fullscreen application. Read the currently-visible
   state only.
2. **Cross-device works without uploads.** The user on a phone asks
   a question about what's on their laptop. Dex on the phone talks
   to Dex on the laptop, the laptop captures + analyzes the visible
   surface, and only the structured result (+ optionally a single
   compressed screenshot) crosses the wire. The phone never needs
   the user to manually upload.

## H.1 — The capture pipeline (on the source device)

```
[Phone] "explain this code"
  ↓ over Dex device-pair WS
[Laptop Dex sidecar] receives screen-context request
  ↓
1. capture()
   - Win32: BitBlt of the foreground window only (NOT the full
     desktop), OR PrintWindow with PW_RENDERFULLCONTENT to get
     occluded portions of THIS window. No screenshot of OTHER apps.
   - macOS: CGWindowListCreateImage scoped to the foreground window.
   - Linux: XGetImage of the foreground window via X11; on Wayland,
     ask via xdg-desktop-portal's ScreenCast for one frame.
2. classify the source app (UIA / Accessibility tree):
   - chrome.exe / msedge.exe / firefox.exe → web browser (extract
     active tab URL via CDP if extension permits)
   - code.exe / cursor.exe → VS Code (use the editor extension API
     if present; otherwise OCR)
   - idea64.exe → IntelliJ
   - WindowsTerminal.exe / wt.exe → terminal (read scrollback via
     conhost / pty buffer if accessible; else OCR)
   - Acrobat / Preview → PDF reader
3. extract structured context:
   - For browsers with DOM access (via CDP if enabled): live HTML
     selection + accessibility tree.
   - For native apps with UIA: UI element tree (text fields, button
     labels, table cell text).
   - For pixel-only surfaces (games, custom-drawn): OmniParser
     (Phase E.0/E.1 already shipped the service).
4. structured ContextPayload:
   { app: {name, family, version?, focusedElement?},
     viewport: {w, h, dpi},
     visibleText: string,         # OCR + UIA text combined
     code?: {language, source},   # heuristic: monospace font + braces
     errorMessage?: string,
     stackTrace?: string[],
     table?: {headers, rows},
     image?: {pngBase64Compressed} # only if user consented
   }
5. ship to the reasoning agent (Claude / Gemini / local model)
```

## H.2 — The non-disruptive guarantees (code-level rules)

Every capture path must respect these. The shared module
`packages/screen-context/src/non-disruption.ts` enforces them.

| Rule | Enforcement |
|---|---|
| Never bring an app to foreground | Capture uses scoped APIs (BitBlt of HWND, CGWindowListCreateImage scoped); we don't call `SetForegroundWindow` / `Activate`. |
| Never switch tabs | Browser inspection reads the ACTIVE tab only. No `chrome.tabs.update`. |
| Never change the active window | No `SwitchToThisWindow`, no `BringWindowToTop`, no `ShowWindow(SW_RESTORE)`. |
| Never minimize / maximize / rearrange | No window-manager calls except read-only `GetWindowRect`. |
| Never steal keyboard / mouse focus | No `SetFocus`, no `mouse_event` / `SendInput`. |
| Never interrupt fullscreen | Detect fullscreen via Win32 `SHQueryUserNotificationState` / macOS `kCGWindowIsOnscreen` + size==screen; if true, capture is gated behind explicit per-session consent. |

A static analyzer in `packages/screen-context/test/policy.test.ts`
greps the screen-context source for any banned API call and FAILS
the build if one slips in.

## H.3 — The Phase E vision service connection

Phase E.0/E.1 already shipped `VisionService` + `OmniParserVisionService`.
Phase H reuses them:

- When the source app has rich UIA/DOM: extract structured text from
  the accessibility tree, ship that. Fast, no vision needed.
- When the source app is pixel-only (game, Figma canvas, custom
  Win32, Java Swing): call `VisionService.locate()` to get
  `(bbox, label, type)` for visible elements, ship that as a
  structured payload alongside the screenshot.
- The vision-assist eye badge from E.6 lights up on the phone's chip
  so the user knows Dex used the visual cortex.

## H.4 — Cross-device session continuity

The reasoning agent's session needs to remember the screen context
across follow-up turns. UX example:

```
[Phone] "explain this code"        → captures, replies
[Phone] "can you optimize it?"     → MUST use the same captured code
[Phone] "rewrite it in C++"        → same source still
```

Implementation: the captured ContextPayload is cached server-side
under a `screen_context_session_id`, scoped to the user's chat
session. Subsequent turns include the cached payload in the prompt
unless:
- Phone explicitly asks "what about now?" → recapture.
- 5 minutes have elapsed → recapture.
- User switched apps on the source device → invalidate + ask phone
  whether to recapture.

## H.5 — Permission model

Privacy is non-negotiable. Layered consent:

1. **Per-device toggle.** During pairing, the user opts in to "Allow
   this device to inspect my screen" — default OFF.
2. **Per-session prompt.** Every time the phone asks a screen-context
   question, the laptop shows a tray notification "Phone asks: explain
   this code (auto-accept in 3s)". User can decline or set "always
   allow for this session".
3. **Per-app deny-list.** User can mark apps (banking, password
   manager) as "never capture". The capture path checks the foreground
   app's process name + window title against the deny-list FIRST and
   refuses if matched.
4. **Local-first processing.** OCR runs locally. Vision parser runs
   locally (OmniParser MCP). Only the structured ContextPayload (+
   optional compressed PNG with explicit per-session consent) crosses
   the wire.
5. **No persistent storage.** Captures are in-memory by default;
   debug captures go to `~/.dex/screen-context/captures/` only when
   `DEX_SCREEN_CAPTURE_DEBUG=1` is set. `dex doctor --fix` clears
   the dir.

## H.6 — Research-first directive (same as G.1)

Before any H.* implementation, audit:

| Category | Candidates |
|---|---|
| Screen capture (cross-platform) | `electron-screenshot`, `screenshot-desktop`, `node-screenshots`, native Win32/AppKit/X11/Wayland portals |
| Accessibility tree | Microsoft `pyautogui` accessibility, `uiautomation`, `pywinauto`, macOS `AXUIElement`, Linux `at-spi2` |
| Browser DOM extraction | Chrome DevTools Protocol (CDP), Playwright introspection, browser extensions (Vimium-style) |
| Screen text understanding | OmniParser (already in tree), GPT-4V, LLaVA-Next, Florence-2 |
| OCR (re-evaluate from G.1 lens) | Tesseract, PaddleOCR — same survey as G.1 |
| Editor introspection | VS Code MCP server (microsoft/vscode-mcp), JetBrains MCP |

Output: `docs/h-research/screen-context-comparison.md`. Default lean
(subject to research override): native OS APIs for capture +
existing OmniParser + UIA libs already on Windows. Reuse > extend
> build, same rule as Phase G.

## H.7 — Project layout

```
dex/core/packages/screen-context/
├── package.json                                  (@dexagent/screen-context)
├── src/
│   ├── index.ts                                  (public surface)
│   ├── capture/
│   │   ├── win32.ts                              (BitBlt of foreground HWND)
│   │   ├── macos.ts                              (CGWindowListCreateImage)
│   │   ├── linux-x11.ts                          (XGetImage)
│   │   └── linux-wayland.ts                      (xdg-desktop-portal)
│   ├── extract/
│   │   ├── uia.ts                                (UIA / Accessibility tree
│   │   │                                          → structured text)
│   │   ├── dom.ts                                (CDP for browsers)
│   │   ├── vscode.ts                             (VS Code MCP if present)
│   │   ├── pdf.ts                                (Acrobat / Preview UIA hook)
│   │   └── ocr-fallback.ts                       (when nothing else)
│   ├── classify/
│   │   ├── language.ts                           (programming-language guess)
│   │   ├── error-message.ts                      (regex + structure)
│   │   └── chart-table-form.ts
│   ├── permissions/
│   │   ├── pair-consent.ts
│   │   ├── session-consent.ts
│   │   └── app-denylist.ts
│   ├── non-disruption.ts                         (the locked rules + checker)
│   ├── session.ts                                (server-side context cache)
│   └── mesh/
│       ├── request.ts                            (phone -> laptop request)
│       └── transport.ts                          (WS frame schema)
└── test/
    ├── policy.test.ts                            (banned-API static check)
    └── e2e/
        └── explain-this-code.test.ts             (the killer demo)
```

## Phase H — Acceptance

1. **Code explanation across devices:**
   - User has VS Code open on laptop with a Python snippet visible.
   - Opens Dex on phone, types: "explain this code".
   - Within 3 s, the phone shows Claude's explanation referencing
     the actual function name + line numbers from the laptop.
   - The laptop's window stack is byte-for-byte identical before
     and after (verified by recording the foreground HWND + Z-order
     + window rects, asserting equality).

2. **Error-message diagnosis:**
   - User has a terminal open with a stack trace visible.
   - From phone: "why is this error happening?"
   - Dex extracts the stack trace via OCR + structured parsing,
     pulls the actual error class + message, answers with a
     remediation.
   - Same non-disruption check passes.

3. **Follow-up continuity:**
   - First turn: "explain this code". Second turn: "rewrite in C++".
   - The reasoning agent uses the cached ContextPayload for the
     second turn without recapturing.

4. **Per-app deny-list works:**
   - User adds "1password.exe" to the deny-list.
   - Phone asks "explain this screen" while 1Password is foreground.
   - Reply: "I can't capture the active app per your deny-list
     setting. Switch to another app and ask again."

## Phase H — Risks

1. **Wayland fragmentation.** Different compositors expose screen
   capture differently. Mitigation: use xdg-desktop-portal
   ScreenCast on Wayland — the standardized API; gracefully degrade
   to "screen capture not available on this Wayland session, use
   the laptop screenshot tool instead" with a clear hint.
2. **Browser-tab CDP requires DevTools Protocol enabled.** Most
   users haven't enabled it. Mitigation: fall back to UIA + OCR for
   browsers without CDP; document the `--remote-debugging-port` flag
   for power users who want richer extraction.
3. **Capture + ship payload size.** Even a single laptop screen at
   4K is ~10 MB raw PNG. Mitigation: only ship the screenshot when
   the user explicitly consents per-session; default payload is
   text-only structured. Compress PNGs to WebP with quality 75 if
   shipping.
4. **Static analyzer gives false positives.** "Never call
   `SetForegroundWindow`" might fail on a legit comment or string.
   Mitigation: the static-check regex matches `\bSetForegroundWindow\s*\(`
   only, not comment-bound strings.
5. **Session continuity vs. privacy.** Cached ContextPayload could
   leak across users if multiple sessions share one gateway. Mitigation:
   cache key includes `sessionKey` + `userFingerprint`; cache expires
   in 5 min idle.

## Phase H — Progress log

- [x] H.1 — `docs/h-research/screen-context-comparison.md` shipped
            2026-06-07. Verification gate (§12 spot-checks) still
            required before H.2 commits. Open questions for Chethan
            in §13.
- [x] H.2 — `packages/screen-context/` scaffold + types + non-disruption
            checker shipped 2026-06-08 (26/26 tests green; multi-line
            `/* */` block-comment false-positive fixed). H.3+ remains
            gated on H.1 §12 verification spot-checks.
- [ ] H.3 — Win32 capture (foreground HWND, BitBlt) + UIA extractor
- [ ] H.4 — Browser DOM extractor via CDP (with UIA fallback)
- [ ] H.5 — VS Code / JetBrains extractor via their MCP servers
- [ ] H.6 — OCR fallback path (Tesseract)
- [ ] H.7 — `non-disruption.ts` rule set + static-policy test
- [ ] H.8 — Cross-device transport: phone -> laptop screen-context
            request over the device-pair WS
- [ ] H.9 — Server-side session.ts cache for follow-up continuity
- [ ] H.10 — Permission UI (per-pair, per-session, per-app deny-list)
- [ ] H.11 — macOS / Linux capture paths (post-Windows MVP)
- [ ] H.acceptance — four killer demos pass end-to-end

---

# Sequencing update (post-2026-06-06)

Locked order now reads:

1. **F.1.a wire-in** — call `preflight()` from the agent loop and
   append `hint` to the system prompt. (Foundation already shipped
   in 2026.6.14.)
2. **E.3** — canvas detection hook in browser-control (already in
   plan).
3. **G.1** — file-intelligence research report. NO implementation
   until research is done. The report itself is the deliverable.
4. **H.1** — screen-context research report (same rule).
5. **G.2 – G.10** — local file intelligence MVP.
6. **H.2 – H.11** — live screen context MVP.
7. **v1.2** — Live action surface + Stop button + Windows chrome
   (Stop button already shipped in 2026.6.13).
8. **D.2 expanded** — native mobile clients (G + H really shine
   once the phone client exists; both demos require it).
9. **v1.5** — installer + production polish.

Why G + H come before the mobile native work even though their
killer demos need the phone: G + H can be smoke-tested with the
Flutter DESKTOP app first ("from this desktop, explain what I just
took a screenshot of"), and the protocol shape lands cleanly so
the native mobile clients consume a stable API when they ship.

---

# v1.2 — Live Tool Activity (pulled forward from the original v1.2)

> Chethan's 2026-06-06 pain: after F.1.a wire-in landed, the agent
> correctly routes "open notepad" to UFO² and "change resolution" to
> PowerShell, but when those tools run he can't see what they're
> doing. The chip just sits "running ..." for 30+ seconds, then
> either lands a chunk of LLM-narrated prose or falls back silently.
> The 5-minute waits feel like 5 minutes because there's no signal.
>
> This phase is the surface that makes Dex feel responsive even when
> the LLM is slow. It does NOT add features the LLM has to narrate;
> it renders straight from the gateway's existing toolCall +
> toolResult events.

## v1.2.A — ToolActivity model + ConversationStore tracking

New file `app/lib/core/models/tool_activity.dart`:

```dart
enum ToolActivityState { running, done, failed, aborted }

class ToolActivity {
  final String callId;
  final String toolId;             // raw MCP id (bash, run_desktop_task, ...)
  final String displayName;        // friendly via tool_registry
  final EngineId? engine;          // routed engine (from C.7-flutter)
  final Map<String, dynamic>? args;
  final DateTime startedAt;
  final List<String> outputLines;  // appended live as result streams
  final String? summary;
  final bool? ok;
  final DateTime? endedAt;
  final ToolActivityState state;

  Duration get duration =>
      (endedAt ?? DateTime.now()).difference(startedAt);
}
```

`ConversationStore` gains:
- `List<ToolActivity> activities` — most-recent first
- `ToolActivity? get currentActivity` — first running, or null
- onToolCall(evt) → append new running ToolActivity
- onToolResult(evt) → flip running → done/failed, populate summary +
  outputLines from `result.steps`, `result.summary`, `result.stdout`
- Bounded buffer: keep last 50 activities; older ones drop off the
  bottom so a long session doesn't leak memory.

## v1.2.B — ActivityCard widget

New `app/lib/widgets/activity_card.dart`. Renders one
`ToolActivity` as a vertically-stacked card:

```
┌─────────────────────────────────────────────────┐
│ [ufo-uia]  Windows app  ·  3.2s   [ ✓ done ]    │
│ ─────────────────────────────────────────────── │
│ run_desktop_task                                │
│   goal: "open notepad and write hello"          │
│   app_hint: notepad.exe                         │
│ ─────────────────────────────────────────────── │
│ 1) focus notepad window                         │
│ 2) type 'hello'                                 │
│ 3) save buffer                                  │
└─────────────────────────────────────────────────┘
```

For shell calls the args block shows the literal command:

```
┌─────────────────────────────────────────────────┐
│ [shell]  Shell  ·  0.4s   [ ✓ done ]            │
│ ─────────────────────────────────────────────── │
│ bash                                             │
│   command: "Get-DisplayConfig"                  │
│ ─────────────────────────────────────────────── │
│ DisplayCount: 1                                 │
│ DisplayId: \\.\DISPLAY1                          │
│ MaxResolution: 2560x1440 @ 165Hz                │
└─────────────────────────────────────────────────┘
```

When running, the state badge is `[ ... running 12s ]` updating
every second; output area shows a 3-dot pulse until the result frame
lands. This is the part that addresses "the model is thinking 5
minutes for simple stuff" — when the LLM is the slow part, the
panel shows `running` clearly; when the TOOL is slow, the activity
sits with the tool name visible so you know what's actually
blocking. No mystery delays.

## v1.2.C — Live panel rebuild (the existing v1.2 LiveEntry list,
                                  formalized)

Replace `_RunningEngineCard` in `home_desktop.dart` with a stack:

```
Live
─────────────────────────────────
[ pending Action Preview ]      ← amber, top priority
─────────────────────────────────
[ running ActivityCard ]        ← whatever's executing now
─────────────────────────────────
[ recent ActivityCard ]         ← collapsed to one-liner
[ recent ActivityCard ]
[ recent ActivityCard ]
```

Scroll inside the Live column for older entries.

## v1.2.D — Streaming output (out-of-scope for v1.2.A-C; tracked here)

The current dex-core gateway emits `toolResult` ONCE when the tool
completes. To get true streaming output (live `Get-DisplayConfig`
lines as they print) we'd need a new gateway event
`toolOutputChunk`. That's a dex-core protocol change. Defer to
v1.2.D — fine until the user complains about a specific long-output
case. v1.2.A-C ship the structural improvement immediately and
already address "I can't see what the tool is doing" for everything
except the very-long-output case.

## v1.2 — Acceptance

1. Type "open notepad and write hello".
   - ActivityCard appears in Live panel with the orchestrator-routed
     engine pill + tool name `run_desktop_task` + args goal + args
     app_hint, BEFORE any LLM prose lands.
   - State stays "running 12s ..." while UFO² works.
   - If UFO² succeeds: badge flips green; output area shows step
     lines.
   - If UFO² times out: badge flips red; the LLM's fallback turn
     creates a SECOND ActivityCard (e.g. `bash` writing hello.txt).
   - User can read both cards and understand exactly what happened.

2. Type "change my screen resolution to highest".
   - PowerShell-shaped task; orchestrator picks `shell` (runaway, no
     hint) so the agent uses `bash`. Activity card shows the actual
     PowerShell command in args; output shows the command's stdout.
   - Token cost on the LLM side is unchanged — the card is rendered
     from raw events, not LLM prose.

3. Type "change my keyboard backlight to blue with G-Helper".
   - First card: `run_desktop_task` attempt, fails/times out.
   - Second card: `edit` modifying G-Helper config.
   - Third card: `bash` restarting G-Helper.
   - All three visible in the Live column; no LLM prose needed to
     explain.

## v1.2 — Out-of-scope for THIS chunk

- Streaming output mid-tool (v1.2.D)
- Stop button per activity (could be added but the global Stop
  button already shipped in 2026.6.13)
- Drag-to-reorder, pinning (post-v1.2)

---

# v1.3 — Fast / Deep mode toggle (Chethan's "5 min for simple stuff" ask)

> Claude Sonnet 4.6 with `thinking=adaptive` (the default after
> `dex onboard`) can spend 10-60 seconds reasoning before any tool
> call. For "open notepad" that's silly. For "design my Figma cloth
> store" that's the right setting. Make it switchable per-turn.

## v1.3.A — Command bar adds a mode toggle

`CommandBar` gains a small chip-style toggle to the left of the
text field: `[ fast | deep ]`. Default is `deep` (whatever the
user's `dex onboard` model+thinking config is). When `fast` is
picked, the next chat.send carries an override hint Dex's gateway
respects:

- For Claude Sonnet: forces `thinking=off` for that turn.
- For Gemini: forces `gemini-flash-latest` regardless of the user's
  primary.
- For mixed configs: dex-core picks the fastest path it can without
  changing the user's persistent config.

## v1.3.B — Auto-fast for trivially-routed turns

When the orchestrator's preflight picks `shell` with score > 0.9
AND task.kind is `extract` / `compose` / a short command, dex-core
can suggest fast mode (yellow hint in the chip: "fast mode
recommended"). The user clicks accept or ignores it. No automatic
override of the user's config.

## v1.3 — Out of scope (deferred)

- Per-conversation default mode (lives in v1.4 Settings)
- Token budget warnings (post-v1.4)

---

# UFO² hardening — open follow-ups

After the 2026.6.17 fixes (PYTHONIOENCODING + eva_prompter
truthiness + agents.yaml API_BASE), UFO² ran end-to-end in standalone
tests. But Chethan's 2026-06-06 session showed it still timed out
when called from the MCP server during a real Claude turn. Open
items:

- [ ] Check `vendor/UFO/logs/dex/<task-id>.log` for the real failure
      after Chethan's notepad turn -- the MCP server captures stderr
      there. Without that we're guessing.
- [ ] Possible causes still in scope:
      - Gemini Flash-Latest answering slower than the 120s MCP
        timeout when planning a long UI sequence
      - UFO² selecting a window that requires admin/UAC elevation
      - The MCP server's stdio pipe filling on UFO²'s 100K+ char
        request.log
- [x] Bump the default `run_desktop_task` timeout from 120s to 300s
      (shipped 2026.6.19). The `--fast` orchestrator flag is still
      open — currently the orchestrator hint suggests `run_desktop_task`
      but doesn't pass a timeout hint per-task. Track as F.1.b
      follow-up.
- [x] Surface UFO² stderr through the toolResult.summary so the
      Activity card actually shows the error instead of "tool
      timed out" (shipped 2026.6.19). Timeout path now includes
      "(last progress: Round N, Step M, Agent: X)" in the summary;
      non-zero exit appends stderr tail to result.steps and pulls
      the most useful line into the summary head.

Not blocking v1.2 / v1.3 above. When Chethan hits a UFO² timeout
again, the Activity card from v1.2.B will show the partial state
and the per-task log path; we triage from there.

---

# Polish pass — post-Spotlight session (2026-06-10)

## Context

The Copilot-inspired shell is live and the glossy menus + Spotlight
sub-window all ship. Chethan ran the app end-to-end and surfaced
fourteen distinct items that block the "feels finished" bar:
menu clipping in the chat, a missed rebrand on the terminal title,
the profile-menu Memory item not opening Settings, no cursor
feedback on in-app buttons, no animation in the fog, no Reminders
screen, no rich-paste support, no typewriter / staggered entry,
windowed-vs-maximized state not persisted, plus Apple-grade
refractive edges everywhere and an upgraded Spotlight overlay (move
up 25%, separate + button, stronger refractive treatment).

Plan: three commits, each small enough to land + smoke independently.

## Commit 1 — critical bugs

### 1a. Popup menus stay on-screen
The shared `GlossyMenu` (`app/lib/widgets/glossy_menu.dart`) clamps
the anchor but doesn't know the menu's own height, so mode picker
(4 items × ~60px) and add menu (7 items × ~44px) overshoot the
bottom of a tall window when the composer triggers them from the
bottom of the screen.

Refactor:
- Replace the `Offset anchor` parameter with `Rect trigger` (the
  trigger button's screen-space rect) + a `MenuDropDirection
  preferUp/preferDown` hint. New shape:
  ```dart
  GlossyMenu.show<T>({
    required BuildContext context,
    required Rect trigger,
    required List<GlossyMenuEntry<T>> entries,
    double width = 260,
    MenuDropDirection prefer = MenuDropDirection.up,
  });
  ```
- Internal layout uses `CustomSingleChildLayout` + a `Delegate` that
  measures the menu's intrinsic size, then picks position:
  1. If `prefer == up` and `trigger.top - menuH - 16 >= 0` → drop
     above, top = trigger.top - menuH - 6.
  2. Else if there's room below → drop below,
     top = trigger.bottom + 6.
  3. Else → clamp top to `16`, set `maxHeight = viewport.height - 32`,
     wrap children in scrollable (`SingleChildScrollView` inside the
     glossy card with `Scrollbar(thumbVisibility: false)` so it
     scrolls without painting a bar).
- Horizontal: clamp left to `[16, viewport.width - width - 16]`.

Update callers (`dex_composer.dart` `_openMode` + `_openAdd`,
`glossy_dropdown.dart` `_openMenu`, `profile_menu.dart`) to pass
`box.localToGlobal(Offset.zero) & box.size` and the correct
`prefer` direction. ProfileMenu uses `prefer: up` from the avatar's
rect; the two composer menus use `prefer: up`; the glossy dropdown
uses `prefer: down`.

### 1b. openclaw → Dex sweep on the visible surfaces
Exact hits (from explore):
- `dex/core/src/entry.ts:97` — `process.title = "openclaw"` → `"dex"`.
  This is the terminal-title source.
- `dex/core/src/index.ts:105` — error-dialog title prose.
- `dex/core/src/cli/run-main.ts:816` — same error-dialog title.
- `dex/core/ui/public/sw.js:1,110,113` — control-UI service-worker
  comment + push-notification fallback titles.
- `dex/core/ui/package.json:2` — internal workspace package name
  `openclaw-control-ui` → `dex-control-ui`.

Skip: `npm-shrinkwrap.json` (regenerates on `pnpm install`),
HERITAGE / LICENSE files, test fixtures, `@openclaw/fs-safe`,
`@openclaw/proxyline` (external upstream deps).

After the edits, rebuild dex-core (`pnpm build` inside `dex/core`)
and reinstall globally so the new `process.title` ships:
`cd dex/core && pnpm build && npm install -g .`

### 1c. Profile menu Memory + Reminders → Settings tab
`home_desktop.dart::_openProfile` already calls `SettingsDialog.show`
on `ProfileMenuAction.settings`. Extend the switch:
```dart
switch (picked) {
  case ProfileMenuAction.settings:
    await SettingsDialog.show(context);
    break;
  case ProfileMenuAction.memory:
    await SettingsDialog.show(context, initial: SettingsTab.memory);
    break;
  case ProfileMenuAction.reminders:
    await RemindersScreen.show(context);  // new (see Commit 3)
    break;
  case ProfileMenuAction.feedback:
    // existing — opens GitHub issues URL
    break;
  case ProfileMenuAction.signOut:
    // existing
    break;
}
```

### 1d. Hover cursor app-wide (native Windows behaviour)
Clarification from user: this is NOT a custom cursor. They want the
standard OS cursor to switch between modes (arrow → pointer hand on
clickable, I-beam on text fields, default elsewhere) like any
normal Windows app does. Flutter desktop already supports this via
`SystemMouseCursors` — the issue is just that several callsites
use bare `GestureDetector` / `InkResponse` which don't emit a
cursor change without explicit `MouseRegion`.

Fix:
- Add `WidgetStatePropertyAll(SystemMouseCursors.click)` to the
  Material button themes in `theme.dart`
  (`iconButtonTheme`, `elevatedButtonTheme`, `textButtonTheme`,
  `outlinedButtonTheme`) so every standard button surface emits
  the OS pointer hand on hover. TextField already emits the
  I-beam by default via the framework, no changes needed there.
- Wrap the bare `GestureDetector` / `InkResponse` callsites that
  don't get a cursor for free:
  - `home/recent_files_card.dart` rows + `home/recent_chats_card.dart`
    rows
  - `dex_sidebar.dart` `_NavItem` (uses InkWell — verify it picks
    up the hand; should without any change since InkWell already
    sets `SystemMouseCursors.click` via its hover handling)
  - `chat/message_actions_row.dart` `_IconAction`
  - `composer/dex_composer.dart` `_RoundIconButton`, `_SendButton`,
    `_ModePill`
  - `voice/voice_mode_screen.dart` `_ControlButton`
- Use `SystemMouseCursors.click` (which Flutter maps to the OS
  pointer hand on Windows). No custom cursor asset is being
  introduced.

### 1e. Repo cleanup
- `git rm image-tobedeleted.png image0.png image1.png future.png
  dex_ascii.txt "Dex — Implementation Plan.txt"`
- Add to `.gitignore`:
  ```
  # Stray drops at project root
  /image*.png
  /future.png
  /dex_ascii.txt
  /Dex — Implementation Plan.txt
  /copilot-ref/
  /image-tobedeleted.png
  ```
- Single commit, no behavior change.

### 1f. Window state persistence
Use `shared_preferences` (already in the app via `tray.dart`). New
keys in `tray.dart`:
```dart
const String prefsKeyWindowMaximized = 'dex.window.maximized';
const String prefsKeyWindowBounds    = 'dex.window.bounds'; // "x,y,w,h"
```

In `main.dart`'s main():
1. Before `windowManager.show()` (currently triggered by the tray
   on demand), read the saved keys and apply via
   `windowManager.waitUntilReadyToShow(opts, () async { ... })`:
   if `maximized` → call `maximize()`; else if `bounds` valid →
   `setBounds(...)`. Then `show()`.
2. Add new `WindowListener` overrides on `_DexAppState`:
   - `onWindowResize` / `onWindowMove` → save current `getBounds()`
     under `prefsKeyWindowBounds` (debounce with a 300ms `Timer`
     so we don't write on every drag tick).
   - `onWindowMaximize` → set `prefsKeyWindowMaximized = true`.
   - `onWindowUnmaximize` → set `prefsKeyWindowMaximized = false`.

Acceptance: maximize the window, X to tray, re-launch via tray →
window restores maximized; do the same with a custom size +
position → restores there too.

## Commit 2 — refractive edges + animated fog + spotlight upgrade

### 2a. `RefractiveEdge` helper
New widget `app/lib/widgets/refractive_edge.dart`:
```dart
class RefractiveEdge extends StatelessWidget {
  const RefractiveEdge({
    required this.child,
    required this.radius,
    this.thickness = 1.0,
    this.intensity = 1.0,   // multiplies the alpha of the rim
  });
  ...
}
```
Implementation uses the double-container trick — outer container
fills with a `LinearGradient` from top-left bright white-alpha
(`Color.fromRGBO(255, 255, 255, 0.18 * intensity)`) → mid faint
sky-blue (`Color.fromRGBO(0x4F, 0x8C, 0xFF, 0.10 * intensity)`) →
bottom-right shadow (`Color.fromRGBO(0, 0, 0, 0.05)`), 1px padding,
inner ClipRRect with the surface. The outer gradient reads as a
rim catching the bg's blue glow.

Wrap with it:
- `composer/dex_composer.dart` outer container
- `home/home_card.dart` card
- `glossy_menu.dart` card
- `dialog/permission_dialog.dart` and `settings/settings_dialog.dart`
  card containers
- `voice/voice_settings_panel.dart` + `vision/vision_panel.dart`
- `dex_sidebar.dart` outer AnimatedContainer
- `action_preview_card.dart` outer container (keep amber border,
  apply refractive edge INSIDE it)

### 2b. Animated fog + keystroke pulse
New widget `app/lib/widgets/living_background.dart` wraps the
HomeDesktop body with a `Stack`:
- Bottom layer: an `AnimatedBuilder` driven by a long
  `AnimationController(duration: 14s)` repeating. Each frame
  computes a `RadialGradient` whose `center` oscillates around
  `Alignment(0, 1.3)` with a 0.08 horizontal swing and 0.04
  vertical:
  ```dart
  center: Alignment(
    sin(t * 2 * pi) * 0.08,
    1.30 + cos(t * 2 * pi * 0.7) * 0.04,
  )
  ```
- The same controller drives a small `pulse(intensity)` boost:
  bumps the gradient amplitude for 600ms then decays. Hook the
  composer's `_ctrl.addListener` (TextEditingController) to call
  `LivingBackground.of(context).pulse(0.4)` each keystroke.

Expose via an `InheritedWidget` so child widgets (composer, chat
input, spotlight) can reach `LivingBackground.of(context)`.

Replace the static `gradient: DexSurface.bgGradient` in
`home_desktop.dart::DecoratedBox` with `LivingBackground(child: ...)`.

### 2c. Spotlight overlay polish
`spotlight_window.dart`:
- Position: `Alignment(0, -0.55)` → `Alignment(0, -0.80)` (the user
  asked for 25% higher).
- Wrap card in `RefractiveEdge(intensity: 1.6, thickness: 1.5)` for
  the stronger overlay-specific rim ("extended physics").
- Add a separate circular `+` button to the right of the input
  pill with 12px gap; it opens the same `AddMenu`/`GlossyMenu` for
  attachments. Card itself remains the search row + chips below.
  Wire to a placeholder for now ("attach coming in Commit 3 via
  rich paste").

### 2d. Voice mode redesign
`voice/voice_mode_screen.dart`:
- Wrap the whole `Scaffold` body in `LivingBackground` so the fog
  shows through.
- Replace the simple wave with a `RefractiveEdge`-wrapped
  glossy pill panel that holds the "I'm listening" label + the
  4-control row.
- Per-voice palette: pull from a new `voiceAccent(voice)` lookup
  table — Dune→amber, Mesa→clay, Sandstorm→pale gold,
  Canyon→deep amber, Oasis→teal-cyan, Arroyo→sky blue,
  Saguaro→desert green, Atlas→sky blue (Dex default). Tint the
  wave + central pulse with the voice's accent.

## Commit 3 — Reminders + rich paste + entry animations

### 3a. Reminders screen
New file `app/lib/screens/reminders_screen.dart` plus
`app/lib/core/models/reminder.dart`. Modal route via
`showGeneralDialog` with the existing `DexMotion.dialog` /
`DexMotion.dampened` transition. Two sections:
1. **Briefing tile** at the top (one-time, shown until dismissed
   via a small `× Got it` chip): one short paragraph explaining
   what Dex does (Windows-first personal AI desktop agent — drives
   apps, sees screen, finds files, acts as your calm cockpit) and
   why Reminders matter ("ask Dex to surface this later: 'remind
   me to open vtop at 4pm'"). Persisted dismiss via prefs key
   `dex.reminders.briefing.dismissed`.
2. **Upcoming** — `ListView` of pending reminders with title,
   relative time (`intl` package), cancel `✕`. Each row a glossy
   tile with `RefractiveEdge` for consistency.
3. **Add new** — a small input "Remind me to ..." + a tiny pill
   button "in 1h / tomorrow / pick a time". Pick-a-time opens a
   stock `showDatePicker`/`showTimePicker` (themed via
   `dialogTheme`).

State: a new `ConversationStore.reminders: List<Reminder>` field
(in-memory for now; persistence to `~/.dex/reminders.json` is a
follow-up). Add minimal `addReminder` / `cancelReminder` /
`reminders` methods.

Wire from `ProfileMenuAction.reminders` → `RemindersScreen.show`.

### 3b. Rich paste + drag-drop
Add packages:
- `super_clipboard: ^0.9.0` (Apache 2.0)
- `super_drag_and_drop: ^0.9.0` (Apache 2.0)

New file `app/lib/widgets/composer/attachments.dart`:
- `class AttachedItem { final String name; final IconData icon;
    final AttachmentKind kind; final Uri? fileUri; final Uint8List?
    imageBytes; }`
- `enum AttachmentKind { image, file, text }` (text shown
  as a "pasted text" chip for very long pastes).

In `dex_composer.dart`:
- Wrap the composer pill in `DropRegion` (`super_drag_and_drop`)
  that accepts `Formats.fileUri | Formats.image | Formats.plainText
  | Formats.uri | Formats.htmlText`. On drop, append
  `AttachedItem`s to a local `_attachments` list.
- Intercept Ctrl+V via a `Shortcuts`/`Actions` pair that calls
  `SystemClipboardReader.readerForSystemClipboard()`. If only text
  → fall through to default paste. If image / file → append to
  `_attachments`.
- Render a horizontal `Wrap` of `_AttachmentChip` widgets ABOVE
  the input row when `_attachments` is non-empty. Each chip: 2x2
  thumbnail (image) or file-type icon, name (ellipsised), ✕ remove.
- `onSubmit` passes both `text` and `attachments` through; extend
  `ConversationStore.sendHumanMessage(String, {List<AttachedItem>
  attachments = const []})` to forward to the gateway (initial
  drop: serialize attachments as URIs in the message body until
  the gateway has a real attachments protocol).

Repeat for `spotlight_window.dart`'s input — same DropRegion +
Ctrl+V + chip row. Pass attachments via the existing
`WindowMethodChannel('dex.spotlight').invokeMethod('sendPrompt', …)`
extended payload `{text: String, attachments: List<{...}>}`.

### 3c. Entry animations
- Greeting in `home/empty_home.dart`: replace the current static
  `Text('Hi …')` with a `_Typewriter` widget that streams chars in
  over ~700ms using an AnimationController, then settles. Skip
  when `MediaQuery.disableAnimations` is true.
- Existing `_FadeInUp` stagger on the column stays; just slightly
  later index offsets so the typewriter has room to finish first.
- Sidebar: wrap in a `SlideTransition(begin: (-1,0), end: (0,0),
  duration: 360ms, curve: DexMotion.dampened)` controlled by a
  one-shot on mount.

## Critical files

```
NEW
  app/lib/widgets/refractive_edge.dart          (2a)
  app/lib/widgets/living_background.dart        (2b)
  app/lib/screens/reminders_screen.dart         (3a)
  app/lib/core/models/reminder.dart             (3a)
  app/lib/widgets/composer/attachments.dart     (3b)

EDIT (Commit 1)
  app/lib/widgets/glossy_menu.dart              (1a — Rect-based positioning)
  app/lib/widgets/composer/dex_composer.dart    (1a + 1d)
  app/lib/widgets/glossy_dropdown.dart          (1a)
  app/lib/widgets/profile/profile_menu.dart     (1a)
  app/lib/screens/home_desktop.dart             (1c)
  app/lib/theme/theme.dart                      (1d)
  app/lib/widgets/home/recent_files_card.dart   (1d)
  app/lib/widgets/home/recent_chats_card.dart   (1d)
  app/lib/widgets/dex_sidebar.dart              (1d)
  app/lib/widgets/chat/message_actions_row.dart (1d)
  app/lib/widgets/voice/voice_mode_screen.dart  (1d)
  app/lib/platform/win/tray.dart                (1f — prefs keys)
  app/lib/main.dart                             (1f — restore + listeners)
  dex/core/src/entry.ts                         (1b)
  dex/core/src/index.ts                         (1b)
  dex/core/src/cli/run-main.ts                  (1b)
  dex/core/ui/public/sw.js                      (1b)
  dex/core/ui/package.json                      (1b)
  .gitignore                                    (1e)

EDIT (Commit 2)
  app/lib/widgets/composer/dex_composer.dart    (2a wrap)
  app/lib/widgets/home/home_card.dart           (2a wrap)
  app/lib/widgets/glossy_menu.dart              (2a wrap)
  app/lib/widgets/dialog/permission_dialog.dart (2a wrap)
  app/lib/widgets/settings/settings_dialog.dart (2a wrap)
  app/lib/widgets/voice/voice_settings_panel.dart (2a + 2d)
  app/lib/widgets/vision/vision_panel.dart      (2a)
  app/lib/widgets/dex_sidebar.dart              (2a)
  app/lib/widgets/action_preview_card.dart      (2a)
  app/lib/screens/home_desktop.dart             (2b — wrap with LivingBackground)
  app/lib/spotlight_window.dart                 (2c — position + + button + refraction)
  app/lib/widgets/voice/voice_mode_screen.dart  (2d)

EDIT (Commit 3)
  app/pubspec.yaml                              (3b — add super_clipboard, super_drag_and_drop)
  app/lib/core/state/conversation_store.dart    (3a + 3b)
  app/lib/widgets/composer/dex_composer.dart    (3b — DropRegion + paste + chips)
  app/lib/spotlight_window.dart                 (3b — same on overlay)
  app/lib/widgets/home/empty_home.dart          (3c — typewriter greeting)
  app/lib/widgets/dex_sidebar.dart              (3c — slide-in entry)
```

## Verification

After each commit:
1. `cd app && flutter analyze` — should be clean on touched files.
2. `cd app && flutter test` — 11/11 passing (the live-panel test
   debt from earlier sessions is acknowledged stale, ignore).
3. `cd app && flutter build windows --debug` — green.

Commit 1 smoke tests:
- Open chat with messages; click Smart pill → menu renders fully
  in view, no clipping. Same with `+`. Resize window narrow → menus
  switch to drop-down direction when needed.
- Launch `dexagent` in Windows Terminal → tab title reads
  "Dex", not "openclaw" (requires `pnpm build && npm install -g .`
  in `dex/core/` after the dex-core edits land).
- Sidebar avatar → Memory → Settings opens directly on the Memory
  tab.
- Hover every button surface; cursor switches to pointer.
- Maximize Dex, close to tray, re-summon via tray → reopens
  maximized.

Commit 2 smoke tests:
- Every glossy surface has a visible rim-light at the top-left,
  brighter than the previous flat-white edge.
- Background gradient drifts subtly over ~14s; typing in the
  composer briefly pulses the fog brighter.
- Spotlight panel sits visibly higher than before; the `+` circle
  hovers to its right; stronger rim treatment than the in-app
  glossy surfaces.

Commit 3 smoke tests:
- Avatar → Reminders opens the screen with a briefing tile +
  empty state. Add "remind me to ..." entry and verify it shows
  in Upcoming with the correct relative time.
- Ctrl+V an image from web into the composer → image chip
  appears above the input. Same with dragging a `.exe` from
  File Explorer; chip shows file-type icon + filename. Submit;
  chips clear.
- Open the app fresh → greeting types in char-by-char, sidebar
  slides in from the left, suggestion chips ripple in below.

---

# Phase L — Dex-native operator identity (the QUALITY re-architecture, 2026-06-14)

## Context

Live `dex chat` on the free Gemini Flash brain exposed the real problem —
and it is NOT the engines (they resolve fine; the tool list shows
`run_desktop_task` + `run_browser_task`). Dex inherited OpenClaw's
**companion pet-AI identity architecture**, which is fundamentally wrong
for an autonomous PC operator. Observed:
- Every turn the agent runs a persona quiz — "who am I, what name, what
  creature, what vibe, what signature emoji" — instead of working.
- It refuses to install a C compiler ("I can't download executables, I'm
  limited to my workspace") and only opens Notepad; never finishes tasks.
- It doesn't know it's Dex.

Root cause, traced in the code:
- The agent workspace `~/.dex/workspace/` is seeded with OpenClaw's
  companion files: `BOOTSTRAP.md` (the blank-slate persona ritual at
  `docs/reference/templates/BOOTSTRAP.md` — literally "figure out your
  name/creature/vibe/emoji, write IDENTITY.md, delete BOOTSTRAP.md"),
  plus `SOUL.md`, `HEARTBEAT.md`, group-chat/reaction etiquette, and an
  `AGENTS.md` that frames the agent as a cautious, workspace-scoped
  companion ("ask before anything leaves the machine").
- While `BOOTSTRAP.md` exists, `src/agents/bootstrap-prompt.ts` injects
  "follow BOOTSTRAP.md before replying normally" which OVERRIDES the
  appended Dex identity block (`DEX_IDENTITY_AND_AUTONOMY` in
  embedded-agent-runner/run/attempt.ts). A weak model loops on the
  ritual and never completes it → the quiz repeats forever.
- The companion framing is also why it thinks it's sandboxed and refuses
  to install tools, and it bloats the prompt (slower, less focused —
  worse on a weak free model).

Decision (Chethan, 2026-06-14): **stay on free Gemini Flash now; switch
to a frontier model once the product is finished.** So the prompt
architecture must make a WEAK model behave — which means REMOVING
conflicting/companion instructions, not stacking more hints on top.

Goal: replace OpenClaw's companion-bot identity layer with a fixed,
capability-forward, lean **Dex operator** identity. No persona quiz.
Autonomous by default — installs tools (winget), elevates (UAC), launches
apps, finishes A-to-Z. Leaner prompt = faster + sharper on flash. Name is
**Dex** (Atlas is an internal orchestrator name only; the agent is Dex).

## Approach

### L.1 — Kill the persona-bootstrap ritual; fixed Dex identity
- Stop seeding `BOOTSTRAP.md` into new Dex workspaces (`src/wizard/
  setup.finalize.ts`, and any app-side seed). Dex is not a blank slate.
- Ship Dex-native workspace seed files (new templates) instead of the
  OpenClaw companion ones:
  - `IDENTITY.md` — fixed: "You are Dex, an autonomous operator of the
    user's Windows PC." No creature/vibe/emoji.
  - `AGENTS.md` — lean operator rules (L.2 content), replacing the
    companion AGENTS.default (drop heartbeat/group-chat/reaction/SOUL).
  - No `BOOTSTRAP.md`; no `SOUL.md`/`HEARTBEAT.md` (or trimmed).
- Gate bootstrap OFF for the Dex prompt surface (belt-and-suspenders
  beyond "no BOOTSTRAP.md present"): `attempt-bootstrap-routing.ts` /
  `bootstrap-prompt.ts`.
- Heal EXISTING installs: a `dex doctor --fix` migration (and/or DexSetup
  first-boot) removes `~/.dex/workspace/BOOTSTRAP.md` + the stale
  half-written `IDENTITY.md` and writes the Dex seeds. (Immediate manual
  unblock for Chethan today: delete `~/.dex/workspace/BOOTSTRAP.md` — that
  alone stops the quiz and lets the already-shipped identity/autonomy
  block take effect.)

### L.2 — Capability-forward operator identity (the core framing)
Promote the `DEX_IDENTITY_AND_AUTONOMY` block (already added to
attempt.ts) to the canonical PRIMARY Dex identity — now unopposed by
BOOTSTRAP. It states: you are Dex; you operate the user's real Windows PC
via a PowerShell `exec` shell + UFO²/browser engines; install tools with
winget, elevate via `Start-Process -Verb RunAs` (UAC = the user's
confirmation), launch apps (Store apps via URI / Get-StartApps); finish
end-to-end; never run a persona quiz; never hand over manual setup you can
do; ask only for genuinely-user choices. This replaces the cautious
companion framing for Dex sessions.

### L.3 — Trim the companion cruft (speed + focus)
Dex's prompt surface drops the OpenClaw companion sections that don't
apply to a single-user PC agent — heartbeat etiquette, group-chat "know
when to speak", emoji reactions, SOUL/persona. Use the `promptSurface` /
`promptMode` seam in `src/agents/system-prompt.ts` (a Dex surface, or
exclude those sections). Net: fewer tokens → faster first token, weak
model stays on task.

### L.4 — Speed + the model-swap seam
- Brain stays `gemini-2.5-flash` for now (Chethan's call).
- Fast-mode routing for simple turns (partly built) + sane timeouts.
- Keep the model behind the single `agents.defaults.model.primary` config
  key so the later frontier-model switch is one change.

### L.5 — Structural + tested (not appended hints)
Bake into the build + workspace seed. Smoke (fresh workspace, flash
brain): "open whatsapp" → launches via URI; "write a C program for the
nearest prime and run it" → winget-installs clang, compiles, runs; agent
calls itself Dex; ZERO persona quiz; ZERO "I can't / install it yourself"
refusals.

## Critical files
- `src/wizard/setup.finalize.ts` — stop seeding BOOTSTRAP.md; seed Dex
  IDENTITY.md/AGENTS.md.
- `src/agents/bootstrap-prompt.ts`, `src/agents/embedded-agent-runner/
  run/attempt-bootstrap-routing.ts` — gate bootstrap off for Dex.
- `src/agents/embedded-agent-runner/run/attempt.ts` — promote
  DEX_IDENTITY_AND_AUTONOMY to the canonical/primary identity.
- `src/agents/system-prompt.ts` (+ promptSurface) — trim companion
  sections for the Dex surface.
- New Dex workspace seed templates — `IDENTITY.md`, `AGENTS.md` (lean
  operator). Replaces use of `docs/reference/templates/BOOTSTRAP.md` +
  `AGENTS.default.md` for Dex.
- `app/lib/core/dex_setup.dart` + a doctor migration — heal existing
  `~/.dex/workspace` (remove BOOTSTRAP.md, write Dex seeds).

## Verification
1. Clean `~/.dex/workspace` (remove BOOTSTRAP.md), rebuild dex-core,
   relaunch `dex chat`.
2. Agent opens by acting as Dex — no name/creature/emoji quiz.
3. "open whatsapp" → launches. "write + run a C program" on a machine
   with no gcc → it winget-installs a compiler and runs the program,
   asking for nothing it can do itself.
4. No regression: engines still resolve (`dex engines status` both
   ready); Flutter app + gateway path unaffected.

---

# Phase M — macOS-Spotlight UI language + integration correctness (2026-06-16)

## Context

Round 3 of UI polish plus a contained dex/core correctness pass. Chethan's
asks, distilled:

1. **Overlay = real macOS Spotlight** (reference image: a rounded search
   pill + a row of CIRCULAR liquid-glass icon badges to its right, all
   jelly). The current overlay is a flat clear pill + one + circle — wrong
   shape.
2. **Composer toolbar (`+`, vision, voice, send) = the same circular glass
   badges**, with **jelly** press physics and a **glow on send/tap**. The
   mode pill stays the clear-glass text pill it is now.
3. **Dex Vision panel + Voice control bar = the same pill/badge language.**
4. **Voice settings panel** (image1.png) is cramped against the screen edge,
   chips/dropdown clipped — fix the layout.
5. **Home "scroll still exists"** — empty-home must not scroll on his
   display. Prior height-gating didn't fix it.
6. **Redesign the 2 home cards** (recent files / recent chats) as real
   liquid glass.
7. **Sign in / sign up** — visual redesign to the unified glass language
   (local-only flow kept).
8. **Connectors search shows 2 × marks** — the package's built-in inner
   clear (`clear_circled_solid`) AND my split cancel button. Remove the
   inner one; keep only the split cancel, with a **clean X glyph (not a
   circled X)**.
9. **dex/core integration correctness** (locked scope — no MSI this round):
   - Bundled channels fail to load (`missing generated module for bundled
     channel discord/feishu/telegram/imessage`) → **fix so all channels
     load**, then **enable channel plugins by default** so the user just
     *pairs in-app* instead of running CLI commands.
   - **"Connected" must mean actually paired/linked, not plugin-enabled** —
     today WhatsApp shows Connected merely because its plugin entry exists
     (`plugins.entries.whatsapp` probe). Enabling-all would make every
     channel falsely show Connected, so this MUST land with enable-all.
   - **Windows-safe gateway restart** — `dex gateway restart` calls
     `process.kill(pid,'SIGUSR1')` → `ERR_UNKNOWN_SIGNAL` on Windows;
     restart always fails (confirmed live this session).
   - **Surface LLM/quota errors clearly** in the app instead of a bare
     "LLM request failed".
10. **Onboarding WhatsApp** jumps straight to QR with no explanation — show
    the `whatsapp.md` guide (already exists) like discord/voice-call, AND
    keep the in-app QR pair.

Decisions locked via AskUserQuestion: enable-all = fix-then-enable + in-app
pair; core scope = integration correctness only (no MSI); auth = visual
redesign, local-only.

## Design language (one shared vocabulary)

Reference = macOS Tahoe Spotlight: a frosted **search pill** and, to its
right, **circular liquid-glass icon badges** (own layer, jelly squash/stretch
on press, faint rim). Everything "actiony + round" in Dex becomes this badge;
the **mode pill** stays the rounded clear-glass text pill.

- New shared widget `app/lib/widgets/glass_badge_button.dart` —
  `GlassBadgeButton({icon, onTap, tooltip, glowColor, size=44})` wrapping the
  package `GlassIconButton` (already ships squash/stretch jelly + `glowColor`)
  at `GlassQuality.premium` with a clear-crystal `LiquidGlassSettings` tuned
  to the reference badge. Feeds the overlay badges, composer toolbar, and the
  vision/voice control bars. Replaces the ad-hoc `_GlassToolButton`
  GlassContainer (no jelly — exactly Chethan's "voice/send have no jelly").

## Phases

- **M.1 Spotlight overlay** (`spotlight_window.dart`): row = search pill +
  12px gap + a row of `GlassBadgeButton`s (Attach/Paste/actions). Drop the
  single flat + circle. Keep history/paste/IPC.
- **M.2 Composer toolbar** (`widgets/composer/dex_composer.dart`):
  +/vision/voice → `GlassBadgeButton`; send → `GlassBadgeButton` with
  `glowColor: accent` (glow on tap); busy→stop is the same badge tinted
  error. Mode pill unchanged. Delete `_GlassToolButton`.
- **M.3 Vision + Voice control bars** (`vision_panel.dart`,
  `voice_mode_screen.dart`): controls → `GlassBadgeButton` (jelly), accent
  glow on active mic.
- **M.4 Voice settings panel** (`voice_settings_panel.dart` + its placement
  in `voice_mode_screen.dart`): reposition fully on-screen (Align + SafeArea
  + max width, not pinned to the edge), widen the voice-chip `Wrap` so chips
  don't clip, keep the language dropdown in-bounds.
- **M.5 Home no-scroll + glass cards** (`empty_home.dart`, `home_card.dart`,
  `recent_files_card.dart`, `recent_chats_card.dart`): hero
  (greeting/composer/chips) in a **non-scrolling centered Column**; recent
  cards render in leftover space via `LayoutBuilder` only when there's room
  — never a scroll view for the hero. Redesign card inner rows as small glass
  tiles + lighter card tint.
- **M.6 Sign in / sign up** (`login_screen.dart`): replace `_PlainField`
  (flat) with a shared glass field matching `SecretField`/onboarding; unify
  spacing/typography. Extract `widgets/glass_text_field.dart` so login +
  onboarding + memory-add share one field (same design everywhere).
  Local-only `DexAccount` flow kept.
- **M.7 Single clean X** — patch vendored
  `liquid_glass_widgets-main/lib/widgets/input/glass_search_bar.dart`: add
  `showsClearButton` (default true) gating the inner suffix clear (mark
  `[LOCAL PATCH]`). `connectors_tab.dart` `_SearchField`:
  `showsClearButton:false` + `cancelIcon: Icon(LucideIcons.x)`.
- **M.8 Onboarding WhatsApp guide** (`onboarding_screen.dart`): route
  WhatsApp through `_showConnectSheet` (shows the existing `whatsapp.md`
  guide) and add a "Pair now (scan QR)" action opening `WhatsAppPairDialog`.
- **M.9 Connector status = paired, not enabled** (`app/lib/core/connectors.dart`):
  drop `plugins.entries.<id>` from **channel** probePaths (keep for
  providers). A channel is `connected` only when `channels.<id>` carries a
  real linked/paired marker. Needs the gateway to expose a per-channel
  **linked** signal — investigate the `channels.<id>` shape in `config.get`
  / any `channels.status` RPC; if absent, add a generic `linked` boolean to
  the channel status dex/core already computes, consumed by the Flutter probe
  + onboarding "linked" check.
- **M.10 dex/core channels load + enabled-by-default**
  (`dex/core/src/channels/plugins/bundled.ts` + config defaults): the dist
  files (`dist/extensions/<id>/{index.js,setup-entry.js,openclaw.plugin.json}`)
  exist, but `resolveBundledChannelGeneratedPath` returns null in the global/
  MSI install — trace path/scanDir/packageRoot resolution under `npm i -g`
  and fix so setup entries resolve (acceptance: **zero** "missing generated
  module" warnings). Then enable channel entries by default per dex/core
  config-default policy (+ `doctor --fix` migration if the default shape
  changes). Enabled ≠ connected (M.9).
- **M.11 Windows-safe restart** (`dex/core/src/cli/daemon-cli/lifecycle.ts:253`):
  on `win32`, replace the SIGUSR1 in-process reload with kill (SIGTERM/
  taskkill) + managed respawn. Acceptance: `dex gateway restart` exits 0 on
  Windows; also unblocks Diagnostics restart (task #126).
- **M.12 Surface LLM/quota errors** (`conversation_store.dart`): on turn
  failure show the gateway's real error class/message; for quota/rate-limit
  add a hint to switch model or add a Groq key.

## Critical files

```
NEW   app/lib/widgets/glass_badge_button.dart
NEW   app/lib/widgets/glass_text_field.dart           (M.6 shared plain glass field)
EDIT  app/lib/spotlight_window.dart                   (M.1)
EDIT  app/lib/widgets/composer/dex_composer.dart      (M.2)
EDIT  app/lib/widgets/vision/vision_panel.dart        (M.3)
EDIT  app/lib/widgets/voice/voice_mode_screen.dart    (M.3)
EDIT  app/lib/widgets/voice/voice_settings_panel.dart (M.4)
EDIT  app/lib/widgets/home/empty_home.dart            (M.5)
EDIT  app/lib/widgets/home/recent_files_card.dart     (M.5)
EDIT  app/lib/widgets/home/recent_chats_card.dart     (M.5)
EDIT  app/lib/widgets/home/home_card.dart             (M.5)
EDIT  app/lib/screens/login_screen.dart               (M.6)
EDIT  liquid_glass_widgets-main/lib/widgets/input/glass_search_bar.dart (M.7)
EDIT  app/lib/widgets/settings/tabs/connectors_tab.dart (M.7)
EDIT  app/lib/screens/onboarding_screen.dart          (M.8)
EDIT  app/lib/core/connectors.dart                    (M.9)
EDIT  dex/core/src/channels/plugins/bundled.ts        (M.10)
EDIT  dex/core (channel config defaults + doctor migration) (M.10)
EDIT  dex/core/src/cli/daemon-cli/lifecycle.ts        (M.11)
EDIT  app/lib/core/state/conversation_store.dart      (M.12)
```

## Verification

- Flutter: `cd app; flutter analyze <touched>` clean; `flutter build windows
  --debug` green. Visual: overlay reads as macOS Spotlight (pill + jelly
  badges); +/vision/voice/send are jelly badges, send glows on tap; home
  doesn't scroll and cards read as glass; login matches onboarding;
  Connectors search shows ONE clean X (split-cancel only); voice settings
  panel fully on-screen.
- dex/core: `cd dex/core; pnpm build`; restart gateway → **zero** "missing
  generated module" warnings; `dex gateway restart` exits 0 on Windows; a
  freshly-enabled-but-unpaired channel shows **Connect** (not Connected);
  WhatsApp shows Connected only after QR pair; chat reply streams; a forced
  quota error shows a clear message. Targeted tests for touched dex/core
  surfaces (`pnpm test src/channels`, daemon lifecycle) per dex/core
  CLAUDE.md.

## Phase M — progress log

- [ ] M.1 Spotlight overlay = pill + jelly badge row
- [ ] M.2 Composer toolbar badges (jelly) + send glow
- [ ] M.3 Vision panel + voice control bar badges
- [ ] M.4 Voice settings panel on-screen + un-clipped
- [ ] M.5 Home no-scroll hero + glass recent cards
- [ ] M.6 Login/sign-up glass redesign (unified field)
- [ ] M.7 GlassSearchBar `showsClearButton`; connectors single clean X
- [ ] M.8 Onboarding WhatsApp guide + in-app QR
- [ ] M.9 Connector status = paired, not enabled
- [ ] M.10 dex/core bundled channels load + enabled by default
- [ ] M.11 dex/core Windows-safe gateway restart
- [ ] M.12 Flutter surfaces real LLM/quota errors

---

# Phase N — Make Dex actually DO tasks (quality pass, 2026-06-19)

## Honest root-cause split (Chethan's fed-up session)

The symptoms ("open website → it summarized instead", "open in vivaldi →
'what would you like to open?'", "yes → re-asked", "opened Notepad but
didn't type the code", "open settings doesn't work") are TWO causes, not
one. Naming them stops us chasing ghosts:

1. **Real dex/core behavior bugs (FIXED this session, in the autonomy
   block; needs gateway restart on the rebuilt dist):**
   - OPEN != FETCH: "open <site>" now means LAUNCH in a browser
     (`Start-Process <url>` / `Start-Process vivaldi <url>`), NOT
     web_fetch/summarize. (was: agent dumped the VIT homepage text)
   - CARRY CONTEXT: resolve "open in vivaldi" / "yes" from prior turns;
     never re-ask "what would you like to open?".
   - SCRIPT-FIRST: write a file/script and run it (Set-Content + open)
     instead of char-typing into a GUI via UFO² (which times out — the
     Notepad failure).
   - PLAN VISIBLY: call `update_plan` first; Flutter now renders the
     step checklist (TaskPlanCard) pinned above the composer.
   - elevated exec enabled for the desktop (webchat provider) so admin
     tasks (DNS/services/installs) run instead of handing manual steps.

2. **Model capability + quota (NOT a code bug — the dominant factor):**
   `gemini-flash-latest` is Google's CHEAP/FAST tier, not a pro model.
   For an autonomous operator (multi-step tool use, following operator
   rules, not re-asking, web automation) it is the weakest viable choice
   AND its free daily quota is tiny — which is why turns die with
   "rate-limited". No prompt/routing change fixes a model that ignores
   context or runs out of quota mid-task. **The single biggest lever for
   "high-quality product" is a capable brain model.**

## UFO² absorption — answered

We did NOT fork UFO²'s source into dex/core; it runs as an external engine
from `~/.dex/engines/UFO` via the windows-desktop-control MCP driver
(Phase K wired it as a built-in engine). `dex engines status` → ready.
"open settings stopped working" is NOT a broken absorption — it's the
agent not ROUTING to run_desktop_task (tool choice = model/preflight) or
the model/quota dying. Re-cloning UFO would change nothing. The fix is
routing (N.2) + a capable model (N.1), not re-absorption. (If a future
`dex engines status` shows UFO not-ready, THEN rebuild its venv via
`dex engines setup`.)

## N.1 — Model strategy (do FIRST; highest leverage)
- Brain: move off free Gemini Flash for real work. Options, by quality:
  Claude Sonnet (paid, best operator behavior) > GPT-5-class > Gemini 2.5
  Pro (low free quota) >> Flash. Surface a clear picker in Settings →
  Brain with this guidance; default new installs to the most capable key
  the user provides.
- Hands quota separation: `DexSetup.applyGroqKey` already moves UFO² +
  browser-use onto a free Groq key so their calls don't burn the brain's
  quota. Make onboarding offer this in one tap.
- Surface live quota state in the app (not just the chat error) so the
  user knows WHICH key is exhausted and can switch.

## N.2 — Deterministic routing (harden beyond the prompt)
- In `orchestration/preflight.ts`, classify the user intent before the LLM
  picks: "open <url/domain>" → browser-open (Start-Process), "open
  <app/Settings>" → desktop launch / run_desktop_task, "read/extract/
  summarize <url>" → web_fetch. Inject a strong hint (and, for the obvious
  cases, narrow the offered tools) so a weak model can't pick web_fetch
  for a plain "open".
- Smoke: "open vtop.vit.ac.in in vivaldi" → Vivaldi opens at the URL, no
  summary, no re-ask. "open wifi settings" → run_desktop_task (UIA) opens
  the Settings page.

## N.3 — Memory / context (verify, then fix if real)
- Confirm the gateway includes prior turns for the dex-desktop session in
  the model prompt (constant sessionKey → server session history). If
  history IS sent and the model still re-asks, it's model weakness (N.1).
  If history is NOT sent, fix the session-history inclusion in the
  embedded run prompt assembly.
- Add a short "recent turns" recap to the system context as a cheap
  safety net for weak models.

## N.4 — Web task automation (the assignment / LeetCode goal)
- "go to leetcode.com, solve problem 79 in MY account": needs browser-use
  driving the user's LOGGED-IN browser profile (not a fresh Playwright
  profile) — `profile: "user"` on the built-in browser tool, or point
  browser-use at the user's Chromium profile dir. Then: navigate → detect
  the editor → type the solution via the page (not GUI char-typing) →
  run/submit. This is multi-step and REQUIRES a capable model (N.1).
- Acceptance: from one prompt, Dex opens the problem in the user's browser,
  writes a correct solution into the editor, submits, and reports the
  verdict — with the plan checklist ticking through the steps.

## N.5 — Verify the autonomy fixes live (after gateway restart)
- Restart gateway (rebuilt dist). Re-run the failing prompts:
  "write a C program in notepad" (script-first: writes hello.c + opens),
  "open vtop in vivaldi" (opens, no summary), "set DNS to 1.1.1.1"
  (elevated exec + UAC). Each should show the plan checklist.

## Phase N — progress log
- [x] N.0 dex/core autonomy block: open!=fetch, carry-context, script-first,
      plan-visibly, elevated — compiled (exit 0); needs gateway restart
- [x] N.0 Flutter live plan checklist (PlanStep + TaskPlanCard) shipped
- [x] N.0 removed stale empty dex/vendor dir
- [ ] N.1 model strategy: capable-brain picker + one-tap Groq-for-hands +
      live quota surfacing
- [ ] N.2 deterministic open/app/read routing in preflight
- [ ] N.3 verify + harden session-history inclusion
- [ ] N.4 browser-use on the user's logged-in profile for web tasks
- [ ] N.5 live re-verification of the autonomy fixes after restart
