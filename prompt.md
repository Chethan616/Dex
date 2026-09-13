# prompt.md — Build Spec for Claude Code

**Mission:** Assemble a lightweight, Windows-first personal AI assistant that I can chat with to control my Windows PC's apps and shell. Glue together existing open-source projects instead of building from scratch, then wrap them in a clean GUI. Mobile + macOS + Linux come later — **do not build them now.**

---

## 0. Ground rules (read this first, follow it the whole way)

1. **Do not hallucinate.** Before running or referencing anything from a cloned repo, READ that repo's actual `README`, `docs/`, and any quick-start. If this spec and the repo's real docs disagree, **the repo wins** — pause and tell me what changed.
2. **Never invent** commands, file paths, config keys, function names, or HTTP/WebSocket endpoints. If you don't know an exact name (e.g. OpenClaw's gateway API or UFO2's programmatic entrypoint), find it in the source/docs first. If you can't find it, stop and ask me.
3. **Work in phases.** After each phase, run its acceptance check and report results before moving on. Don't chain phases blindly.
4. **Stop at human steps.** Anything needing an API key, a login, a system permission, or a paid runtime install is mine to do. Mark it `🧑 HUMAN STEP`, give me exact instructions, and wait.
5. **Lightweight is a hard requirement.** Minimal dependencies. No Electron. No heavy frameworks where a small one works. Prefer the projects' own minimal install paths. Justify any new dependency.
6. **Two processes, one box.** The mental model: **OpenClaw (Node) = the brain**, **UFO2 (Python) = the hands**, glued by a tiny MCP server, with a **Flutter** app as the face. Keep these cleanly separated and independently testable.

---

## 1. Tech stack & source repos

| Role | Project | Repo | Runtime |
|---|---|---|---|
| Assistant brain (memory, skills, channels, cron) | OpenClaw | `https://github.com/openclaw/openclaw` | Node 24 |
| Windows GUI automation (the "hands") | Microsoft UFO2 | `https://github.com/microsoft/UFO` | Python 3.10 |
| Glue: expose UFO2 to OpenClaw | **(we build)** small MCP server + `SKILL.md` | — | Python 3.10 |
| GUI client (desktop now, Android later) | **(we build)** Flutter app | — | Flutter / Dart |

**Verify licenses before bundling anything for distribution** and write what you find into `LICENSES.md`. OpenClaw is expected MIT; confirm UFO's license on its repo. Do **not** bundle any AGPL-licensed dependency (e.g. Open Interpreter) into the shipped product — if we want it later it stays an optional, user-installed add-on.

---

## 2. Target repo layout to create

```
copilot-hands/
├── README.md
├── LICENSES.md
├── vendor/
│   ├── openclaw/            # git clone (do not modify; pin a commit)
│   └── UFO/                 # git clone (do not modify; pin a commit)
├── glue/
│   └── windows-desktop-control/
│       ├── server.py        # MCP server wrapping UFO2
│       ├── requirements.txt
│       └── SKILL.md         # OpenClaw skill that teaches the agent to call it
├── app/                     # Flutter client (desktop now)
└── scripts/
    ├── setup-windows.ps1    # idempotent dev setup helper
    └── run-dev.ps1          # starts gateway + MCP server for local dev
```

Pin each vendored repo to a specific commit hash and record it in `README.md` so builds are reproducible.

---

## 3. Prerequisites — `🧑 HUMAN STEP`

Confirm with me that these exist before Phase 0 (you may check versions, but I install them):
- Windows 10/11.
- **Node 24** (or Node 22 LTS ≥ 22.19 for compatibility).
- **Python 3.10** (UFO2 targets 3.10 specifically — do not assume a newer version works).
- **Flutter SDK** with Windows desktop support enabled (`flutter config --enable-windows-desktop`).
- An LLM API key (Anthropic or OpenAI). I will paste it into config myself — **never** write a key into a file you commit.

---

## 4. Phase 0 — OpenClaw running, driven from my phone

**Goal:** Prove the "brain" works before writing any code.

