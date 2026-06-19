# Dex Agent — Tool Reference

This is the complete catalogue of tools the Dex agent (the `dexagent` brain,
forked from OpenClaw) can call. It is generated from the live tool catalog at
`dex/core/src/agents/tool-catalog.ts` plus the built-in automation engines wired
in by Phase K (`dex/core/src/engines/builtin-engines.ts`).

## How tools reach the model

Every turn, Dex builds the model's tool list from two layers:

1. **Core tools** — 36 first-party tools grouped into 11 sections (Files,
   Runtime, Web, Memory, Sessions, UI, Messaging, Automation, Nodes, Agents,
   Media). Which ones are exposed depends on the session's **tool profile**.
2. **Engine / MCP tools** — the desktop + browser + vision engines, resolved
   automatically (no `mcp.servers` config needed). These are the agent's
   "hands" on the real PC.

### Tool profiles

| Profile | Used by | Intent |
|---|---|---|
| `minimal` | lightweight sessions | only the safest read/announce tools |
| `coding` | **Dex desktop (default)** | full operator kit: files, exec, web, browser, message, media, sub-agents |
| `messaging` | channel sessions | chat + the `message` send tool |
| `full` | power/headless | everything |

Dex desktop chat runs the **`coding`** profile. Phase I added `message` +
`browser` to it so the agent can send through paired channels and drive the
user's own browser without falling back to GUI automation.

---

## Core tools (36)

### Files (`fs`)
| Tool | Does | Profiles |
|---|---|---|
| `read` | Read file contents | coding |
| `write` | Create or overwrite files | coding |
| `edit` | Make precise in-place edits | coding |
| `apply_patch` | Apply a unified-diff patch to files | coding |

### Runtime (`runtime`)
| Tool | Does | Profiles |
|---|---|---|
| `exec` | Run a shell command (PowerShell on Windows) — the primary "do something on the PC" tool | coding |
| `process` | Manage long-running / background processes | coding |
| `code_execution` | Run sandboxed remote analysis (Python data work) | coding |

### Web (`web`)
| Tool | Does | Profiles | Notes |
|---|---|---|---|
| `web_search` | Search the web | coding | needs a Gemini/provider key (uses the `google` provider) |
| `web_fetch` | Fetch + read a URL's content | coding | |
| `x_search` | Search X / Twitter posts | coding | |

### Memory (`memory`)
| Tool | Does | Profiles |
|---|---|---|
| `memory_search` | Semantic search over stored memory | coding |
| `memory_get` | Read memory files (`~/.dex/workspace/MEMORY.md`) | coding |

### Sessions (`sessions`) — sub-agent orchestration
| Tool | Does | Profiles |
|---|---|---|
| `sessions_list` | List active sessions | coding |
| `sessions_history` | Read a session's history | coding |
| `sessions_send` | Send a message into another session | coding |
| `sessions_spawn` | Spawn a new sub-agent session | coding |
| `sessions_yield` | End the turn to receive sub-agent results | coding |
| `subagents` | Manage sub-agents | coding |
| `session_status` | Report current session status | coding |

### UI (`ui`)
| Tool | Does | Profiles | Notes |
|---|---|---|---|
| `canvas` | Control node Canvas surfaces | — | only when the Canvas plugin is enabled |

### Messaging (`messaging`)
| Tool | Does | Profiles | Notes |
|---|---|---|---|
| `message` | Send text/files through a **paired** channel (WhatsApp, Telegram, Discord, Slack) | coding, messaging | one call instead of GUI-automating a messenger |

### Automation (`automation`)
| Tool | Does | Profiles | Notes |
|---|---|---|---|
| `cron` | Schedule recurring/future jobs | coding | powers "remind me / do X at 4pm" |
| `heartbeat_respond` | Record heartbeat outcomes | — | background/companion only |
| `gateway` | Gateway control | — | denied in Dex desktop sessions |

