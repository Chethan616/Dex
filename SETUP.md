# Dex — Setup and Running

Everything you need to get Dex running on a Windows machine, and everything you
need to know while working on it.

> **Read [SAFETY.md](./SAFETY.md) before turning on Full Access.** Dex can
> change system settings, run commands and drive applications. The rules it
> holds itself to are in that file, and they are the reason it is safe to give
> it those powers.

---

## Running it

Open the Dex app. That is the whole thing.

The app starts everything it needs — the core, the privileged daemon, the app
agent and the browser agent — and shows each one starting on the splash screen.
A warm machine takes about a second; a cold one takes a few. Nothing is left
running that Dex did not start, and nothing survives it: every child process is
in a Windows job object that dies when the app does.

From a checkout, in development:

```powershell
cd app
flutter run -d windows
```

Or the built executable:

```powershell
.\app\build\windows\x64\runner\Release\dex.exe
```

### Without the app

Useful when working on the core, or when you want the `dex>` prompt:

```powershell
# core in the foreground, with a REPL
npm run dev

# everything, headless, no UI
.\RUN.bat -NoUi
```

### Stopping it

Closing the app stops everything it started. To be sure — after a crash, or when
processes are left over from a development session:

```powershell
.\scripts\stop-dex.ps1
```

It stops the daemon's scheduled task, kills what it can see, and then **checks
the named pipe**, because whether something answers is the only honest answer to
"is the daemon running".

---

## 1. What Dex needs

| | version | why |
|---|---|---|
| **Windows** | 10 or 11 | UI Automation, DPAPI, the registry — Dex is Windows-native |
| **Node** | 24+ | the core keeps its memory in `node:sqlite`, which older versions lack |
| **Python** | 3.11+ | the daemon and the three agents |
| **Flutter** | 3.24+ | the app |

Check all four:

```powershell
node --version; python --version; flutter --version
```

An **LLM provider** is the only other requirement. Dex plans with a model; it
does not run without one. Options are in §4.

---

## 2. First run

```powershell
git clone https://github.com/Chethan616/Dex.git
cd Dex
npm install

cd app
flutter pub get
flutter run -d windows
```

On first launch the splash screen shows each process starting. If one fails it
says why and offers **Try again** and **Continue anyway** — a Dex that opens and
tells you what is broken beats a splash screen you cannot get past.

Then open **Settings → Intelligence** and choose how Dex plans (§4).

### There is no .env

Configuration lives in `%LOCALAPPDATA%\DEX\settings.json`, written by the
Settings screen. Secrets live in the Windows credential store (§5). Nothing
reads a `.env`, and creating one will not change anything — a second source of
truth beside the real one is how Settings ended up showing one model while the
core planned with another.

---

## 3. Python components

```powershell
pip install -r daemon/requirements.txt
pip install -r agents/app/requirements.txt
pip install -r agents/browser/requirements.txt
python -m playwright install chromium
```

The app starts these for you. Run one by hand only when you are working on it:

```powershell
python daemon/DexDaemon.py          # named pipe, no port
python agents/app/server.py         # 8767 — UI Automation
python agents/browser/server.py     # 8766 — the web
python agents/desktop/server.py     # 8765 — vision, optional
```

Each answers `/health`:

```powershell
curl http://127.0.0.1:8767/health
```

---

## 4. How Dex plans

**Settings → Intelligence.** Two tiers.

**Claude Code (recommended).** No API key. If you have a Claude subscription and
the `claude` CLI signed in, Dex plans with it and there is nothing extra to pay.

```powershell
npm i -g @anthropic-ai/claude-code
claude          # sign in once, then close it
```

Pick a model in the same screen. **Haiku** is the default and is enough for
almost everything — the CLI's own start-up dominates the time, not the model.
Measured here: a simple request plans in about 13 seconds on either Haiku or
Sonnet.

**An API key.** Groq or Anthropic. Faster than the CLI, because there is no
subprocess to start, and the right choice if planning latency matters. Paste the
key into Settings, or:

```powershell
npm run cred -- set groq_api_key
npm run cred -- set anthropic_api_key
```

A large plan through the CLI can take over a minute. Dex emits a
"still planning" line every fifteen seconds so a long wait is visibly a wait.

---

## 5. Credentials

