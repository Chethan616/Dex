---
name: browser-control
description: Drive a real web browser (Chromium via Playwright + browser-use) to accomplish tasks inside web pages -- forms, scraping, multi-page flows, web-based tests. Use for ANY task that interacts with rendered HTML.
os: ["windows"]
always: false
---

# Browser Control

This skill teaches you to drive a **real web browser** via the `browser-control` MCP server's `run_browser_task` tool.

## When to reach for this

Use `run_browser_task` for anything that lives inside a webpage:

- Web forms (sign-ups, contact forms, multi-page wizards)
- Scraping rendered content (prices, listings, articles)
- Web-based tests (typing tests, coding sandboxes, online quizzes)
- Multi-step web flows (search, filter, click result, extract)
- Anything where a human would say "open my browser and..."

## When NOT to use this

- **Native Windows apps** (Excel, Word, Outlook, Settings, Calculator, file dialogs, Photoshop, custom-drawn UIs) → use `run_desktop_task` instead.
- **File / CLI / git / npm / launching an app from a terminal** → use the shell/file tools.
- **Just opening a browser without doing anything in it** → that's a shell `Start-Process` for the user's browser. Do not call `run_browser_task` to "open vivaldi.exe" -- this tool spawns its OWN isolated Chromium; layering them creates two browser windows.

## How to call

```jsonc
run_browser_task({
  "goal": "Take the typing test at livechat.com and report my WPM",
  "url_hint": "https://www.livechat.com/typing-speed-test/",
  "timeout_s": 180,
  "dry_run": false,
  "headless": false
})
```

- `goal` -- one clear sentence describing the end state. Include enough context that someone reading just the goal would know what to do.
- `url_hint` -- optional starting URL. The agent navigates there as step 1.
- `timeout_s` -- hard cap, 1-600 seconds. Default 180 fits most single-page flows. Bump for multi-page research.
- `dry_run` -- `true` to plan without executing. v1 limitation: returns a stub plan; prefer the user-confirmation rule below.
- `headless` -- default `false` so the user can watch. Set `true` only for background scraping where the user explicitly doesn't want a visible window.

Returns: `{ ok, summary, steps, task_id, log_path }`. Same shape as `run_desktop_task` -- the Dex UI renders both uniformly.

## User confirmation -- REQUIRED before every real call

Before calling `run_browser_task` with `dry_run=false`, you MUST:

1. State the plan in one short paragraph:
   > "I'll open livechat.com/typing-speed-test, find the input field, type the words the page shows, and report your WPM when done. Approve?"
2. Wait for explicit approval (`yes`, `approve`, `do it`, `go ahead`). A bare "ok" is fine; silence or ambiguity is not.
3. On denial or no answer, do not call the tool. Ask one clarifying question or move on.

This is the same convention `run_desktop_task` uses. The Dex UI surfaces it as the Action Preview card.

## Behavior rules

- One coherent web task per call. For multi-stage workflows (research, then summarize, then post) prefer separate calls each with their own approval.
- **Vision is off** (Qwen 3 is text-only). The agent grounds via the page's DOM and accessibility tree. This works for ~90% of mainstream sites but FAILS on:
  - Image-only buttons with no aria-label/alt text
  - CAPTCHA -- **refuse** rather than attempt
  - Heavily canvas-rendered apps (Figma, online photoshops, browser games)
  - Sites that detect synthetic input as anti-cheat (some typing tests, banking 2FA flows)
- If a task looks like it needs vision, say so to the user and offer to switch the `engine` flag to Claude vision -- don't flail.
- If `summary` returns "refused: ..." or "error: ...", surface it to the user verbatim. Do not retry more than once, and only if the failure looks transient (timeout on a slow page, 429 on a hot endpoint).
- Refusal patterns are encoded in `_shared/approval.py`: banking logins, money transfers, public posting without explicit consent in the goal text, CAPTCHA. Goals matching these come back as `refused: ...`.

## Examples (routing decisions)

**Good (browser-control):** "Find the cheapest flight from BLR to BOM on Skyscanner next Saturday and tell me the price." → `run_browser_task({goal: "...", url_hint: "https://www.skyscanner.com"})`

**Good (windows-desktop-control instead):** "Sum column B in Excel." → `run_desktop_task`, not browser-control. Excel isn't a webpage.

**Good (shell instead):** "Show me what's in C:\\Users\\cheth\\Desktop." → shell `ls`, not browser-control. The file system isn't a webpage.

**Bad:** Calling `run_browser_task` to "open vivaldi.exe" -- you'd get two browser windows because this tool spawns its own Chromium. If the user actually wants their existing browser opened, use shell.

**Bad:** Calling without explaining first. The Dex UI relies on your plan message as the Action Preview content.
