# What's next for Dex — UFO² + browser-use deeper integration

Phase B (the OpenClaw → Dex ownership migration) is done. The gateway,
CLI, npm package, and Flutter UI all carry the Dex brand. Time to make
the **hands** part of Dex (the part that actually drives apps and
browsers) feel as polished as the brain.

This document is the short version of the work that was queued in
`plans/see-the-design-md-and-bubbly-whistle.md` as Phase C, but
tightened so we can start picking commits without re-reading the whole
plan.

## The five things that matter most

### 1. Make the orchestrator pick the right engine

**Why.** Today, Dex picks between **OpenClaw's built-in shell tool**,
**UFO² (Windows native apps)**, and **browser-use (web pages)** based on
the SKILL.md descriptions Claude reads each turn. That works ~80% of
the time but burns 500-2000 ms on every decision and still mis-routes
"open Notepad and type" to the browser sometimes.

**The fix.** A capability-scoring router that picks the engine in
< 100 ms using cheap deterministic context (active process name, UIA
tree availability, browser CDP probe) + a Beta-prior learner that
remembers which engine succeeded on which app over time.

**Files to create:**
- `dex/orchestration/context-scanner.ts` (< 50 ms parallel probes)
- `dex/orchestration/capability-scorer.ts` (base table + history blend)
- `dex/orchestration/router.ts` (sort, return top + fallback chain)
- `dex/orchestration/telemetry.ts` (SQLite log of every run)
- `dex/orchestration/self-learning.ts` (periodic Beta-prior update)

**Effort.** ~1 week of focused work. Foundation for everything else
below.

### 2. OmniParser as a third engine

**Why.** Some apps don't have a UIA tree (games, Photoshop, Figma
desktop, anything Java Swing). Today UFO² fails on them. browser-use
can't help because they're not in a browser. We need vision.

**The fix.** Add Microsoft's
[OmniParser v2](https://github.com/microsoft/OmniParser) (YOLO-style
screen parser that outputs `[(bbox, label, type)]` from a screenshot).
The router calls it only when UIA + DOM are both unavailable.

**Files to create:**
- `dex/drivers/omniparser/server.py` — FastMCP wrapper
- `dex/drivers/omniparser/inference.py` — ONNX loader
- `dex/orchestration/engines/omniparser.ts` — adapter

**Effort.** ~3 days. ~2 GB ONNX weight download on first invocation;
cached in `~/.dex/models/omniparser/`.

### 3. Gemini Flash-Lite as a third LLM provider

**Why.** Anthropic + Groq are great but expensive (Claude) or text-only
(Qwen 3). Gemini Flash-Lite is multimodal AND cheap (~$0.075 per 1M
tokens, 10× cheaper than Sonnet) AND fast. Perfect for the orchestrator
+ UFO²'s per-step decisions.

**The fix.** Add `google` as a provider option in `dex onboard`,
`dex configure`, the `extensions/google/` plugin, the UFO²
`agents.yaml.template`, and `dex/drivers/browser/server.py`.

**Effort.** ~1 day. The `extensions/google/` plugin already exists for
LLM; this just adds the Flash-Lite catalog entry + the UFO/browser
wiring.

### 4. UFO² timeout + shell-shortcut SKILL.md hints

**Why.** Real session pain: "change my DNS to 1.1.1.1" took Claude 10
minutes flailing through Windows Settings before timing out. It should
have just run `netsh interface ip set dns name="Wi-Fi" static 1.1.1.1`
in 5 seconds.

**The fix.** Two changes to `dex/drivers/windows-desktop-control/`:

1. Add a `timeout_s` knob the gateway can pass per-task. Default 120 s
   today; raise to 300 s when the goal mentions Settings / Control
   Panel.
2. Add a "Prefer shell when possible" section to the driver's SKILL.md
   that lists shell-solvable patterns (DNS, service start/stop,
   registry, network adapters, env vars). Claude reads SKILL.md every
   turn and will route shell-solvable tasks correctly.

**Effort.** ~2 hours.

### 5. browser-use vision auto-fallback

**Why.** Qwen 3 (the default browser-use brain) is text-only and gets
stuck on image-heavy pages (image CAPTCHAs, image-only buttons).
Today the user has to manually re-run with `engine=vision`.

**The fix.** When browser-use detects N consecutive page-state failures,
flip to a vision-capable model (Claude or Gemini Flash-Lite) for the
remaining steps. Logged in telemetry; never silent.

**Effort.** ~3 hours.

## Concrete next 8 commits

In Phase C grouping (mirrors the `plans/...` file's commit shape):

```
C.0  feat(orchestration): types + AutomationEngine interface
C.1  feat(orchestration): context-scanner.ts (Win32 + UIA + CDP, parallel)
C.2  feat(orchestration): capability-scorer.ts + scorer-weights + base table
C.3  feat(orchestration): router.ts + fallback chain wired into MCP dispatch
C.4  feat(orchestration): telemetry.sqlite + Beta-prior self-learner
C.5  feat(driver):        dex/drivers/omniparser/ + lazy ONNX weight download
C.6  feat(llm):           Gemini Flash-Lite across core + UFO² + browser-use
C.7  test(orchestration): perf bench + 4-app routing smoke + Flutter chip
```

Each commit has a single owner-verifiable gate. Total time budget:
**~2 weeks** with one person.

## Things deliberately NOT on this list

- **Replacing UFO² with a homegrown driver.** UFO² is MIT-licensed and
  battle-tested on Win11 UIA edge cases that would take us months to
  recreate. Keep using it; layer the orchestrator on top.
- **Replacing browser-use with Playwright directly.** browser-use already
  wraps Playwright with LLM-driven step planning. We don't want to
  redo that work.
- **Multi-OS (macOS / Linux) GUI automation.** Out of scope until v1.6.
  Today Dex is Windows-first.
- **Cloud relay / Tailscale.** Out of scope until v1.3 (per the original
  plan).

## The first concrete deliverable when you say go

If you give me a green light tomorrow, I start with **C.0 + C.1**:

- Write `dex/orchestration/types.ts` (the `AutomationEngine` interface +
  `RuntimeContext` + `TaskIntent` shapes).
- Write `dex/orchestration/context-scanner.ts` with stub probes that
  return hardcoded values, plus the Win32 GetForegroundWindow call.
- Pass the existing 3-engine smoke (UFO routing for Calculator,
  browser-use for livechat.com, shell for `ls Desktop`).
- Commit + push as `feat(orchestration): C.0 + C.1`.

That gives us the skeleton + one real probe in a single afternoon.
After that, each subsequent commit lands a single concrete capability.

## Status

- Phase B: **done** (14 commits, on `origin/main` through `8ad93685`).
- Phase C: **unblocked** when you publish `dexagent@2026.6.7` and confirm
  the install works.
- Mobile + macOS UI port (v1.3): blocked on Phase C landing.
- Self-contained installer (v1.5): blocked on stability of the orchestrator.

Phase C is the difference between Dex being "calm UI on top of OpenClaw"
and Dex being "the assistant that actually picks the right tool the
first time". It's the highest-leverage work left.
