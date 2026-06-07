# Dex — Setup Guide

A calm cockpit for commanding agents you can trust. Windows-first; macOS / Linux desktop arrive in v1.3.

> **TL;DR — fastest working path:** install Node 24 + Python 3.11 + Flutter SDK + `gh` CLI, then `npm install -g dexagent`, `dex onboard`, paste an Anthropic key, done. Skip UFO² / browser-control until you actually need them.

---

## 1. Prerequisites

| Tool | Min version | Why | How to install |
|---|---|---|---|
| **Node.js** | 24.x | The Dex brain (`dex-core`) runs on Node. | https://nodejs.org/ |
| **Python** | 3.11 | UFO² + browser-use + OmniParser drivers. | https://www.python.org/downloads/ |
| **Flutter SDK** | 3.12+ | Desktop client. | https://docs.flutter.dev/get-started/install |
| **Git** | any | Submodule cloning. | https://git-scm.com/ |
| **GitHub CLI (`gh`)** | any | Used by some workflow integrations. Optional. | https://cli.github.com/ |
| **PowerShell 7+** | any | Better quoting than 5.1 for the install scripts. Optional. | `winget install Microsoft.PowerShell` |

Windows-specific:
- Enable Developer Mode (Settings → Privacy & security → For developers) so symlinks work.
- Disable the OneDrive backup on your Desktop / Documents / Downloads folders if you plan to use the Phase G file-intel indexer (G.2+).

---

## 2. Install Dex

```powershell
npm install -g dexagent
dex --version
# expect: Dex 2026.6.20 (1cc7c48) or later
```

If you're hacking on the repo locally instead of using npm:

```powershell
git clone https://github.com/Chethan616/Dex.git D:\project1
cd D:\project1\dex\core
pnpm install
pnpm build
npm install -g .
```

---

## 3. First-time onboarding

```powershell
dex onboard
```

The wizard walks you through:

1. **Gateway port** — default `18789`. Change only if something already owns it.
2. **Agent model** — see the model recommendation table below.
3. **Auth profile** — paste your API key OR sign in via `claude-cli` OAuth.

After onboarding finishes, the config lives at `~/.dex/dex.json` (legacy: `~/.dex/openclaw.json` still works for one cycle).

---

## 4. Model selection — what to use for what

Dex's brain (`dex-core`) and each MCP driver pick their own LLM. They can be the same model or different. Below: recommendations per role, ordered by quality at each cost tier.

### 4.1 Chat agent (dex-core brain)

This is what reads your messages, plans the turn, decides which MCP tool to call. **The orchestrator preflight (Phase F.1.a) appends a routing hint per turn**, so the brain doesn't have to choose tools alone — but it still has to write, reason, and stitch tool outputs.

| Tier | Model | Why pick it | Where to get the key |
|---|---|---|---|
| **Best quality** | Claude Sonnet 4.6 | Strongest at multi-step tool chains; rarely hallucinates tool args; great prose. | https://console.anthropic.com/account/keys (paid) OR `claude-cli` OAuth (free w/ Claude account) |
| **Best value** | Gemini 2.5 Pro | ~10× cheaper input than Sonnet, almost as good at planning; multimodal. | https://aistudio.google.com/app/apikey (paid tier) |
| **Cheap / fast** | Gemini Flash-Latest | Free tier covers chat well; falls down on complex multi-step turns. | https://aistudio.google.com/app/apikey (free) |
| **Avoid** | Groq Qwen 3 | Text-only — can't read screenshots. Fine for shell-only tasks. | https://console.groq.com/keys (free) |

Set it during `dex onboard` or after the fact:

```powershell
dex configure --section model
```

### 4.2 UFO² desktop agent (windows-desktop-control MCP)

Each UFO² planning step sends **~500 KB – 1.5 MB** of UIA tree + screenshot to the LLM. **Multimodal is required**; text-only models won't see the screen and will return "task complete" instantly with no steps. Free tiers commonly time out on the request size.