### Nodes (`nodes`)
| Tool | Does | Profiles | Notes |
|---|---|---|---|
| `nodes` | Manage nodes + paired devices | — | denied in Dex desktop sessions |

### Agents (`agents`) — goals + skills
| Tool | Does | Profiles |
|---|---|---|
| `get_goal` | Read the current thread goal | coding |
| `create_goal` | Create a thread goal | coding |
| `update_goal` | Complete or block a thread goal | coding |
| `update_plan` | Maintain a live step plan for the turn | coding |
| `skill_workshop` | Create/update/inspect/apply Skill Workshop proposals | coding |
| `agents_list` | List agents | — |

### Media (`media`)
| Tool | Does | Profiles | Notes |
|---|---|---|---|
| `image` | Image understanding (vision) | coding | |
| `image_generate` | Image generation | coding | provider-gated |
| `music_generate` | Music generation | coding | provider-gated |
| `video_generate` | Video generation | coding | provider-gated |
| `tts` | Text-to-speech | — | |

---

## Engine / MCP tools (the "hands")

These are resolved automatically by Phase K's built-in engine layer — no
`mcp.servers` entry required. Verify with `dex engines status`.

| Tool | Engine | Does | Status |
|---|---|---|---|
| `run_desktop_task` | **UFO²** (Windows UIA) | Drive native Win32 apps via the accessibility tree (Excel, Word, Settings, Calculator, file dialogs) | ready |
| `run_browser_task` | **browser-use** (Playwright) | Drive anything inside a web page — forms, clicks, extraction, multi-page flows. Uses the user's default browser (Vivaldi/Brave/Edge) via registry detection | ready |
| `parse_screen` | **OmniParser** (vision) | Parse a screenshot into `(bbox,label,type)` for pixel-only surfaces (games, custom-drawn UIs) | not installed (vision phase) |

### Routing (which hand for which task)

| Task shape | Tool |
|---|---|
| File read/write, CLI, `git`, `npm`, launching an app | `exec` (built-in shell) |
| Send a message/file via a paired channel | `message` |
| Native Win32 app interior | `run_desktop_task` (UFO²) |
| Anything inside a web page | `run_browser_task` (browser-use) |
| Pixel-only / no UIA / no DOM | `parse_screen` (OmniParser) |

The orchestrator (`dex/core/src/orchestration/`) scores these per task and
biases the agent's choice (Phase F preflight hint).

---

## Functional status (2026-06-19)

- ✅ **Files, Runtime (`exec`/`process`), Sessions, Memory, Agents/goals,
  `cron`, `message`** — functional.
- ✅ **`run_desktop_task`, `run_browser_task`** — engines report `ready`.
- ⚠️ **`web_search`, `image_generate`, `music_generate`, `video_generate`,
  `image`** — need a valid provider key (Gemini). They fail today because the
  `google` provider in `~/.dex/dex.json` holds a **Groq** key, not a Gemini
  key (see the LLM section below).
- ⛔ **`gateway`, `nodes`, `agents_list`, `heartbeat_respond`, `tts`,
  `canvas`** — intentionally denied/unavailable in the Dex desktop profile.
- 🔜 **`parse_screen`** — ships with the Vision phase (OmniParser weights not
  yet installed).

## The LLM blocker (why chat says "LLM request failed")

The chat loop itself was never the problem — the **model budget** is:

1. Primary `groq/llama-3.3-70b-versatile` → HTTP **413**: each request is
   ~23.7K tokens but Groq's **free tier caps at 12K tokens/minute**. Rejected
   every time before running.
2. Fallback `google/gemini-2.5-flash-lite` → HTTP **400 "API key not valid"**:
   the `google` provider slot holds the Groq key (`gsk_…`), not a Gemini key
   (`AIza…`).

**Fix:** add a free Gemini API key (https://aistudio.google.com/app/apikey)
in Settings → Account → Secrets, and make Gemini the primary model (its free
tier handles the full prompt; Groq free tier cannot). Groq then stays as a
fast fallback for small turns.
