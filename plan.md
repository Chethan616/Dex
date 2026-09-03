# Dex, phase by phase

## Context

A long list, and it splits cleanly into "things that are broken and visible
every day" and "things that are missing". The order below is by that split, not
by how interesting the work is — the browser integration is the most exciting
item and it is deliberately last, because everything above it costs you time on
every single prompt.

Four things I verified in the code before ranking anything:

**The planner is still running in plan mode.** `core/llm/providers.ts:375`
passes `--permission-mode plan`. I removed exactly that flag from the *browser*
model two days ago and measured the same call at **10.8s with it and 5.4s
without** — and it also occasionally made the CLI answer *about planning*
instead of about the task. Your instinct that "claude code is doing /plan for
every prompt" is literally correct. This is one line and roughly halves the wait
on everything.

**`find_files` defaults to Downloads.** `file_agent.ts:100` —
`searchRoot(String(params.root ?? 'Downloads'))`. You said "in my pc" and it
searched one folder, then reported 50 matches of Android build junk. It is also
filename-only, so `UI.png` at
`C:\Users\cheth\OneDrive\Desktop\UI\UI INSPIRATIONS\UI.png` was missed while
`.png.flat` build resources were found. Two separate defects: the wrong scope,
and no notion of what a file *is*.

**Conversations are never stored.** There is no `messages` table —
`core/memory/db.ts` has tasks, steps, workflows, artifacts, plan_cache,
sessions, schedules, site_routes. The sidebar reads *task* history, so clicking
a row can only re-run the request. Real history needs the messages kept first.

**OpenDia is MIT, and splits into two halves we want differently.** © 2025 Aeon
Inc, so forking and bundling is clean with the licence and attribution kept.
`opendia-extension/` is the Chrome extension and `opendia-mcp/` is a Node
server whose only job is bridging that extension to an MCP client. Dex's browser
agent is already a server, so the fork takes the extension and drops the
bridge — see Phase 6 for why that is a safety argument and not just tidiness.

**How this runs:** `plan.md` and `phases.md` are written into the repo at the
start. Each phase ends with a report and a list of what to test, then waits for
"continue". Both files are deleted when the last phase lands.

---

## Phase 1 — Make it fast, and make failure legible

The two things that cost you on every prompt.

**Speed.** Drop `--permission-mode plan` from `ClaudeCodeProvider`
(`core/llm/providers.ts`). `--allowedTools ''` is the actual safety property —
with no tools there is nothing to permit — and plan mode was never more than a
belt on top of it. Measure before and after on the same request and report the
number rather than claiming an improvement.

**The flow in your screenshot.** What happened there: `click_element` failed on
the App tier, escalated to the Desktop (vision) tier, and the Desktop agent was
not running — 52 seconds to discover something knowable at second zero.
`settings.json` has `desktopAgent: false`, so it is off *by configuration* and
the planner was never told.

So:

- **The planner learns which agents are live** before it plans, the same way it
  already learns which actions the daemon implements (`checkForDrift`). A tier
  that is off is not offered, and an escalation into a dead tier is refused up
  front with the reason and the one-line fix.
- **A legible step lifecycle**, which is the flow you asked me to design:

```
  chose      why this step, and which tier
  doing      what it is doing right now
  result     what actually came back
  verdict    verified · unverifiable · failed, and on what evidence
  then       next step · repaired plan · stopped, and why
```

  The events already exist; what is missing is the verdict and the "then" line,
  so a failure reads as a decision rather than a wall of transcript.
- **One retry rule, stated.** Verified → continue. Unverifiable → continue,
  saying so. Failed and retryable → retry once. Failed and not → repair the
  plan from what the earlier steps actually returned (this exists) or stop with
  the reason. No silent second attempts.

*Test:* time a simple request before and after; ask for something needing the
vision tier while it is off and confirm it says so immediately.

---

## Phase 2 — Find anything on this PC

Your two failures were the same failure: Dex looks at filenames in one folder.

**`agents/files/indexer/`** *(new)* — a local index, nothing leaving the machine.

