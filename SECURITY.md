# Dex — Security model and risk surface

Dex puts an LLM with **shell access and GUI control** on the user's machine. This file documents what the risks are, what we do to contain them, and what the user is expected to do themselves. Read this before shipping or before letting anyone else run Dex.

---

## Threat model in one paragraph

The brain (OpenClaw + Claude) can route requests to the hands (UFO² via the `windows-desktop-control` MCP tool). A malicious prompt, a confused-deputy attack, or a careless natural-language instruction could in principle make the hands click destructive things in real apps. Our defenses are: **isolated execution** (Picture-in-Picture / virtual desktop), **ask-first by default** (the user sees and approves every action before it runs), and **scoped tools** (no shell escalation paths plumbed through the MCP server).

---

## Defense layers

### 1. Isolation — approval-first, NOT desktop-isolated in v1

> **Revised after Phase 2 source inspection.** The `prompt.md` spec assumed UFO² had a Picture-in-Picture / virtual-desktop mode. The current UFO² commit (pin in README.md) does not expose one — a repo-wide grep for PiP / virtual-desktop turns up only Linux/mobile MCP scaffolding, not a Windows isolation toggle. So:

- **v1 reality:** UFO² runs on the user's primary Windows desktop. While it acts, the user's mouse may be moved, windows may receive keystrokes, and the foreground app can change.
- **Primary defense becomes the Action Preview approval gate** (next section): nothing executes without the user seeing what it will do.
- **Roadmap (post-v1):** wrap UFO² launch in a Windows virtual desktop via `IVirtualDesktopManager` (COM) so its actions never reach the user's foreground. Tracked as a Phase 7 roadmap item.

**Verification:** Phase 2 smoke test asserts the requested file was created at the expected path. It does NOT (and cannot, in v1) assert focus was not stolen.

### 2. Ask-first approval (the Action Preview)

- Every call to `run_desktop_task` defaults to producing a **plan first** (`dry_run=True`), surfaced to the Flutter app as an Action Preview.
- Nothing executes until the user clicks **Approve**.
- If OpenClaw's gateway does not natively emit a pre-action event, the MCP server itself enforces the gate (Phase 7.1 — implemented inside `glue/windows-desktop-control/server.py`). The LLM cannot bypass this; it must go through the tool, and the tool must go through the gate.

### 3. Tool scoping

Dex exposes **two** MCP servers, each with exactly one tool. They share refusal logic via `glue/_shared/approval.py`:

- `windows-desktop-control` → `run_desktop_task(goal, app_hint, timeout_s, dry_run)` — native Win32 GUI via UFO².
- `browser-control` → `run_browser_task(goal, url_hint, timeout_s, dry_run, headless)` — web pages via browser-use + Playwright. Spawns its OWN isolated Chromium with a separate profile dir under `~/.config/browseruse/profiles/default`. Does NOT share cookies or sessions with the user's everyday browser.

No shell, file-write, network, or process-spawn tools are exposed through these MCPs. OpenClaw's own shell tool is a separate surface — when shell work is needed, the LLM uses *that*, and OpenClaw applies its own permission model.

**Rate-limit hardening (v1.1):** both tools share one Groq API key. Concurrent or rapid-fire tasks can rate-limit each other. The shared `_shared/approval.py::with_rate_limit_retry` retries once with a 2 s backoff; persistent failures return `ok=false` and surface in the tool chip as `failed`.

### 4. Timeouts

- `run_desktop_task` enforces a hard `timeout_s` (default 120s, user-configurable per call). A hung UFO² subprocess is killed.

### 5. Refusal list

Both `run_desktop_task` and `run_browser_task` will refuse goals that look destructive without explicit user confirmation. The refusal list lives in **`glue/_shared/approval.py`** (single source of truth) and is meant to be conservative, not exhaustive — the primary defense is approval, not pattern matching. Current refusal patterns:

- Goals mentioning `format`, `delete all`, `wipe`, `factory reset`, `bitlocker`, `regedit` paired with destructive verbs
- Goals asking to disable security software, antivirus, firewall, UAC
- Goals asking to install or execute downloaded binaries
- **Browser-specific (v1.1):** logging into banking sites; sending money via PayPal/Venmo/bank transfer; public posting (tweet/publish/post) without explicit goal-text consent; CAPTCHA solving (we refuse rather than attempt, since Qwen 3 has no vision)

When refusing, the tool returns `{ok: false, summary: "refused: ..."}` and the agent surfaces this to the user.

---

## What the user owns

These are intentionally *not* inside Dex's trust boundary — they're the user's responsibility.

| Concern | Who owns it |
|---|---|
| Anthropic API key (OpenClaw) | User pastes into OpenClaw's config. Never committed to this repo. |
| Groq API key (UFO²) | User pastes into `vendor/UFO/config/ufo/agents.yaml`. That file is git-ignored. |
| Windows account permissions | User runs Dex as a normal (non-elevated) user account. UAC prompts are honored, not bypassed. |
| Network access | OpenClaw → Anthropic and UFO² → Groq are the only outbound calls Dex makes. The Flutter app talks only to `127.0.0.1:18789`. |

---

## Secret hygiene

- `.gitignore` covers: `vendor/UFO/config/ufo/agents.yaml`, `vendor/openclaw/.env*`, `app/.env*`, `**/api_keys.json`, `**/*.key`.
- Pre-commit scan: any string matching common API-key patterns (`sk-ant-`, `gsk_`, `sk-`) blocks the commit. (To wire in Phase 7.)
- If a key is committed by accident: rotate it immediately at the provider, then `git filter-repo` to scrub history. Do not just delete the file.

---

## Known risks and gaps (honest list)

1. **Prompt injection via app content.** If a webpage or document the agent reads contains adversarial instructions, those could influence the next `run_desktop_task` call. Mitigation: approval gate. Residual risk: a user who reflexively approves can be steered.
2. **UIA accessibility leakage.** Qwen 3 (text mode) sees the accessibility tree of whatever app UFO² focuses, which can include text in fields. Treat the LLM as having read everything visible to a screen reader.
3. **Vision mode (Claude fallback).** When `engine="vision"`, screenshots of the PiP desktop are sent to Anthropic. Anything visible in that window leaves the machine.
4. **Approval fatigue.** If the user approves dozens of actions in a row, attention drops. We deliberately do not provide a "approve all" button.

---

## Update protocol

- This file is updated **at the close of each phase** that adds a new attack surface or mitigation.
- Phase 7 close-out is the formal sign-off: every section above must reflect what shipped, not what was planned.