| Tier | Model | Why pick it | Where |
|---|---|---|---|
| **Best quality** | Claude Sonnet 4.6 via Anthropic API | Most reliable on long UI sequences (Word, Settings, Excel). | https://console.anthropic.com/account/keys |
| **Best value** | Gemini 2.5 Pro | Higher TPM/RPM than free tier; fits the 1+ MB request comfortably. | https://aistudio.google.com/app/apikey (paid) |
| **Works for simple tasks** | Gemini Flash-Latest with `VISUAL_MODE: False` | Skips screenshots → small text-only request, fits free tier, works for accessible apps with rich UIA trees (Notepad, Office). | Same key as Flash; flip `VISUAL_MODE` in `vendor/UFO/config/ufo/agents.yaml`. |
| **Don't bother** | Gemini Flash-Latest with `VISUAL_MODE: True` on free tier | 1+ MB multimodal requests hang the free-tier rate limits. Symptom: tool times out at 300 s. | — |

Where to edit: `vendor/UFO/config/ufo/agents.yaml` (gitignored, rendered from the template). Four agent blocks need the same `API_TYPE` / `API_BASE` / `API_KEY` / `API_MODEL` values: `HOST_AGENT`, `APP_AGENT`, `BACKUP_AGENT`, `EVALUATION_AGENT`.

After editing: `dex gateway stop` then `dex gateway run --force --port 18789`. UFO² re-reads the config on next spawn.

### 4.3 browser-control web agent (browser-control MCP)

Drives Playwright + Chromium for web tasks. Vision is **on by default** as of 2026.6.18 — non-multimodal LLMs return empty steps. Same multimodal requirement as UFO².

| Tier | Model | DEX_BROWSER_PROVIDER | DEX_BROWSER_MODEL |
|---|---|---|---|
| **Best quality** | Claude Sonnet 4.6 | `anthropic` | `claude-sonnet-4-6` |
| **Best value** | Gemini 2.5 Pro | `google` | `gemini-2.5-pro` |
| **Default / free** | Gemini Flash-Latest | `google` | `gemini-flash-latest` |
| **Text-only fallback** | Groq Qwen 3 | `groq` | `qwen/qwen3-32b` |

Where to set: `~/.dex/dex.json` under `mcp.servers.browser-control.env`, OR globally via env vars before `dex gateway run`. The install script (`scripts/install-skills.ps1`) writes these for you.

### 4.4 OmniParser (vision parser)

Not an LLM. Microsoft's MIT-licensed ONNX model that converts a screenshot to `[(bbox, label, type)]`. Required only for canvas-heavy browser tasks (Figma / Miro) and games. **~2 GB ONNX weights, downloaded lazily on first call.**

Install:

```powershell
py -3.11 -m venv D:\project1\vendor\omniparser\.venv
D:\project1\vendor\omniparser\.venv\Scripts\python.exe -m pip install -r D:\project1\dex\drivers\omniparser\requirements.txt
```

Weights download to `~/.dex/models/omniparser/` on first `parse_screen()` call.

### 4.5 Embeddings (Phase G — local file intelligence, not shipped yet)

When G.2+ ships, embeddings will run **locally via Ollama** with `nomic-embed-text`. No API key needed; no cloud calls. Install Ollama first: https://ollama.com/download/windows. Pull the model:

```powershell
ollama pull nomic-embed-text
```

---

## 5. Optional drivers — when you actually need them

You don't need any of these for chat-only use. Add them as the use case appears.

### 5.1 UFO² (drive native Windows apps)

```powershell
py -3.11 -m venv D:\project1\vendor\UFO\.venv
D:\project1\vendor\UFO\.venv\Scripts\python.exe -m pip install -r D:\project1\vendor\UFO\requirements.txt
# Render the agents.yaml from the template (substitutes nothing -- you edit the resulting file)
copy D:\project1\vendor\UFO\config\ufo\agents.yaml.template D:\project1\vendor\UFO\config\ufo\agents.yaml
# Now edit agents.yaml -- paste your API key, pick the model from §4.2
```

Register with Dex's gateway:

```powershell
cd D:\project1
.\scripts\install-skills.ps1 -SkipChromium
```