| | |
|---|---|
| **scope** | every fixed drive, minus Windows, Program Files, `node_modules`, `AppData\Local\Temp`, package caches, `.git`, build output. The exclusions are the difference between an index and a monument to `.png.flat` files |
| **metadata** | path, name, extension, size, dates — the cheap layer, always searched |
| **text** | PDF (`pypdf`, already installed), DOCX, TXT, MD, code |
| **OCR** | scanned PDFs and images, **at index time, never per query** — this is what finds an Aadhaar card saved as `scan001.jpg` |
| **semantic** | embeddings over name + path + extracted text, so "aadhaar" reaches "govt id", "UID", "Untitled" |
| **watch** | new and changed files indexed incrementally |

Storage in the existing SQLite (`core/memory/db.ts`) — FTS5 for keyword, a
vector table for semantic. One store, one place to delete.

**Query** is hybrid: keyword and semantic in parallel, merged by reciprocal rank
fusion, and every hit says *why* it matched — "filename", "text on page 2",
"OCR", "similar to 'government id'". A ranked list with no reason is how you get
50 build artifacts presented as an answer.

**`find_files` keeps its name** and gains `scope: 'pc' | 'profile' | <path>`,
defaulting to the **profile** rather than Downloads. "in my pc" means the PC.

The first index is a background job with visible progress; it is not something
you wait for at a prompt.

*Test:* "search for aadhaar card files in my pc" finds it wherever it is;
"find UI.png on my desktop" finds
`Desktop\UI\UI INSPIRATIONS\UI.png`; a file renamed to `scan001.jpg` is still
found by content.

---

## Phase 3 — Real conversation history, and the navigation around it

**Messages are persisted.** A `messages` table keyed by session: speaker, text,
steps, timestamps. Written as they happen, so nothing is reconstructed.

**The sidebar shows conversations, not tasks.** Clicking one **opens it** —
every message, every step card, as it was. Rename, delete, and search across
message text, which task-shaped history cannot do.

Re-running becomes an explicit action on the row, not the only thing a click can
mean.

**Navigation:** the rail is New chat · Workflows · Schedules · Capabilities ·
Logs · Settings with History beneath. Conversations get their own grouping
(Today / Yesterday / Earlier), the active one is marked, and the row menu
carries rename, re-run and delete.

*Test:* run three tasks, click each in the sidebar and confirm the conversation
comes back intact; rename one; search for a word that appears only inside a
message.

---

## Phase 4 — Reminders, schedules, and the slash commands

**Reminders** exist as a screen (`reminders_screen.dart`, 471 lines) with no
core behind it. The `schedules` table and a working `Scheduler` already exist —
a reminder is a schedule whose action is "tell the owner". Wire the screen to
it: create, list, snooze, complete, delete, with a Windows toast when one fires.

**Slash commands** — thirteen exist and most work; the palette is plain and the
set is not what Dex can do. Redesign it as a real command palette: fuzzy search,
grouped, keyboard-first, with a preview of what each will do. Cut what is dead
and add what is not there — `/find`, `/remind`, `/workflow`, `/route`,
`/session`, `/model`.

*Test:* set a reminder for two minutes' time and let it fire; open the palette,
type three letters, run a command entirely from the keyboard.

---

## Phase 5 — Connectors and accounts

**Chat channels.** Telegram, Discord and WhatsApp are implemented
(`channels/`) and start only when both a token and an owner id are present.
The Settings screen shows them but cannot configure them. Give it the pairing
flow: token in, owner id in, live status out, and a "send yourself a test
message" button that proves it end to end rather than claiming connection.

**Google Workspace.** The MCP spec is already in
`agents/workspace/servers.ts` (`uvx workspace-mcp`) with the OAuth credential
names mapped. What is missing is the sign-in: a button that runs the OAuth flow,
stores the tokens, and then lists the accounts and scopes that actually
resolved. Mail, calendar, drive, docs, sheets — through one connection.

*Test:* connect Google, then "what's on my calendar tomorrow" and "find the last
email from X"; connect Telegram and have Dex message you from your phone.

---

## Phase 6 — Your real browser, forked in

The most valuable and the most invasive, which is why it is last.

This gives Dex the browser you are already signed into — sessions, cookies,
extensions, history, bookmarks. It sidesteps the entire problem Dex has been
working around: VTOP, Instagram and every other logged-in site stop needing a
separate profile and a separate sign-in.

