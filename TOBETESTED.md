# To be tested

Written 2026-09-18. Everything below lives on **unmerged feature branches** —
none of this is in the build you're currently running. To test any of it:

```
git checkout feat/file-search      # file search + @drive UI
# or
git checkout fix/browser-toggle-blank-screen   # the blank-screen fix (based on v3/dex, not feat/file-search)
cd desktop/app
yarn                                 # if node_modules is stale
npx electron-forge start
```

`feat/file-search` and `fix/browser-toggle-blank-screen` are **separate
branches off `v3/dex`** — the blank-screen fix is NOT currently included when
you check out `feat/file-search`. Merge order doesn't matter (they don't
touch the same code), but you'll want both merged into `v3/dex`/`main`
eventually. Nothing has been pushed to any shared branch yet — only committed
locally.

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
