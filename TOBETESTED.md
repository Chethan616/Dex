# To be tested

Written 2026-09-18, updated 2026-09-19 after your real-app test pass, and
updated again 2026-09-19 when `feat/file-search` was merged into this
branch. This is **branch `feat/os-registry-tools`** (off `v3/dex`), now
carrying dex-sh, dex-registry, the deck/confirmation-card fixes, the
redesigned `/bugbounty`, AND file search (`dex-find`, `@drive`) all
together — separate from `fix/browser-toggle-blank-screen` and
`feat/desktop-uia-cua`, which are not merged in yet and still have their own
`TOBETESTED.md`. None of this is pushed anywhere yet.

## 2026-09-19 — what your test run actually found, and what I fixed

Your 7-test pass on the real app (screenshots 23-30) found the confirmation
card never appeared under any scenario, and the Activity/Browse toggle did
nothing after a page had loaded. Two separate root causes, both now fixed:

**1. The deck was starving, not broken.** `SessionManager.appendOutput` (main
process) pushes every event — `tool_call`, `artifact`, `screenshot`,
`confirmation`, `task_state` — onto `session.output` and streams it to the
floating Logs window over a per-event channel (`session-output`). But it only
broadcasts the *full* session object to the main app window
(`session-updated`) for a handful of coarse cases: cost rollups, stuck-timer
recovery, pause, navigation. Ordinary tool calls and — critically —
confirmation events never triggered that broadcast. The main window's session
cache (`useSessionsQuery.ts`) only listened to the coarse channel, so
`AgentSession.output` — what the deck, `hasPendingConfirmation`, and the
Activity card all read — was frozen at whatever it was on the last full
fetch. This is why the Logs popup (screenshots 23-25, which you said you
usually run fullscreen) showed everything correctly while the main pane next
to it stayed black: two different code paths, only one of them wired up.
Fixed by having the main window's query cache also subscribe to the
per-event channel and append into the matching session's `output` live.

**2. The Activity/Browse toggle was a dead button once a page had loaded.**
The old logic was `deckActive = ... && !browseHere && (!primarySite || ...)`
— a plain boolean that could only ever *take the deck away*, never force it
back once `primarySite` was set. Clicking "Activity" mid-browser-task (your
test 6) flipped a flag that the formula didn't check in that branch, so
nothing happened. Replaced with a tri-state override (`auto` / `browser` /
`activity`) that genuinely wins either way, with a pending confirmation still
overriding it in both directions (you can't accidentally hide a card behind
"Browse").

**3. The agent likely never called `dex-registry` at all** — your own
screenshots show tool calls labeled `PowerShell` running
`Get-ItemProperty`/`Set-ItemProperty` directly, for both the read and the
"THIS SHOULD NOT HAPPEN" write, with no exit code or behavior suggesting
`dex-registry` was in the loop. Doctrine already said not to do this, but
only called out `reg.exe`/Bash specifically, not PowerShell's own registry
cmdlets or its own native `PowerShell` tool. Strengthened `registry.md` and
`AGENTS.md`'s routing table to name the exact cmdlets and say explicitly that
this applies to *any* shell tool, including reads.

None of this is enforcement — an agent can still ignore the skill doc, same
as before. What's fixed is that *if* it does call `dex-registry`, the card
will now actually render, live, in the main window, not just the Logs popup.