**Forked and bundled, not consumed.** OpenDia is MIT, © 2025 Aeon Inc, so this
is clean provided the licence and attribution ship with it — a `NOTICE` naming
the original, and its LICENSE kept beside the vendored code.

Its layout makes the fork easy and the decision obvious:

```
opendia-extension/   the Chrome extension, MV3
opendia-mcp/         a Node server: WebSocket 5555 to the extension,
                     stdio/SSE out to an MCP client
```

**We take the extension and throw the server away.** `opendia-mcp` exists only
to bridge the extension to an MCP client, and Dex's browser agent is already a
server. It hosts the WebSocket itself and the browser tools become ordinary
primitives beside `page_model` and `fill_form`. That removes a process, a
protocol and a port — but the real reason is different:

**Tools arriving over MCP would bypass Dex's safety machinery.** MCP tools are
opaque: they are called and they return. Nothing classifies them, nothing
assigns a confirmation tier, nothing verifies afterwards. "Post a tweet" would
just happen. As native primitives they go through the same path as every other
action — a Tier 2 card before anything consequential, verification after, the
untrusted-content rule around anything a page said. That is worth a fork on its
own.

What lands:

- **`extension/`** — the fork, rebranded, loaded unpacked from the repo. This
  part does not get simpler by forking: the extension still has to be installed
  in your browser and the browser still has to be running.
- **A WebSocket endpoint on the browser agent** for it to attach to, and its
  tool surface exposed as `can_browse_web` actions with tiers assigned.
- **Setup that admits what it needs.** Settings shows whether a browser is
  actually attached, because "connected" is a fact to check rather than assume.
- **A rule for which path to use** — the real browser when the task needs your
  session, the existing Playwright profile otherwise — stated in the routing
  rules so the planner chooses deliberately rather than by accident.

I will read their page-understanding and anti-detection work and keep whatever
beats Dex's own `page_model`, rather than carrying both because both exist.

**The two costs, plainly.** Forking means their anti-detection work for
Twitter, LinkedIn and Facebook becomes ours to maintain as those sites change —
upstream fixes stop arriving for free. And this is Dex driving the browser that
holds your bank and your email, where a page it reads could try to steer it:
the untrusted-content rule covers that and gets restated, but the blast radius
is now everything you are signed into rather than only what you signed Dex
into. You have asked for both — this is documentation, not an objection.

*Test:* with the extension attached — "post a tweet", "what's in my inbox",
"open my VTOP and get my attendance" with no separate sign-in; and confirm a
consequential action still raises a card.

---

## Files

**Phase 1** — `core/llm/providers.ts` · `core/orchestrator/orchestrator.ts` ·
`agents/system/system_agent.ts` · `app/lib/widgets/chat/step_row.dart`

**Phase 2** — `agents/files/indexer/` (new: crawler, extractors, OCR,
embeddings, watcher) · `core/memory/db.ts` · `agents/files/file_agent.ts`

**Phase 3** — `core/memory/conversations.ts` (new) · `core/memory/db.ts` ·
`core/server/ws_server.ts` · `app/lib/core/state/conversation_store.dart` ·
`app/lib/widgets/dex_sidebar.dart`

**Phase 4** — `core/scheduler/` · `app/lib/screens/reminders_screen.dart` ·
`app/lib/widgets/composer/slash_commands.dart`

**Phase 5** — `core/settings/settings_service.ts` ·
`app/lib/widgets/settings/tabs/connectors_tab.dart` · `account_tab.dart` ·
`agents/workspace/`

**Phase 6** — `extension/` (forked, vendored) · `NOTICE` · `agents/browser/bridge.py` (new) · `agents/browser/` (routing) ·
`core/brain/capabilities.ts`

**Tests** — a suite per phase, in the existing style: `test:index`,
`test:conversations`, `test:reminders`, `test:connectors`, `test:opendia`.

---

## Verification

Every phase ends green on `npx tsc --noEmit`, its own suite, the existing
`test:*`, `flutter analyze`, `flutter test`, and `npm run conformance` at 27/27
or better. Each phase is reported with what to test by hand before the next
begins.

## Housekeeping

`plan.md` and `phases.md` are written into the repo at the start of Phase 1 and
deleted when Phase 6 lands. Push to `claude` after each phase.
`origin/Sriram` stays untouched.
