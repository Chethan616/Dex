# Phases

Working order, best-first. Each phase ends with a report and what to test by
hand; the next begins on "continue". This file and `plan.md` are deleted when
Phase 6 lands.

| | phase | state |
|---|---|---|
| 1 | Make it fast, and make failure legible | **done** |
| 2 | Find anything on this PC | **done** |
| 3 | Real conversation history, and the navigation around it | next |
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

## Phase 2 — Find anything on this PC · **done**

`agents/files/indexer/` — a local index, nothing leaving the machine. Its own
database at `%LOCALAPPDATA%\DEX\index.db`, deliberately not `dex.db`, so
"delete the index and rebuild it" never risks task history.

| | |
|---|---|
| `crawl.py` | every fixed drive, minus Windows, Program Files, `node_modules`, package caches, `.git` and build output. The exclusions are what stopped fifty `.png.flat` build resources being offered as Aadhaar cards |
| `extract.py` | PDF and DOCX text; Windows' own `Windows.Media.Ocr` for images and scanned PDFs — already on the machine, so no Tesseract to install |
| `store.py` | SQLite FTS5 over two surfaces: the path as words, and the extracted text |
| `search.py` | two passes — by name and by content — merged, each hit saying why |
| `cli.py` | one JSON document per call; the only thing Node talks to |

**Both original failures now pass.** `UI.png` ranks first against forty files
that also match "ui"; an Aadhaar card saved as `scan001.jpg` is found by the
word printed on it.

Three bugs found while testing, each of which would have shipped:

- the extension filter ran *after* `LIMIT`, so `UI.png` was cut before
  filtering — both filters are now pushed into SQL
- `.jpg` did not match a request for "jpeg", so the Aadhaar card was excluded
  by the filter meant to include it
- a crawl of one folder swept the whole index — measured `removed: 1448`,
  which was the entire Desktop

**Semantic, without a model download.** "aadhaar" also searches for uid, uidai
and "government of india". Two routes: a short table of what a *kind of
document* is also called, and `also_called` on the action — the planner knows
what "my resume" might be filed as and passes it, which is the general
mechanism rather than a list of cases. Embeddings were not built: they need a
model download, and the terms they add would be invisible in the result where
these are printed beside the match.

**`find_files` takes `scope`** — `"pc"`, `"profile"` (default), or a folder.
The `Downloads` default is gone. The live filename walk is kept as the fallback
for the first crawl and for a file saved a minute ago; when it is what
answered, the result says so, and an empty one verifies as UNVERIFIABLE rather
than VERIFIED — "not indexed yet" is never reported as "not on this PC".

Also fixed here: `Agent.endpoint` marks the three agents that are HTTP proxies,
so Phase 1's liveness probe is asked only about tiers that have a process to be
down. And the crawler's six threads each ran `PRAGMA journal_mode = WAL` on a
new database at once — "database is locked", on the first crawl and never
again.

**What the first real crawl exposed.** Run against this machine rather than a
fixture, it spent 21,000 files and 1,885 OCR calls inside `.codex`, `.gemini`,
`.claude`, `.antigravity-ide` and `.cursor` — every AI tool's session cache —
and had still not reached the Desktop. Four fixes, each a rule rather than a
list of names:

- **a leading dot means cache, not documents.** Naming those five folders would
  have fixed today and missed the sixth tool installed next month. Hidden and
  system folders go with them.
- **the owner's folders are crawled first** — Desktop, Documents, Downloads,
  Pictures, CrossDevice, OneDrive — so a half-finished crawl is finished in
  the useful direction. Where they *are* is read from the registry: on this
  machine the Desktop is not under the home directory at all, because OneDrive
  moved it.
- **network drives are indexed.** A mapped share is somewhere files really are.
  Removable media stays out: indexed today, absent tomorrow.
- **names before contents.** Reading as it walked managed 18 files a second, so
  nothing was findable for the first hour — including files whose name was the
  whole answer. Batching the writes and taking the size and timestamps from the
  directory listing rather than a second syscall took the names pass from 35 to
  ~120 files a second; contents fill in behind it.

Two more found by running it: a second crawl started while the first was going
produced "database is locked" from a sixty-second `busy_timeout` — SQLite
refuses a read-then-write transaction immediately rather than waiting — so the
writers retry and a crawl now claims the index before starting. And the crawl
writes a heartbeat, so a core starting up can tell a crawl that is working from
one killed with the machine, and resume it.

Tests: `npm run test:index` (28 checks).

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
