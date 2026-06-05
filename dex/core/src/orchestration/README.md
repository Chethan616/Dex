# Dex orchestration

The orchestrator picks ONE automation engine per task in < 100 ms using
cheap deterministic context + a learned history prior. No LLM call is
made for the routing decision; the LLM only runs **after** the engine is
chosen, inside that engine's own step-planning loop.

## The path a task takes

```
user prompt
   │
   ▼
parse to TaskIntent     (kind + hints + raw text)
   │
   ▼
scanRuntimeContext()    (Phase C.1)
   ├─ Foreground process     ← Win32 GetForegroundWindow
   ├─ UIA root probe         ← cheap children-only walk
   ├─ Browser CDP probe      ← if process is chromium/firefox/webkit
   ├─ Telemetry history      ← per-process Beta priors from sqlite
   └─ All probes run in parallel, 50 ms timeout each
   │
   ▼
RuntimeContext snapshot
   │
   ▼
capability-scorer.ts    (Phase C.2)
   ├─ Per-engine base score    ← hand-tuned (engine, appFamily) table
   ├─ History prior            ← Beta-mean(α + successes, β + failures)
   ├─ Latency penalty          ← negative when slow engine + tight budget
   └─ Confidence               ← engine.score(ctx, task)
   │
   ▼
router.ts               (Phase C.3)
   ├─ Sort breakdowns by composite score
   ├─ Primary = top engine
   ├─ Fallbacks = next two
   └─ RoutedExecution returned to gateway
   │
   ▼
engine.execute(ctx, task, opts)
   ├─ Telemetry write           (telemetry.ts, Phase C.4)
   ├─ On failure: try recover() → fallbacks → escalate to user
   └─ Self-learning prior update on every N runs (self-learning.ts)
```

## Per-engine score table (Phase C.2 starter)

Hand-tuned defaults. Numbers refine over time via the Beta-prior learner.

| Engine     | browser | office | ide  | game | media | system | unknown |
|------------|--------:|-------:|-----:|-----:|------:|-------:|--------:|
| UfoUIA     |    0.10 |   0.92 | 0.65 | 0.05 |  0.45 |   0.85 |    0.55 |
| BrowserUse |    0.95 |   0.05 | 0.10 | 0.00 |  0.20 |   0.05 |    0.20 |
| OmniParser |    0.30 |   0.40 | 0.45 | 0.92 |  0.70 |   0.30 |    0.60 |
| Shell      |    0.20 |   0.10 | 0.55 | 0.05 |  0.05 |   0.95 |    0.40 |

Composite score formula (weights live in `scorer-weights.ts`):

```
score = 0.40 * base
      + 0.30 * historyPrior
      + 0.10 * latencyPenalty
      + 0.20 * confidence
```

## Files in this directory

| File | Phase | Role |
|---|---|---|
| `types.ts` | C.0 | `RuntimeContext`, `TaskIntent`, `AutomationEngine`, `ScoreBreakdown`, `ExecResult`, `ExecError` |
| `context-scanner.ts` | C.1 | Parallel foreground + UIA + browser CDP + history probes |
| `capability-scorer.ts` | C.2 | Base table + Beta-prior blend + composite score |
| `scorer-weights.ts` | C.2 | Tunable weights constants |
| `router.ts` | C.3 | Sort + return top + fallback chain |
| `telemetry.ts` | C.4 | SQLite writer keyed by (process_name, engine_id) |
| `self-learning.ts` | C.4 | Periodic Beta-prior update job |
| `engines/ufo-uia.ts` | C.3+ | Adapter for `dex/drivers/windows-desktop-control/` |
| `engines/browser-use.ts` | C.3+ | Adapter for `dex/drivers/browser-control/` |
| `engines/omniparser.ts` | C.5 | Adapter for `dex/drivers/omniparser/` (NEW driver) |
| `engines/shell.ts` | C.3 | Dex built-in shell tool adapter |

## Why deterministic routing, not LLM-driven

Pure-LLM routing (today's behaviour, where Claude reads each SKILL.md
and picks a tool) costs 500-2000 ms per turn and still mis-routes simple
cases. The orchestrator:

- Spends < 100 ms total on the routing decision (50 ms scan + 10 ms
  score + 5 ms sort + 35 ms slack).
- Uses no LLM tokens for routing.
- Learns from telemetry — engines that historically succeeded on this
  app get scored higher next time, with a Beta-prior so a single bad
  early run doesn't poison the chart.
- Falls through to fallbacks deterministically when the primary fails,
  not by re-prompting the LLM.

## Performance budget (Phase C.9 gate)

| Phase | Target | Measured by |
|---|---|---|
| Context scan | < 50 ms p95 | `dex/orchestration.bench` task in `pnpm bench:orchestration` |
| Capability scoring | < 10 ms p95 | same |
| Routing decision | < 5 ms p95 | same |
| **Total overhead** | **< 100 ms p95** | sum of above |

The bench file is wired in C.7 alongside the 4-app routing smoke test.

## Status

- **C.0**: types.ts ✓
- **C.1**: context-scanner.ts ✓ (probes are stubs; real Win32 GFW + UIA + CDP wiring lands when this hooks into the gateway loop)
- **C.2 – C.7**: pending

See `D:\project1\docs\architecture\what-is-next.md` for the
post-2026.6.8 execution order, including how Phase D's locked direction
(single dex-client channel, native mobile, GUI onboarding) sits on top.
