# Testing Dex, phase by phase

What to type, and what should happen. Each section is one phase of work; the
prompts are the real ones that failed before it, so a section that passes is
evidence the thing it was written for is actually fixed.

**Before anything else, every time:**

```powershell
.\scripts\stop-dex.ps1     # nothing left over from the last run
cd app
flutter run -d windows
```

The core runs from TypeScript source, so it needs a **restart**, not a rebuild.
`stop-dex.ps1` first is not optional — the app attaches to a core that is
already running, so an old one survives an app restart and you end up testing
code from an hour ago. That is what happened three times while this was built.

The automated suites, if you want them:

```powershell
npm run typecheck
npm run test:index ; npm run test:artifacts ; npm run test:conversations
npm run test:reminders ; npm run test:connectors
npm run conformance
cd app ; flutter analyze ; flutter test
```

---

## Phase 1 — Speed, and failure you can read

**Time a simple request.**

```
what's my power plan
```

Should answer in a few seconds, not fifteen. Plan mode used to be on for every
prompt: measured at 13.2s and 9.7s with it, 6.6s and 6.8s without.

**Ask for something the vision tier does, with it switched off.**

Settings → make sure the Desktop agent is off, then:

```
look at my screen and tell me what window is in front
```

It should refuse **immediately**, name the tier, and give the one command that
starts it. What it must not do is spend fifty seconds discovering that a
process is not running.

**Watch a step finish.** Any task. Each step should end with a verdict and a
next line — `Verified — …  Next: step 2 of 3` — rather than a wall of
transcript.

---

## Phase 2 — Finding anything on this PC

The index builds in the background on first run. Names come first and are
usually complete in minutes; contents (text and OCR) fill in behind, and a
search says which pass it answered from.

**The two searches that failed.**

```
search for aadhaar card files in my pc
```

Expect the real ones — `OneDrive\Documents\aadhar.pdf`, the CrossDevice copy,
and the UIDAI file found through the "uid" synonym. Not resume PDFs, not a
video, not Android build artifacts.

```
UI.png file in my pc
```

Expect `OneDrive\Desktop\UI\UI INSPIRATIONS\UI.png` first, and the `D:` copy if
it is still there. Not `watch-quicklook-38@2x.png` — those matched because
"quicklook" contains the letters "ui".

**A file whose name says nothing.**

Rename a scanned document to something meaningless, wait for the contents pass,
then search for a phrase printed inside it. It should come back with **OCR
text** as the reason and the matching line as evidence.

**Scope.**

```
find my resume
```

Should search your profile, not Downloads. The old default was Downloads, which
is why "in my pc" searched one folder.

**What was left out.** The card says "N weaker matches not shown". That number
should be non-zero on a vague query and zero on a precise one.

---

## Phase 3 — History that is a record

**Open a conversation.** Run two or three tasks, then click a row in the
sidebar's History. It should **open** the conversation — every message, every
step card, the artifact cards — not re-run the request.

**Re-running is now deliberate.** Hover a row, open its menu: Rename, Run
again, Delete. Only "Run again" re-runs it.

**Rename one.** The sidebar should show the new name. Clear the name and it
falls back to the first thing you said.

**Search inside messages.**

```
/history <a word only Dex said, never you>
```

Task history could never do this: the answer to "what was that path Dex gave
me" is in a reply, not a request.

**Delete one.** The conversation goes; the task record stays, because that is
what the planner learns from.

**New chat** starts a new thread rather than only clearing the screen. The old
one is still in History.

---

## Phase 4 — Reminders that ring, and the palette

**A reminder that actually fires.**

```
/remind 2m testing this
```

Minimise Dex and wait two minutes. A **Windows toast** should appear — raised
by the core, so it reaches you whether or not Dex is the window in front of
you.

**It survives a restart.** Set one for later, close Dex completely, reopen it.
The reminder is still there. Previously it lived on a Dart object and was gone.

**Overdue means overdue.** Set one for a minute from now, then close Dex before
it fires and reopen a few minutes later. It should ring on the way up — a
missed "leave for the dentist" is the whole reason you set it.