Secrets are encrypted with **DPAPI, CurrentUser scope** in
`%LOCALAPPDATA%\DEX\credentials`. The ciphertext is bound to your Windows
account on this machine: copied elsewhere, it decrypts to nothing.

```powershell
npm run cred -- list
npm run cred -- set groq_api_key
npm run cred -- delete groq_api_key
```

### Signing Dex in to a site

**Settings → Intelligence → Site sign-ins.** For a portal you use often.

Dex fills the credential **on that exact host and nowhere else** — not on a
subdomain, not on a lookalike domain, not on a page that redirected somewhere
else. The password is read by the agent process at the moment of typing, so it
never appears in a prompt, an event, the transcript or the telemetry database.

**You still solve the CAPTCHA.** It is the site's control against automation
rather than yours to waive, so Dex does the typing and hands you the last step.
Because the session is then kept in Dex's own browser profile, that is once a
day rather than once a task.

`type_text` still refuses every password field it is pointed at. Only a plan
step named `sign_in` can fill one, and only from a credential you stored by
hand.

---

## 6. Full Access

**Settings → Intelligence → Permissions.**

Off, Dex asks before every privileged step. On, it does not — but only once the
daemon is genuinely running elevated. Configured-but-not-elevated is the worst
state available, so Dex reports it and falls back to asking:

```
[Full Access] ON   elevated, session 1, confirmations bypassed, RED locked
[Full Access] OFF  configured, but the daemon is not elevated — using cards
```

Turning it on registers a scheduled task that starts the daemon elevated at
logon, in your session. One UAC prompt, once.

The toggle is deliberately inert until you move the mouse. Raising a window on
Windows injects a synthetic click at the cursor, and that click has flipped this
control before.

**Full Access does not unlock everything.** Elevation decides *who is asked*; the
band decides *what is possible at all*. The RED registry band and RED commands
stay refused, and a Tier 1 hand-off — a password, a CAPTCHA — still reaches you,
because Full Access cannot give Dex eyes.

Reaching the RED band needs an explicit flag and still confirms every time:

```powershell
$env:DEX_ALLOW_RED = 'true'          # registry
$env:DEX_ALLOW_SHELL_RED = 'true'    # commands
```

### Only one daemon, ever

Several daemons can serve one named pipe, and Windows hands each request to
whichever is free — so the same command works, then does not, with nothing
having changed. The daemon claims its pipe with
`FILE_FLAG_FIRST_PIPE_INSTANCE`, so a second one fails to start rather than
joining the rota. If something is misbehaving, check:

```powershell
Get-ChildItem \\.\pipe\ | Where-Object Name -eq 'dex_privileged_daemon'
```

---

## 7. Logs

Everything writes to `%LOCALAPPDATA%\DEX\`:

```
core.log      planning, routing, task outcomes
daemon.log    every privileged call, with its arguments
app.log       UI Automation
browser.log   the web agent
desktop.log   the vision agent
```

**Settings → Diagnostics** shows them live, filtered by level, time and text.

---

## 8. Channels (optional)

Talk to Dex from your phone. Each needs a bot token *and* your own id on that
platform — without the id the bot would reject every message, so Dex refuses to
start it and says so.

```powershell
npm run cred -- set telegram_bot_token
$env:DEX_OWNER_TELEGRAM = '123456789'
```

WhatsApp pairs by QR instead of a token:

```powershell
$env:DEX_WHATSAPP = 'true'
$env:DEX_OWNER_WHATSAPP = '919876543210'
```

---

## 9. Tests

```powershell
npx tsc --noEmit        # types
npm test                # every suite
npm run conformance     # every advertised action, against the real daemon
cd app; flutter test    # the app
```

One suite at a time — the names are in `package.json`:

```powershell
npm run test:policy       # the command band classifier
npm run test:site-creds   # a credential is offered to one host and no other
npm run test:routes       # remembering the way around a site
npm run test:repair       # a failed step repairs the plan
npm run test:autosave     # a task that worked becomes a reusable script
npm run test:backlight    # keyboard lighting, detected before it is touched
```

### The conformance harness

The one that matters most. It runs **every action Dex advertises** against the
real daemon on the real machine, and fails the run if an advertised action has
no probe. That rule is why a round of written-but-never-executed actions was
caught rather than shipped.

```powershell
npm run conformance
npm run conformance -- --destructive   # includes the ones that change things
```

### On writing tests here

A test that mocks the thing it is testing proves nothing. `data/dex.db` once
held two `set_dns` tasks marked COMPLETED, written by a suite running against a
mocked agent, for an action that had never reached the daemon — so anyone
reading the history to find out what actually worked was reading fiction.

Tests are isolated from the real store. Put this first in any new suite:

```typescript
import './support/isolate';
```

---

## 10. Working on Dex

### Layout

```
core/          planning, orchestration, verification, memory
  brain/         the planner and the capability catalogue
  orchestrator/  runs the plan; step outputs; repair
  memory/        tasks, workflows, site routes