(Superseded by the 2nd pass below — the card doesn't live in the deck
anymore, so the "does Activity show it" checklist item no longer applies the
way it's phrased here.)

## 2026-09-19, second pass — after your explicit-tool-name test (screenshots 31-34)

Naming `dex-registry` explicitly worked — your log shows it reading
`registry.md`/`SKILL.md` and actually calling `dex-registry set`. That
confirmed fix #3 above is enough *when the tool is named*, and surfaced two
more real bugs underneath it:

**4. The card was still invisible — but this time because of what's ON TOP,
not because the data never arrived.** `.pane__output` (where the deck
renders) is contested by two things that both composite above plain React:
the native browser view once a page has loaded, and the floating Logs window
whenever it's open (it anchors to that exact same rect). Your registry-only
test (31-no-card.png) had the Logs window open, which sits on the identical
screen region the deck would use — so even though the confirmation event had
arrived correctly (fix #1), there was nothing wrong to see: the card was
rendering right where the Logs window was drawn on top of it. This is
exactly the same class of problem as your browser screenshot (31.png/34.png)
— the live Google page sitting on top of it — just with a second surface
doing the same thing. **Fixed by moving the confirmation card out of the
deck entirely**, into the pane's header/chrome area, which neither the
browser view nor the Logs window ever touches. It now renders as a strip
right under the status line, always, regardless of what's showing in
`.pane__output` — Browse, Activity, or Logs open. As a consequence, a
pending confirmation no longer forces the deck over the live page either
(test 6's original complaint) — there's no need to hide the browser to
answer a card that's no longer inside the area the browser covers.

**5. A real bug behind "switch sidebar away and back, then the
Activity/Browse button and everything behind it just vanishes."** The effect
that attaches/detaches the native browser view tracked "is a view currently
attached" in a plain local variable that got reset to its default every time
the effect re-ran — which happens on any `deckActive` change, *and* on the
`pane:layout-change` event the app fires when you switch sessions in the
sidebar. So the code would forget a view was already attached, skip the
`viewDetach` call it needed to make, and the pane would end up in a state
neither "browser" nor "deck" correctly claimed — consistent with everything
past the Logs window going blank. Fixed by moving that bookkeeping into a
ref that survives the effect being torn down and rebuilt, so it correctly
remembers attach state across any of these transitions instead of just the
first one.

I could not fully confirm #5 explains 100% of what you saw in 34.png without
reproducing it live — it's the strongest lead from reading the code, not a
verified root cause the way #1-#4 are. Worth specifically re-testing.

- [ ] Re-run a registry `set` **with the Logs window open** and confirm the
      approval strip now shows above/around it instead of being covered.
- [ ] Re-run test 6 (registry prompt mid-browser-task) — the live page
      should now stay visible, with the approve/deny strip appearing above
      it in the header, not replacing it.
- [ ] Specifically re-test the "switch to another agent in the sidebar, then
      switch back mid-task" scenario from 34.png and confirm the
      Activity/Browse button and the pane's behavior come back correctly. If
      it still breaks, that's a new lead, not something fix #5 above already
      covers, and I'll need fresh screenshots of that exact sequence.

```
git checkout feat/os-registry-tools
cd desktop/app
yarn
npx electron-forge start
```

## dex-sh — a cross-shell wrapper

I live-tested all four shells directly (bash, cmd, powershell, wsl) plus the
timeout path. What I couldn't test: the agent actually reaching for it when
it should.

- [ ] Ask DEX to do something that's genuinely easier via `cmd` or
      `powershell` builtins than Bash (e.g. reading a Windows service's
      status, or a WMI-ish query) and see whether it uses `dex-sh` rather
      than fighting Bash-isms for something Windows-native.
- [ ] Force a failure in one shell and see whether it retries through
      another using the exit code / stderr `dex-sh` gives back, per the
      "diagnose and retry on a different shell" verify criterion in the
      plan — this is a judgment call by the agent, not something I could
      test statically.

## dex-registry — read freely, write only with your approval

This is the one built specifically to need YOUR click, not just testing.
I verified the whole mechanism end to end myself using a mock control
server (so I could simulate both an "approve" and a "deny" answer without
a real running app) against a fully disposable `HKCU\Software\...` test
key — never anything you have on this machine already:

- Read/get/search/export against a real key, correct results
- **A real bug I found and fixed**: `search` was materializing an entire
  subtree before applying its own result limit — a search rooted at
  `HKCU\Software` took about 90 seconds for one hit. It's a bounded,
  early-terminating walk now: same search, under half a second.
- **Another real bug I found and fixed**: `reg.exe export`/`import`
  succeeding was being reported as a failure, because redirecting a native
  command's stderr inside PowerShell wraps it in an ErrorRecord regardless
  of the actual exit code, and `$ErrorActionPreference = "Stop"` turned
  that into a thrown exception. `reg.exe import` actually restored the key
  correctly the whole time; only the JSON result lied about it.
- Full backup → delete → restore round-trip, confirmed byte-for-byte via
  read-back
- The full confirm-flow plumbing: `set` with a mocked "approve" actually
  wrote the value; `delete` with a mocked "deny" left the key completely
  untouched, exit code 1, correct error message

What I could NOT test without the real app running: **the actual
confirmation card rendering and being clickable in the UI**. I wired
`ConfirmationCard` into `PreviewDeck`, the IPC round trip
(`window.electronAPI.dex.confirmAnswer`), and the stuck-timer suspension
(unit-tested with fake timers, not a real 30-second wait) — but none of
that proves the card actually *looks right* or that clicking Approve/Deny
in the real window does what the code says it does.

- [ ] Ask DEX to make some harmless registry change (a value under your own
      `HKCU\Software`, not a system key) and confirm:
  - [ ] A card appears in the preview pane with a plain-language description
        of exactly what will change, and it reads clearly — this is a first
        design pass, not something I could iterate on without seeing it.
  - [ ] **Approve** actually applies the change; **Deny** actually blocks it
        (the mock testing proved the plumbing works; this proves the UI
        wired to it does too).
  - [ ] The card shows up even if you're mid-browser-task when it fires —
        I added an override so the deck forces itself up over a live page
        for this specific case, but haven't seen it happen live.
  - [ ] The session does NOT get marked "stuck" while the card sits
        unanswered for longer than 30 seconds (take your time on purpose).
- [ ] Confirm the backup file's path shown in the card is one you can
      actually go look at afterward (under `%TEMP%\dex-registry-backups\`
      by default).
- [ ] Try denying a change and confirm DEX's own follow-up response
      acknowledges the denial sensibly rather than retrying the same write
      immediately or claiming success.

## Known, disclosed gaps (not bugs — deliberate scope calls)

- `import` does not auto-back-up (a `.reg` file's blast radius isn't known
  without parsing it) — the skill doc tells the agent to `export` anything
  it expects the import to touch first, but nothing enforces that.
- `dex-registry search`'s depth cap (10) and early-exit-on-maxResults bound
  the walk, but a query with *no match* under a very broad root can still be
  slow in the worst case — it just won't be catastrophically slow the way
  the pre-fix version was.
- Nothing technically stops the agent from touching the registry directly —
  `reg.exe`, or PowerShell's own `Set-ItemProperty`/etc. — through its own
  Bash *or* PowerShell tool instead of `dex-registry`, bypassing the
  confirmation entirely. This is doctrine (`registry.md`/`AGENTS.md` now name
  the exact cmdlets and tools), not sandboxed enforcement — the same category
  of gap as MCP-first and the desktop-control fallback ladder elsewhere in
  AGENTS.md. Your 2026-09-19 test run is the concrete case of this happening.
- `hasBrowser` (from the separate `fix/browser-toggle-blank-screen` branch)
  may have a second gap: `sessions:list`/`sessions:get` in `main/index.ts`
  compute it fresh via `!!browserPool.getWebContents(id)`, which is true for
  virtually every session (a view is created for every task regardless of
  type) — a periodic refresh of the session list could re-introduce the
  "Continue browsing" button for a non-browser task even after that fix.
  I found this while reading nearby code for this branch's confirmation
  route; I have NOT fixed it, since it lives in a different branch and
  wasn't what I was asked to do here. Worth a fast follow-up.

---

# File search (merged from `feat/file-search`, 2026-09-19)

Everything below was written 2026-09-18 on the separate `feat/file-search`
branch, before it was merged into this one. It needs no separate checkout
anymore — `dex-find`, the `@drive` mention UI, and the file cards are all
now part of this build. `fix/browser-toggle-blank-screen` referenced below
is still a separate, unmerged branch.

---

## 1. File search (`dex-find`) — branch `feat/file-search`

First launch after this ships starts a **background index** of `C:\` and
`D:\` automatically (metadata scan first — fast; content extraction — slow,
throttled). Give it a few minutes before judging content-search results;
filename search should work almost immediately.

- [ ] **Basic filename search** — ask DEX to find a file you know exists by
      name.
- [ ] **Content-only search** — ask for a file by a word that's in its
      *content* but not its filename (e.g. a course name inside a PDF whose
      filename is just a code). Should surface with a reason like `"X" in
      contents` and an excerpt.
- [ ] **Acronym/initialism matching** — ask by an acronym (e.g. "CNS", "SLP")
      where the file spells the term out in full. This was the hard case the
      whole ranking design was built around — worth specifically confirming.
- [ ] **`@drive` OFF by default** — ask DEX to find something without tagging
      `@drive`. Confirm no Google Drive MCP call happens (check logs).
- [ ] **`@drive` ON** — connect Google Drive in Settings, then ask with
      `@drive` in the request. Confirm both local and Drive results come
      back, and it's one round trip, not two turns.
- [ ] **`@drive` without Drive connected** — same as above but Drive
      disconnected. Should still return local results plus a `driveError`,
      not a hard failure.
- [ ] **Index freshness** — create a file with a distinctive word, wait a
      minute, search for it. Edit it to a different word, wait, search again
      — confirms edited files get re-indexed, not served stale.
- [ ] **Unsupported/huge files** — search for something only in a `.exe` or a
      huge video; should show in filename-only results (or not appear if you
      didn't search the name), never error.

## 2. `@` mention UI (real inline chip) — branch `feat/file-search`

- [ ] Type `@dr` in each of the 4 inputs — dashboard, `Ctrl+Shift+Space`
      overlay, follow-up under a running agent, logs-window follow-up.
      Confirm the dropdown offers "drive" in all 4.
- [ ] Pick it (click, Tab, or Enter) — confirm it renders as an actual
      **blue/bold pill**, not plain text, and sits correctly **inline
      mid-sentence** (type words before and after it).
- [ ] Backspace immediately after the chip — should remove it as one atomic
      unit, not character-by-character. **This is the one behavior jsdom
      genuinely cannot simulate** — needs your hands specifically.
- [ ] Normal typing feel — nothing should feel laggy or broken compared to
      before (this replaced the plain `<textarea>` with a contentEditable
      field in all 4 surfaces).
- [ ] Shift+Enter for a newline still works; plain Enter still submits.
- [ ] Paste, drag-and-drop file attachment, and the `[Image #N]` token
      insertion in the follow-up-under-agent input still work.
- [ ] Pill overlay specifically: confirm the popup window still resizes
      correctly as you type multi-line content (this used to read the
      textarea's `scrollHeight` directly; now it's reported through a
      callback).

## 3. File cards with colored type badges — branch `feat/file-search`

`dex-find` results, the "reading a file" card, the plan's produced-files
row, and the activity fallback's file row all now render as a grid of
compact cards (badge + name) instead of plain-text rows/buttons.

- [ ] Run a file search and confirm results show as a **wrapping grid of
      cards**, each with a small colored tag (PDF red, DOC blue, XLS green,
      PPT orange, IMG accent-blue, generic gray) and the filename.
- [ ] Confirm click-to-reveal-in-Explorer still works on each card.
- [ ] Confirm the hover-to-copy-path button still appears (top-right corner
      of the card now, not the row's trailing edge).
- [ ] Check readability at both a narrow and a wide pane width — the grid
      should reflow, not overflow or leave one giant stretched card.
- [ ] Confirm light theme still reads fine (the color tokens are shared with
      the rest of the app's status colors, but worth a look).
- [ ] This is a first pass at "Claude/ChatGPT-style" — if it still doesn't
      feel right once you see it live, say specifically what's off (spacing,
      colors, information density, card size) rather than "make it neater"
      — that's the fastest way to the next iteration.

## 4. Blank preview deck / wrong browser button — branch `fix/browser-toggle-blank-screen`

This is the fix for what you saw in `tested/21.png` and `tested/22.png`.

- [ ] Run a **non-browser task** (filesystem search, PowerShell, desktop
      task). Confirm the **"Continue browsing" toggle no longer appears** in
      the pane header — it should now only show once a task has actually
      navigated a real page.
- [ ] Confirm the pane shows **something** during and after a non-browser
      task — at minimum the `ActivityCard` (elapsed time, action count, file
      count) — instead of a blank canvas.
- [ ] Run a **real browser task** and confirm "Continue browsing" still
      appears once it navigates, and still works as before (attaches the
      live view, lets you take over).
- [ ] If you still hit a blank canvas anywhere after this fix, that's a
      second, different bug — the `hasBrowser` gate was the one confirmed
      root cause, not necessarily the only one.

---

## Known, disclosed gaps (not bugs — deliberate scope calls)

- File index backfill runs as a throttled loop in the main process, not a
  `worker_threads` pool (simpler; can revisit if it's ever a CPU problem).
- No fuzzy/typo-tolerant filename matching (trigram index) — wasn't needed
  for either hard case the ranking design targeted.
- `hasBrowser` isn't persisted to the DB yet — a resumed session after an app
  restart reverts to "unknown" until its next real navigation. Smaller gap
  than the one just fixed.
- The artifact/file-reference cards work but don't yet look like
  Claude/ChatGPT's file cards — that's the next thing being built.
