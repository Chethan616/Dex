# Dex

A calm cockpit for commanding agents you can trust.

Dex is a Windows-first, chat-first control surface for a local AI agent that has *hands* on your machine — it can drive real Windows app GUIs (Office, browsers, settings panels, anything with a UI) by reasoning about what you asked for and previewing every action before it runs.

> **v1 is desktop Windows only.** Mobile, macOS, and Linux are in the roadmap but not built. See `prompt.md` §9 for the scope boundary.

---

## Architecture

```
Flutter app (Dex)
   │  HTTP + WebSocket on 127.0.0.1:18789
   ▼
OpenClaw (Node 24)              ← the brain · Anthropic Claude
   │  MCP stdio
   ▼
windows-desktop-control MCP     ← the glue · Python 3.10 · this repo
   │
   ▼
Microsoft UFO² (Python 3.10)    ← the hands · Groq Qwen 3 (default)
   │
   ▼
Picture-in-Picture desktop      ← isolated; does not steal your focus
```

- **OpenClaw** (`vendor/openclaw/`) — sessions, channels, skills, memory, cron.
- **UFO²** (`vendor/UFO/`) — Windows GUI automation in an isolated virtual desktop.
- **windows-desktop-control** (`glue/`) — a small MCP server that exposes UFO²'s "do this in the GUI" capability to OpenClaw as one tool: `run_desktop_task(goal, app_hint, engine, dry_run, timeout_s)`.
- **app/** — the Flutter client. Talks to OpenClaw's local gateway. Implements `design.md`.

---

## Quick start

> See [`PLAN.md`](./PLAN.md) for the full phased build plan and current progress.

```powershell
# 1. one-time prereq check
.\scripts\setup-windows.ps1

# 2. when all phases are done
.\scripts\run-dev.ps1   # starts gateway + MCP server + Flutter app
```

Requirements:
- Windows 10 / 11
- Node 24 (or Node 22.19+)
- Python 3.10
- Flutter SDK with Windows desktop target enabled
- Anthropic API key (OpenClaw)
- Groq API key (UFO² default — Qwen 3, free)

---

## Repo layout

```
D:\project1\
├── README.md                  this file
├── PLAN.md                    live progress tracker — read this first when resuming
├── LICENSES.md                third-party license audit
├── SECURITY.md                risk surface + isolation
├── design.md                  UI/UX spec — single source of design truth
├── prompt.md                  build contract — assistant rules of engagement
├── vendor/
│   ├── openclaw/              pinned commit, do not modify
│   └── UFO/                   pinned commit, do not modify
├── glue/
│   └── windows-desktop-control/
│       ├── server.py          FastMCP server (<200 lines)
│       ├── requirements.txt
│       └── SKILL.md           OpenClaw skill teaching the agent when to call this
├── app/                       Flutter desktop client (com.chethan616.dex)
└── scripts/                   PowerShell helpers
```

---

## Pinned vendor commits

Recorded so builds are reproducible. Update only when intentionally bumping.

| Vendor | Commit | Date pinned |
|---|---|---|
| `openclaw/openclaw` | `7074cf8e23c1f64362c4f8c4bf32971ca94d5221` | 2026-06-03 |
| `microsoft/UFO`     | `adef15b8789b015356977ed742916de2da644509` | 2026-05-26 |

---

## License

Dex source in this repo is MIT. See `LICENSES.md` for the full third-party audit (vendored repos, Flutter deps, fonts). No AGPL components are bundled with the shipped product.