agents/        the specialists
  system/        Tier 1 — the privileged daemon's client
  app/           Tier 2 — UI Automation
  browser/       the web, and signed-in sites
  files/         the filesystem, images, documents
daemon/        the elevated process. Everything privileged happens here
channels/      CLI, Telegram, Discord, WhatsApp
app/           the Flutter app, and the supervisor that starts everything
tests/         including conformance/, which runs against the real machine
```

### The rules that matter

**A return value is a claim, not proof.** Every step is verified against the
world afterwards — the file exists, the control reads back, the site reports a
session. An action that says it worked and did not is the failure this whole
system is shaped around. Adding an action means adding its verification.

**If an API can do it, it is not a job for the UI.** Dex once planned eight
steps to change the screen resolution — open Settings, click Display, click the
dropdown — and failed on the seventh because Windows writes `1920 × 1080` with a
multiplication sign. `ChangeDisplaySettingsEx` does it in one call. The Settings
app is a front end for APIs Dex can already call.

**Unknown is AMBER, never GREEN.** A command classifier that permits what it
does not recognise fails open, and the thing on the other side of it is a
planner that reads web pages.

**Untrusted content is data, never instruction.** A page, an email or a document
Dex reads can say anything. None of it reaches a prompt as a directive.

**The catalogue is generated, not restated.** `core/brain/capabilities.ts` is the
only place an action is declared. The planner's schema is generated from it and
checked against what the daemon reports at startup, because two hand-kept lists
drifted and the symptom was the Brain confidently planning steps that came back
"Unknown action" halfway through a task.

### Adding an action

1. Declare it in `core/brain/capabilities.ts`
2. Implement it in the daemon or the agent
3. Verify it in `core/reliability/verification_policy.ts`
4. Add a probe in `tests/conformance/probes.ts` — the run fails without one

### Version control

`main` is the stable branch. Work happens on feature branches.

```powershell
git checkout -b feat/what-it-does
npm test; npm run conformance
git push -u origin feat/what-it-does
```

---

## 11. When something is wrong

**"core not running"** — the app starts the core itself. If it says this, open
Settings → Diagnostics and read `core.log`; the reason is at the end.

**A step fails with "Daemon not running"** — the daemon is not answering its
pipe. Turn Full Access off and on, or:

```powershell
Start-ScheduledTask -TaskName DexDaemon
```

**Planning times out** — a large plan through the Claude Code CLI can take
minutes. Switch the composer to Fast (Haiku), ask for something smaller, or add
an API key: the API path answers in seconds because there is no CLI to start.

**A saved workflow does the wrong thing** — forget it in Settings → Memory. Dex
saves every successful task as a reusable script, and one that stops working is
dropped automatically after two failures, but you can remove it sooner.

**Something changed that you did not expect** — `daemon.log` records every
privileged call with its arguments, in order, with timestamps.

---

## Where things are

```
%LOCALAPPDATA%\DEX\settings.json        configuration
%LOCALAPPDATA%\DEX\credentials\         DPAPI-encrypted secrets
%LOCALAPPDATA%\DEX\dex.db               tasks, workflows, site routes
%LOCALAPPDATA%\DEX\browser-profile\     Dex's own signed-in browser
%LOCALAPPDATA%\DEX\*.log                logs
%LOCALAPPDATA%\DEX\ui.json              the core's handshake: port and token
```

`browser-profile` holds live cookies for whatever you signed Dex into. It is
Dex's own profile, not your browser's, so the blast radius is only what you
chose to sign in to. Delete the folder to sign it out of everything.