1. Clone OpenClaw into `vendor/openclaw`. Read its README/getting-started.
2. Guide me through its official onboarding (it has an `openclaw onboard` flow). `🧑 HUMAN STEP` for: pasting the API key, connecting a Telegram bot, scanning/authorizing any channel.
3. Note in `README.md` where its workspace, config, and **skills directory** live on Windows (find the real path from its docs — historically `~/.openclaw/workspace/skills/`; confirm, don't assume).

**Acceptance check:** I send a message from Telegram → OpenClaw replies and can read/write a test file in its sandbox. Report the exact skills-dir path you confirmed.

---

## 5. Phase 1a — UFO2 running standalone (the hands)

**Goal:** Confirm UFO2 can drive real Windows apps before gluing it in.

1. Clone Microsoft UFO into `vendor/UFO`. Read its README + docs site.
2. Set up its environment per its own instructions (Python 3.10, `pip install -r requirements.txt`, LLM config). `🧑 HUMAN STEP` for its LLM key.
3. Enable its **Picture-in-Picture / virtual-desktop** mode so automation runs isolated and doesn't steal my mouse/keyboard. Document how to toggle it.
4. Find and document UFO2's **programmatic entrypoint** — the function/CLI you can call to run a single natural-language task headlessly. **Read the source to get the real signature; do not guess it.**

**Acceptance check:** From a script you write, UFO2 completes a trivial task end-to-end (e.g. "open Notepad, type 'hello', save to Desktop\\test.txt") in the PiP desktop. Capture a log.

---

## 6. Phase 1b — glue UFO2 into OpenClaw (the core deliverable)

**Goal:** OpenClaw can now click real apps by calling UFO2 through a small MCP server.

### 6.1 Write the MCP server — `glue/windows-desktop-control/server.py`

Use the official MCP Python SDK (`pip install mcp`, FastMCP API). Keep it tiny. Skeleton — **adapt the UFO2 call to its real entrypoint from Phase 1a:**

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("windows-desktop-control")

@mcp.tool()
def run_desktop_task(goal: str, app_hint: str = "") -> str:
    """Automate a Windows GUI task described in natural language.
    Use ONLY for tasks that need a real app's GUI (Photoshop, Office,
    a browser UI, settings panels). For pure file/shell work, the agent
    should use its own shell tool instead.

    Args:
        goal: The task in plain language, e.g. "in Excel, sum column B".
        app_hint: Optional app to focus first, e.g. "Excel".
    Returns: a short status + result summary.
    """
    # TODO(Phase 1a): call UFO2's real headless entrypoint here.
    # Run inside the PiP/virtual desktop. Enforce a timeout.
    # Return a concise string the LLM can read (success/failure + what happened).
    raise NotImplementedError

if __name__ == "__main__":
    mcp.run()  # stdio transport by default
```

Requirements to add: `mcp`, plus whatever UFO2 needs (import from the vendored package; don't re-pin its deps differently). Add a hard **timeout** and a **dry-run / read-only flag** to the tool so I can test safely.

### 6.2 Register the server with OpenClaw

OpenClaw does **not** use a Claude-Desktop-style MCP config file. Use its bundled **`mcporter`** mechanism (its MCP client/manager) to register `windows-desktop-control`. Read OpenClaw's current skills/MCP docs for the exact registration step and follow it — report the command you used.

### 6.3 Write the skill — `glue/windows-desktop-control/SKILL.md`

An OpenClaw skill is a folder with a `SKILL.md` (YAML frontmatter + plain-English instructions). Author it so the agent knows *when* to reach for desktop control vs shell. Confirm the current frontmatter fields from OpenClaw's docs (names evolve); a first draft:

```markdown
---
name: windows-desktop-control
description: Control Windows app GUIs (click, type, automate) via UFO2.
---
# Windows Desktop Control
When the user asks to operate a Windows application's interface — Office,
Photoshop, a browser UI, system settings, anything that needs real clicks —
call the MCP tool `run_desktop_task` with a clear natural-language `goal`.

Rules:
- Prefer the agent's own shell/file tools for non-GUI work; only use this for GUI.
- Pass a one-sentence goal. Include an `app_hint` when the app is obvious.
- If the tool returns failure, summarize what happened; do NOT silently retry
  more than once.
- Treat this as powerful: never run destructive desktop actions without
  confirming with the user first.
```

Copy/symlink this skill folder into the confirmed OpenClaw skills directory, then refresh skills.

**Acceptance check:** From Telegram I say "open Calculator and compute 12 × 9" → OpenClaw routes to `run_desktop_task` → UFO2 does it in the PiP desktop → I get the result back in chat. Report the full trace.

---

## 7. Phase 1c — the Flutter GUI (the face)

**Goal:** Replace Telegram with a clean, lightweight desktop app that talks to the local OpenClaw gateway. (Implements `design.md` — follow it for layout, type, color.)

1. Scaffold a Flutter desktop app in `app/`. Windows desktop target only for now; keep the codebase mobile-ready (no desktop-only packages in shared widgets) so Android is a later target, not a rewrite.
2. Find OpenClaw's **local gateway interface** for clients (it exposes a control-plane API and a WebChat channel). **Inspect the source/docs for the real endpoint, auth, and message schema — do not invent them.** If there's no clean client API, build a minimal local adapter service (document why).
3. Implement the v1 screens from `design.md`: conversation thread, command bar, device/agent status, and the **Action Preview / approval** surface (show what the agent is about to do; one-tap approve/deny). Approval can be a no-op stub in v1 if the gateway doesn't yet emit pre-action events — wire the UI, mark the integration `TODO`.
4. Dependency budget: justify every package in `app/pubspec.yaml`. Prefer Flutter built-ins (implicit animations, `http`/`web_socket_channel`) over heavy state/UI libraries.

**Acceptance check:** The Flutter app sends a message to the local gateway and renders the streamed reply; the desktop-control flow from Phase 1b works through the app instead of Telegram.

---

## 8. Cross-cutting requirements

- **Security (not optional):** OpenClaw runs an LLM with shell access and now GUI control. Keep UFO2 in the PiP/virtual desktop, default the desktop-control tool to *ask-first*, never commit secrets, and add a `SECURITY.md` noting the risk surface and how isolation is configured.
- **Lightweight budget:** Flutter (no Electron); ≤ a handful of Dart packages; the MCP glue stays under ~200 lines; no model weights bundled — use the API key, with local-model (Ollama) support left as an optional config, not a dependency.
- **Reproducibility:** pin vendored commits; `scripts/setup-windows.ps1` should be idempotent; document every manual step in `README.md`.

## 9. Explicitly out of scope (later phases — do NOT start)

macOS device agent, Linux agent, Android app build, the cross-device relay (Tailscale + device registry), and UFO3/Galaxy multi-device orchestration. Leave clean seams for them, but build none of them now.

---

### Final instruction to the agent
Proceed phase by phase. After each acceptance check, summarize: what you ran, what you confirmed from real docs (with the doc link/path), any deviation from this spec, and the next `🧑 HUMAN STEP`. When in doubt, ask — do not guess.
