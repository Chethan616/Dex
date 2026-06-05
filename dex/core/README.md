# 🐚 Dex — A calm cockpit for commanding agents you can trust

`dexagent` is the **brain** behind Dex — a Windows-first personal AI assistant. It's a chat-first control surface for an agent that has *hands* on your machine. The agent reasons about what you asked for, **previews every action before it runs**, then executes inside an isolated Picture-in-Picture desktop.

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://www.npmjs.com/package/dexagent"><img src="https://img.shields.io/npm/v/dexagent.svg" alt="npm version"></a>
</p>

---

## Quick start

```bash
npm install -g dexagent
dex --help
dex gateway --port 18789
```

- **Binary on PATH:** `dex`
- **Config directory:** `~/.dex/` (first-launch auto-migrator copies `~/.openclaw/` for upgraders)
- **Gateway port (default):** `18789`
- **Min runtime:** Node 22.19+; Node 24 recommended

## What's in this package

The `dexagent` npm package ships the Dex gateway runtime: sessions, channels, skills, memory, cron, built-in shell + filesystem tools, and the WebSocket / HTTP gateway clients talk to. The Flutter app (the user-facing UI), the Windows/browser MCP drivers (`run_desktop_task` / `run_browser_task`), and the vendored UFO² / browser-use Python runtimes live in the **parent project** at [github.com/Chethan616/Dex](https://github.com/Chethan616/Dex).

## Architecture

```
Flutter app (Dex)
   │  WebSocket on 127.0.0.1:18789
   ▼
dexagent gateway (this package)              ← the brain · Anthropic Claude
   │  MCP stdio
   ▼
   ┌───────────────────────────────────────────────────────────┐
   ▼                                                           ▼
windows-desktop-control MCP                            browser-control MCP
(Python 3.10/3.11, UFO², Win32 UIA)                    (Python 3.11, Playwright)
run_desktop_task                                       run_browser_task
```

## Configuration

Dex reads `~/.dex/dex.json` (or `~/.openclaw/openclaw.json` during one-cycle migration). Most knobs are configurable via `DEX_*` environment variables; legacy `OPENCLAW_*` variables continue to work for one release cycle with a stderr deprecation hint.

Common env vars:

- `DEX_GATEWAY_TOKEN` — auth token for the gateway WebSocket
- `DEX_GATEWAY_PORT` — override the default 18789
- `DEX_PROVIDER_ATTRIBUTION_REFERER` — opt-in OpenRouter `HTTP-Referer` (disabled by default)
- `DEX_PROVIDER_ATTRIBUTION_TITLE` — OpenRouter app title (default "Dex")
- `DEX_DOCS_SEARCH_URL` — opt-in docs search endpoint (disabled by default)
- `DEX_VAPID_SUBJECT` — web-push VAPID subject

The full list lives in `docs/migration/env-vars.md` in the parent repo.

## Heritage & license

Dex is **MIT-licensed** and stands on the shoulders of:

- **[OpenClaw](https://github.com/openclaw/openclaw)** — `dexagent` is a downstream of OpenClaw at commit `7074cf8e23c1f64362c4f8c4bf32971ca94d5221` (2026-06-03), forked into Dex on 2026-06-04. The full heritage commitment — including every preserved file, attribution header, and the six external `@openclaw/*` npm dependencies we keep credited as upstream — lives in [`HERITAGE.md`](./HERITAGE.md).
- **[Microsoft UFO²](https://github.com/microsoft/UFO)** — MIT — vendored separately as the Windows native-app GUI driver.
- **[browser-use](https://github.com/browser-use/browser-use)** — MIT — vendored separately as the web automation driver.

OpenClaw's original `LICENSE` file is preserved verbatim in this directory. All upstream per-source-file copyright headers remain intact per MIT.

## Links

- **Repository:** https://github.com/Chethan616/Dex
- **Issues:** https://github.com/Chethan616/Dex/issues
- **Migration report (OpenClaw → Dex):** [`docs/migration/dex-migration-report.md`](https://github.com/Chethan616/Dex/blob/main/docs/migration/dex-migration-report.md) in the parent repo
- **Third-party notices:** [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)