**Snooze.** Let one go off, press snooze, and confirm it comes back. Snoozing
clears the fired mark, or the guard that stops a reminder ringing twice would
stop the snoozed one coming back at all.

**Other forms.** `/remind 17:30 leave`, `/remind 5pm gym`, `/remind 1d renew
the pass`. And `/remind sometime soon do the thing` should be **refused** with
what it understands, not guessed at.

**The palette.** Type `/`:

- grouped while browsing, ordered by relevance once you type
- `wkf` finds `/workflow`, `hsty` finds `/history` — half-remembered names work
- ↑↓ moves, Enter runs
- no command opens a dialog saying it is not built yet

---

## Phase 5 — Connectors and accounts

Nothing here was tested against a live account while it was built, so this is
the first real run.

**Pair Telegram.** Settings → Connectors → Telegram → expand. Paste the token
from BotFather and your user id (message `@userinfobot` to find it) → **Save
and connect**. The row should go green **without restarting the core**.

**Prove it.** Message your bot once first — Telegram will not let a bot open a
conversation — then press **Send a test message**. A message should arrive on
your phone.

**Then use it.** From your phone, message the bot:

```
what's my battery level
```

It should answer there. This is the part the old code could never have done:
the OwnerGate was reading an environment variable nobody had set, so it would
have rejected you.

**Unpair.** Clear the owner id and save. The row goes back to unconfigured
immediately.

**A failure should name itself.** Try the test with a wrong user id. The
message should say Telegram will not let a bot message you first, or that the
chat was not found — not "could not send".

**Accounts.** Connectors → Accounts → **Test the connection**. Expect either a
list of tools with the account it connected as, or a named reason: the runner
is not installed, or the account has not been authorised. It takes a few
seconds because it really starts the server.

---

## Phase 6 — Your real browser

This one needs installing before it can be tested.

**Load the extension.** `chrome://extensions` → Developer mode → **Load
unpacked** → pick the `extension/` folder. Firefox: `about:debugging` → This
Firefox → Load Temporary Add-on → `extension/manifest-firefox.json`.

**Check it attached.** Settings → Connectors. It should say a browser is
attached and how many tools it registered. If it says nothing is attached, the
browser agent is not running — Settings → Connectors will say that too.

**A read, which needs no card.**

```
what is on the page I have open right now
```

Should answer from the tab in front of you, with no confirmation card. Dex's
own browser could not have answered this at all — it has different tabs.

**Something only your browser can do.**

```
open my vtop and get my attendance
```

No separate sign-in, because it is the browser you are already signed into.
This is the whole reason for the phase.

**A click should ask first.**

```
open my twitter and post "testing dex"
```

Expect a confirmation card **before** anything is posted. On a site you are
signed into, a click sends, posts or buys, and nothing in the page reliably
says which — so it asks. Decline it and nothing should happen.

**Your history is not a free read.**

```
what did I look at yesterday
```

Should ask once before reading your browsing history, then remember the
answer.

**Routing.** A public page should still use Dex's own browser:

```
get the top story from news.ycombinator.com
```

That runs in the separate profile, which cannot touch your session. Only tasks
that need to *be you* go to your browser.

**Close the browser mid-task.** Start something, then quit the browser. The
step should fail at once saying the browser went away — not sit for a minute
waiting for an answer that is not coming.

---

## When something looks wrong

**The change did not take effect.** Almost always an old core still running.
`.\scripts\stop-dex.ps1`, then start the app. It checks the named pipe
afterwards, because whether something answers is the only honest answer to "is
it still running".

**A search finds nothing it should.** Check how far the index has got:

```powershell
python -c "import sys; sys.path.insert(0,'agents/files'); from indexer import store; print(store.stats())"
```

`pending` is how many files have been recorded by name but not yet read. A
content match cannot work until that reaches zero.

**Two conformance probes fail on clipboard.** The daemon predates the change.
`stop-dex.ps1` and start again.

**Logs.** Settings → Logs, or `%LOCALAPPDATA%\DEX\logs`.