### 5.2 browser-control (drive web pages)

The `install-skills.ps1` script also sets up browser-control. Pass `-SkipChromium` if you want to defer the ~150 MB Playwright Chromium download. Once you actually use a browser task, drop the flag and re-run:

```powershell
.\scripts\install-skills.ps1
```

### 5.3 Flutter desktop client

```powershell
cd D:\project1\app
flutter pub get
flutter run -d windows
```

Hot-restart (`Shift+R` in the run terminal) picks up theme + widget changes without re-launching.

---

## 6. Verify the install

```powershell
dex gateway run --force --port 18789
```

In another shell:

```powershell
dex mcp list
# expect: browser-control, windows-desktop-control listed
dex doctor
# expect: green "Gateway OK" line; warnings for unconfigured channels are fine
```

In the Flutter app:
1. Send `list my desktop` — should run `bash` and stream filenames. ✓ shell engine works.
2. Send `open notepad and write hello` — should fire the orchestrator preflight (engine: `ufo-uia`), open Notepad, type, save. If UFO² is on free Gemini Flash-Latest this may time out — that's a known constraint, see §4.2.
3. Send `take typing test at https://livechat.com/typing-speed-test/` — should fire browser-use, open Chromium, type. ✓ browser engine works.

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `dex --version` not found | Local install instead of global. | `npm install -g dexagent` (NOT `npm install dexagent`). |
| Gateway says "no auth token" | Onboard never finished. | Re-run `dex onboard`. |
| `spawn gemini ENOENT` on Windows | Old Dex (<2026.6.10) couldn't resolve `.cmd` shims. | Upgrade: `npm install -g dexagent@latest`. |
| `chat.inject INVALID_REQUEST` when clicking Approve | Pre-2026.6.13 routing. | Hot-restart Flutter app; ensure dex-core is ≥ 2026.6.13. |
| UFO² hangs at 300 s every time | Gemini free-tier rate limits on 1+ MB multimodal requests. | Switch agents.yaml to Gemini paid tier OR Anthropic OR set `VISUAL_MODE: False`. See §4.2. |
| browser-use returns "completed" instantly with no steps | `use_vision=False` on a multimodal model. | Upgrade to ≥ 2026.6.18; fixed. |
| WhatsApp keeps opening on its own after closing terminal | Zombie MCP subprocesses. | Kill them: `Get-CimInstance Win32_Process \| Where-Object { $_.CommandLine -match 'dex\\.drivers' } \| Stop-Process -Force`. |
| `dex onboard` overwrote my model choice | Wizard re-prompts on every run. | Don't re-run onboard once configured. Edit `dex configure --section model` instead. |

---

## 8. What's actually in the box (v1.0 architecture)

```
┌───────────────────────────────┐
│  Flutter desktop client       │  ← you type here
│  - Activity panel (v1.2)      │
│  - Stop / Clear buttons       │
│  - Engine chips per turn      │
└─────────────┬─────────────────┘
              │ WebSocket on 127.0.0.1:18789
┌─────────────▼─────────────────┐
│  dex-core gateway (Node 24)   │  ← the brain
│  - claude-cli / gemini-cli     │
│  - F.1.a orchestrator preflight│
│  - MCP server dispatch         │
└─────────────┬─────────────────┘
              │ MCP stdio
   ┌──────────┼──────────────┐
   ▼          ▼              ▼
┌─────┐  ┌─────────┐  ┌───────────┐
│Shell│  │ UFO²    │  │ browser-  │
│built│  │ windows-│  │ control   │
│-in  │  │ desktop-│  │ (Playwrig)│
└─────┘  │ control │  └───────────┘
         └─────────┘
```

OmniParser is scaffolded but not wired live; lands in Phase E follow-up when the user installs the ONNX weights.

---

## 9. Next steps after setup

- Hot-restart Flutter to pick up palette / widget changes after upgrades.
- Read `D:\project1\PLAN.md` (mirror of the canonical slash-plan) to see what's coming.
- File issues at https://github.com/Chethan616/Dex/issues.
