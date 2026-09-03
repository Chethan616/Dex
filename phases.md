# Phases

Working order, best-first. Each phase ends with a report and what to test by
hand; the next begins on "continue". This file and `plan.md` are deleted when
Phase 6 lands.

| | phase | state |
|---|---|---|
| 1 | Make it fast, and make failure legible | **done** |
| 2 | Find anything on this PC | next |
| 3 | Real conversation history, and the navigation around it | |
| 4 | Reminders, schedules, and the slash commands | |
| 5 | Connectors and accounts | |
| 6 | Your real browser, forked in | |

---

## Phase 1 — Make it fast, and make failure legible · **done**

**Speed.** `--permission-mode plan` dropped from the planner. Measured on the
same request:

```
with plan mode     13.2s, 9.7s
without             6.6s, 6.8s
```

`--allowedTools ''` was always the safety property — with no tools there is
nothing to permit. Plan mode also occasionally derailed the answer, because it
tells the CLI that editing code is what it is for.

**Liveness.** `core/orchestrator/liveness.ts` — a tier is available only when
it is registered, enabled in Settings, *and* answering on its port. The planner
is told what is off before it plans; escalation refuses a dead tier up front
with the command that fixes it. "Off in Settings" and "should be up and is not"
are different sentences.

**Verdicts.** Every step now closes with what happens next — `Next: step 3 of
5`, `That was the last step`, `Stopping here` — instead of "The plan can
continue", which was true of every step and therefore said nothing.

Tests: `npm run test:liveness`.

## Phase 2 — Find anything on this PC · next

A local hybrid index: metadata, extracted text, OCR at index time, embeddings,
incremental watching. `find_files` gains a scope and stops defaulting to
Downloads.

## Phase 3 — Real conversation history

A `messages` table, so clicking a sidebar row opens the conversation instead of
re-running the request.

## Phase 4 — Reminders, schedules, slash commands

Wire the reminders screen to the scheduler that already exists; rebuild the
command palette.

## Phase 5 — Connectors and accounts

Telegram, Discord, WhatsApp pairing from Settings. Google Workspace OAuth end
to end.

## Phase 6 — Your real browser, forked in

Fork OpenDia's extension (MIT, © 2025 Aeon Inc), drop its MCP bridge, host the
WebSocket on Dex's browser agent so the tools become native primitives that go
through confirmation tiers and verification.
