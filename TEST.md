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

## Phase 7 — The browser that is yours

Everything here needs the Dex extension loaded in the Chrome profile you
actually use. Check first:

```powershell
curl http://127.0.0.1:8766/extension/status
```

`attached: true` and 26 tools means it is working. If it says nothing is
attached, load it once — `chrome://extensions` -> Developer mode -> Load
unpacked -> `<repo>\extension` — or run
`scripts\install-extension-policy.ps1` as administrator to force-install it
permanently.

**Rebuild everything.** `npm run rebuild`. It stops Dex, installs anything
missing, typechecks the core, builds the app, repacks the extension when the
extension changed, and starts it. `npm run rebuild:fast` skips the Flutter
build. It never force-kills Chrome — that is what discarded an extension
install before.

**It uses your profile now.** Ask for anything on a site you are signed into —
*"what are my pinned repos on github"*. It should answer from your account, not
from a logged-out page, and it should not open a second unfamiliar Chrome. If
no browser is attached, Dex opens yours rather than refusing.

**The panel follows the task.** Type *"open my github profile"* in the app. The
Dex panel should appear in Chrome and the steps should run there, beside the
page. `/browser <something>` sends a turn straight to the panel.

**The panel is a real client.** In the panel, type a task and press Stop
mid-run — it should actually stop, not sit there. Then look in the app's
history: the panel's turns should be in the same conversation.

**Uploading a file.** *"find aadhar.pdf and compress it on a PDF site."* Watch
for the upload: no file dialog should appear at all. Chrome may show a
"Dex started debugging this browser" bar while it works — that is the
capability being honest about itself, and the policy script silences it.

**The whole chain.** *"Find aadhar.pdf, compress it on a PDF website, save the
result to D:\Documents, and open it in Acrobat."* Four tiers in one plan, and
the file path travels from the browser step into the file step into the app
step. If the browser part works and the move does not, the reference is the
thing to look at — `{{step_N.output.downloads[0].path}}`.

**Failure that stops flailing.** Ask for something on a site that will not
cooperate. It should try once, replan once, and stop — and it should tell you
what the earlier steps *did* find rather than one red line. It should never
answer a browser problem by opening Chrome as a window.

---

## Phase 8 — One web step, one session

**The task that used to fail.** *"open github and change my status."* Watch the
plan card: it should be **one** step, not an `open_browser` followed by a
`run_task`. One Chrome window, and it finishes.

**Count the windows.** Before and after, in PowerShell:

```powershell
@(Get-Process chrome -ErrorAction SilentlyContinue).Count
```

It must not grow by more than the one window the task needed. A second window
appearing on the second step is the exact bug this phase removes.

**With Chrome already open.** Open Chrome yourself, then run the same task. Dex
should use the window that is there and launch nothing.

**The bridge stays up.** This was the real cause: Chrome kills an idle extension
service worker after thirty seconds, and the extension had reconnect switched
off. Leave Dex idle for two minutes, then run a web task. It should work with no
delay and no new window. To watch it directly:

```powershell
Get-Content "$env:LOCALAPPDATA\DEX\browser.log" -Tail 20 -Wait
```

`the browser disconnected` about thirty seconds after attaching is the old
behaviour. It should not happen now, and if the socket does drop it should
reconnect on its own within a minute.

**A long task.** Something needing fifteen-plus turns. It should still know what
it was asked for at the end rather than drifting — the older turns are
summarised into the prompt instead of being dropped.

**The knowledge.** Run the status task twice. The second run should be visibly
shorter: what the first run found out about that site is handed to the second
rather than rediscovered.

**Verification that says something.** A web task that changes nothing while
being asked to change something should now report a failure, not "done,
unverified".

---

## Phase 9 — One browser agent, and it knows whether it worked

**The task that kept failing.** *"Open github and remove the repo named Qwix
from my repo pins."* Three things to watch:

- the plan card shows **one** step, not six
- no sign-in page opens, and no second browser
- if it cannot do it, it says so — a red step, not a tick

**Never a sign-in step again.** Dex is already signed in to your sites in your
own browser, so a plan should never contain `sign in`, and neither should it
contain `wait for`, `map page` or `click` as steps. Those are the agent's tools
now, used with the page in front of it. If you ever see one in a plan card,
that is a regression.

**It has to show its work.** Ask for something that cannot be done — unpin a
repo that is not pinned. It should come back saying so, and the step should be
red. A run now has to name what on the page proves it succeeded; a run that
claims success without naming anything shows as *"says it succeeded but could
not say what shows it"* rather than a tick.

**Speed.** The step should be noticeably quicker than the ~1m53s it used to
take. A turn is a model call at about five and a half seconds, and the loop now
puts several actions in one turn instead of one.

**Going in circles.** If a page will not cooperate, the agent should try
something different rather than the same click three times. Look at the step
list: the same tool on the same element more than twice over is the old
behaviour.

**Signed out.** Sign out of a site, then ask Dex for something on it. It should
hand the browser to you — the window already open — and carry on after you sign
in. It must never open a second browser to sign in to.

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
