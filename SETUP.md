# Dex V3 — Setup & Contributor Guide

Everything needed to get Dex running on a fresh Windows machine, plus the
hardware-specific parts (AMD vs NVIDIA) that are easy to get subtly wrong.

Most of what follows was learned by getting it wrong first. Where something
looks like a strange precaution, there is usually a note explaining what broke.

> **Read [SAFETY.md](./SAFETY.md) before enabling Full Access.** Dex can change
> system settings and drive applications. The confirmation tiers are the thing
> standing between a mistake and a bad afternoon.

---

## 1. What Dex needs

| Requirement | Version | Notes |
|---|---|---|
| Windows | 10 or 11 | Windows-first by design; UI Automation and the daemon are Win32 |
| Node.js | **24+** | uses the built-in `node:sqlite`, which does not exist before 22 |
| Python | **3.11+** | browser-use requires ≥3.11 |
| Flutter | 3.x with Windows desktop | only for the Dex Bar UI |
| Git | any | |

```powershell
node --version      # v24.x
python --version    # 3.11+
flutter --version
```

**Node must be 24+.** Dex stores its history and workflows in SQLite through
Node's built-in `node:sqlite`. That avoids `better-sqlite3` — a native module
that needs a compiler toolchain and breaks on Node upgrades — but it does not
exist in Node 20.

---

## 2. First run (no GPU needed)

```powershell
git clone https://github.com/Chethan616/Dex.git
cd Dex
git checkout v3/dex

npm install
copy .env.example .env
```

Dex needs one LLM for planning. **Groq is the cheapest place to start** — see
§6 for why Gemini's free tier is not a practical default.

```powershell
npm run cred -- set groq_api_key      # paste when prompted; input is hidden
```

Then start everything:

```powershell
.\scripts\run-dev.ps1              # windowless — Alt+Space for the Dex Bar
.\scripts\run-dev.ps1 -Console     # windows and the dex> prompt, for development
.\scripts\stop-dex.ps1             # stop it all
```

Use `stop-dex.ps1` rather than closing windows — see §8 for why that matters
more than it sounds.

While developing, the pieces run individually too:

```powershell
python daemon/DexDaemon.py            # OS control (named pipe)
python agents/app/server.py           # UI Automation tier  (127.0.0.1:8767)
npm run dev                           # the core + CLI
```

```
dex> what is my current dns
```

**Then prove it actually works**, before trusting anything:

```powershell
npm run conformance
```

This drives every advertised OS action against the real daemon and reports what
works. Un-elevated you should see 15 pass and `set_dns` failing with *"requires
elevation"* — that is the correct answer, not a broken install. §8 fixes it.

Do not skip this step. Until it existed, fourteen of the seventeen actions Dex
advertises had never once been executed, and the documentation said they worked.

---

## 3. Python components

Three separate Python processes, each with its own requirements file. They are
separate because they own different resources — the daemon holds elevation, the
browser server owns a Chrome instance, the desktop server owns the screen.

```powershell
pip install -r daemon/requirements.txt          # pywin32
pip install -r agents/browser/requirements.txt  # browser-use, playwright
pip install -r agents/desktop/requirements.txt  # pyautogui, uiautomation
pip install pycaw comtypes                      # volume control
python -m playwright install chromium
```

`uiautomation` is easy to miss and its absence is silent: the Tier 2 app agent
reports `uia: false` from `/health` and every window looks unreachable.

| Process | Port | Purpose |
|---|---|---|
| `daemon/DexDaemon.py` | named pipe | registry, DNS, power, audio, processes, app launch |
| `agents/app/server.py` | 8767 | UI Automation — click by name, no vision |
| `agents/browser/server.py` | 8766 | browser-use + CDP primitives |
| `agents/desktop/server.py` | 8765 | vision tier (needs local inference, §5) |
| core WebSocket | 8770 | Dex Bar |

You do **not** need all of them. The daemon plus the app server covers most
desktop work, and that path needs no GPU and no vision model at all.

---

## 4. The Dex Bar (Flutter)

```powershell
cd ui/dex-bar
flutter build windows --debug
.\build\windows\x64\runner\Debug\dex_bar.exe
```

`Alt+Space` summons it. It connects to the core over loopback only, using a
token written to `%LOCALAPPDATA%\DEX\ui.json`.

---

## 5. Local inference (optional — the vision tier)

Only the **Desktop Agent** (Tier 3, vision) needs a local model. Tiers 1 and 2
— which handle most tasks — need none. Set this up when you actually hit a
window with no accessible controls.

### Install Ollama somewhere other than C:

Models are 4–8 GB each.

```powershell
# Models location — set this BEFORE pulling anything
[Environment]::SetEnvironmentVariable('OLLAMA_MODELS','D:\ollama\models','User')
```

**Do not use `OllamaSetup.exe` if you want it off C:.** It is not Inno Setup or
NSIS, ignores `/VERYSILENT` and `/DIR`, and exits 0 having installed nothing.
Use the release ZIPs instead:

```powershell
# from https://github.com/ollama/ollama/releases
Expand-Archive ollama-windows-amd64.zip      -DestinationPath D:\Ollama
Expand-Archive ollama-windows-amd64-rocm.zip -DestinationPath D:\Ollama   # AMD only
```

### AMD GPUs

Two things go wrong, and the second one is nasty because it *looks* fine.

**1. The driver must be current.** ROCm refuses outright on an old driver
(`AMD driver is too old`, `hipGetDeviceCount failed: 100`). Install the latest
**AMD Adrenalin** from amd.com — AMD's generic driver supports AMD Advantage
laptops; the OEM's version is usually years behind.

On RDNA2 *mobile* parts (RX 6000M), ROCm may never work — consumer Adrenalin
does not ship the HIP runtime for them. That is fine. **Vulkan is the path.**

**2. A stale Vulkan ICD will produce fast, confident, wrong output.** Upgrading
a driver does not always remove the old one's Vulkan registration, so the same
GPU appears twice:

```powershell
vulkaninfo --summary
```
```
GPU1: RX 6800M   apiVersion 1.2.182   driverVersion 2.0.193   ← stale
GPU2: RX 6800M   apiVersion 1.4.315   driverVersion 2.0.353   ← current
```

Ollama picks the first one it finds. On the stale ICD it reports `100% GPU`, runs
at 270 tok/s, and emits **garbage** — `عمار@@@@@@@`. Pin the good device:

```powershell
[Environment]::SetEnvironmentVariable('GGML_VK_VISIBLE_DEVICES','2','User')
```

The index is positional. If you ever DDU-wipe the old driver, the good device
becomes index 1 and this must be updated.

**Always verify with actual text, never with `ollama ps`:**

```powershell
D:\Ollama\ollama.exe run qwen2.5:0.5b "What is the capital of France?"
```

`Paris.` means it works. `@@@@@@` means the wrong device. `ollama ps` says
`100% GPU` in both cases — which is exactly why it is not the test.

### NVIDIA GPUs

Considerably simpler: install a current GeForce driver and Ollama uses CUDA. No
device pinning, no ICD confusion, no Vulkan.

The constraint is VRAM. UI-TARS-1.5-7B needs a quantised model **plus** an
`mmproj` file (the vision projector — without it the model loads happily and
cannot see images at all):

| VRAM | Recommended | Total |
|---|---|---|
| 12 GB (RX 6800M, RTX 3060 12G) | `Q6_K` + `mmproj-f16` | ~7.1 GB |
| 8 GB | `Q5_K_M` + `mmproj-Q8_0` | ~5.8 GB |
| 6 GB (RTX 4050 laptop) | `Q4_K_M` + `mmproj-Q8_0` | ~5.2 GB, small context |

Weights: `mradermacher/UI-TARS-1.5-7B-GGUF` on HuggingFace. ByteDance ships only
safetensors (for vLLM, which needs Linux + CUDA), so GGUF is the practical route
on Windows.

```
FROM ./UI-TARS-1.5-7B.Q6_K.gguf
FROM ./UI-TARS-1.5-7B.mmproj-f16.gguf
```

Two `FROM` lines — weights, then projector. Then
`ollama create ui-tars -f Modelfile`.

**Verify it can see, not just that it loaded.** A model with a broken projector
answers plausibly about images it never received. Put a random number in an
image and ask the model to read it back; it cannot guess four digits.

### Screenshots must be downscaled — and 1M pixels is the number

Dex handles this in `prepare_image`, but it is worth knowing why, because the
failure is loud and the tuning is counter-intuitive.

A full 2560x1440 screenshot **crashes the llama-server runner**. Ollama reports
only "an error was encountered while running the model". The limit is VRAM in
the vision encoder, not context — full resolution is ~4,600 vision tokens, which
fits an 8k window, and raising the context to 32k does not help.

Measured on a 12 GB RX 6800M against a fixture with known control centres:

| pixels | median error | within 40px | per call |
|---|---|---|---|
| 0.50M | 132 px | 0/8 | 3.8 s |
| **1.00M** | **6 px** | **6/8** | **1.7 s** |
| 1.50M | 12 px | 7/8 | 3.8 s |
| 3.69M | *crashes* | — | — |

Downscaling too far is catastrophic rather than gradual — at 0.5M the model is
essentially guessing. And **more pixels is not monotonically better**: 1.5M is
worse on median than 1.0M. This is a resolution the model prefers, not a budget
to spend.

So more VRAM buys **speed, not accuracy**. There is no "run it without
downscaling" configuration worth chasing; a 24 GB card would let the full image
through and measure no better. The quantisation floor at 1.0M is ±1.9 screen
pixels against an observed error of ~6 px, so the downscale is not what limits
precision either.

### How it compares

Against the same fixture, local UI-TARS versus Gemini:

| | UI-TARS (local) | Gemini 2.5 Flash |
|---|---|---|
| median error | **6 px** | 22 px |
| within 40 px | **6/8** | 5/8 |
| latency | **~1.7 s** | ~1.5 s |
| quota | none | project-dependent; a free tier was measured at 20/day |
| screenshots | never leave the machine | uploaded |

Gemini's worst misses were menu items (535 px on one); UI-TARS resolves all five
to 6 px. Local is the default for that reason as much as for cost.

---

## 6. LLM providers

| Provider | Good for | Watch out for |
|---|---|---|
| **Groq** | the Brain — 1 call/task, fast | reasoning models (`gpt-oss-120b`) spend output tokens thinking; a small `max_tokens` returns **empty content** |
| **Gemini** | large context | a free key was measured at **20 requests per DAY** — one Desktop task needs ~30 |
| **Anthropic** | best quality | paid |
| **Ollama** | vision tier, unlimited | needs the GPU setup above |

```powershell
$env:DEX_BRAIN_PROVIDER = "groq"       # or anthropic
$env:DEX_BRAIN_MODEL    = "openai/gpt-oss-120b"
```

Free-tier rate limits are handled — Dex honours `Retry-After` and backs off
rather than failing the task.

### Which Groq model for the browser agent

Measured against browser-use's real 17 KB output schema, not chosen from
reputation. `ToolCallingModels` inside browser-use contains only
`moonshotai/kimi-k2-instruct`, so every other model goes through Groq's
`response_format: json_schema`, and support for that is what decides viability:

| model | result |
|---|---|
| **`qwen/qwen3.8-27b`** | **3/3 correct element, 0 reasoning tokens** — the default |
| `openai/gpt-oss-120b` | correct, but ~158 of 203 output tokens spent thinking |
| `openai/gpt-oss-20b` | correct, cheapest, less consistent |
| `qwen/qwen3.6-27b` | **`json_validate_failed`** — cannot hold the schema |
| `groq/compound-mini` | rejects `json_schema` outright |

Override with `BROWSER_MODEL`; switch vendor with `DEX_BROWSER_PROVIDER`.

**The binding limit is 8,000 tokens per minute**, not requests (1,000/day).
browser-use's default system prompt is 5,273 tokens *per step*, which exhausts
that budget before the second step — so on Groq Dex switches on `flash_mode`
(a 516-token prompt), trims the DOM to 15,000 characters, caps history at 8
items, and disables vision. Groq serves no vision models anyway.

---

## 7. Credentials — the DPAPI store

**Secrets never go in `config.yaml` or `.env`.** They live encrypted in
`%LOCALAPPDATA%\DEX\credentials`, one file each.

```powershell
npm run cred -- list                        # what is set, what is missing
npm run cred -- set groq_api_key            # hidden input
npm run cred -- get google_account_email
npm run cred -- delete some_key
```

Encryption is Windows DPAPI in `CurrentUser` scope, reached through PowerShell —
no native npm module, nothing to rebuild on a Node upgrade.

**Two consequences worth knowing:**

- **The files are bound to your Windows account on that machine.** Copying them
  to another machine, or reading them as a different user, yields nothing. This
  is the point, but it means a new machine needs its secrets re-entered — they
  are not in the repo and cannot be.
- **Plaintext never touches a command line or a child process environment.** It
  moves over stdin, base64-encoded so no console codepage can corrupt it. An
  earlier version lowercased on the way through and would have turned a
  passphrase with an umlaut into one that no longer unlocked anything.

`.env` still works as a bootstrap and warns each time, naming the command that
moves the value into the store. That warning is deliberate: plaintext on disk is
a migration state, not a resting place.

MCP servers get a **narrow** environment — `PATH`, the Windows profile paths, and
exactly the secrets that server declares. A third-party server should be able to
do its job and learn nothing else about the machine.

---

## 8. Full Access

One UAC prompt, then never again — the daemon runs **elevated, in your own
session**, started by a logon task.

```powershell
.\scripts\install-daemon-service.ps1     # one UAC prompt, run as Administrator
npm run conformance                      # describe should say elevated=true, session=1
```

Without this, `set_dns`, `set_wifi`, `set_power_plan` and HKLM registry writes
fail. They now say so — before the fix they failed silently and reported
success, because netsh writes its errors to stdout and the handler only checked
stderr.

**Not a LocalSystem service, deliberately.** This used to install one, and it
never worked — `daemon/daemon_service.py` could not even be imported. It would
have been the wrong target regardless: a service runs in session 0, isolated
from your desktop, where the audio endpoint is not yours and a launched app
appears on a desktop nobody is looking at. Fixing DNS by breaking `set_volume`
and `launch_app` is not a fix. A scheduled task with `RunLevel Highest` gives
elevation *and* your session. The daemon reports both facts through `describe`,
and the core warns at startup if either is wrong.

### Only one daemon, ever

The daemon claims its pipe with `FILE_FLAG_FIRST_PIPE_INSTANCE`, so a second one
cannot start — it exits 1 saying so. This is not tidiness. A named pipe accepts
many *server* instances under one name, so before this a second daemon simply
joined the rota and Windows handed each connection to whichever was free. Seven
had accumulated from previous `run-dev.ps1` runs, several executing weeks-old
handler code, and the same command worked or did not depending on who answered.

```powershell
.\scripts\stop-dex.ps1     # stops the logon task and any hand-started daemon
```

It stops the task, kills what it can see, then **probes the pipe** — an
unelevated shell cannot read an elevated process's command line, so a process
list is not evidence. It exits non-zero if anything still answers.

### Nothing on screen

Everything runs windowless. The daemon and the three agent servers run under
`pythonw.exe` — the GUI-subsystem build of the same interpreter, which
allocates no console — and the core runs headless. The Flutter Dex Bar on
`Alt+Space` is the only thing you see.

```powershell
.\scripts\run-dev.ps1              # windowless; Alt+Space for the bar
.\scripts\run-dev.ps1 -Console     # windows back, plus the dex> prompt
```

`pythonw` sets **both `sys.stdout` and `sys.stderr` to None**, so the default
`logging.StreamHandler` raises during startup — a process that dies before it
can log why, with no console to show the traceback. Both
`daemon/DexDaemon.py` and `agents/dex_logging.py` add a stream handler only
when there is a stream. Anything new that runs this way must do the same.

### Where it logs

`%LOCALAPPDATA%\DEX\` — `daemon.log`, `app.log`, `browser.log`, `desktop.log`,
`core.log`. With no console these files are the only output there is, which is
why the logging went in before the windows came off.

### The pipe's DACL

The pipe grants your SID, SYSTEM and Administrators, and nothing else. Anything
that can open it can ask the daemon to change DNS or write the registry, so this
is a security boundary — but it is also load-bearing for a different reason: a
pipe created by an elevated process with the default DACL does **not** admit the
same user's ordinary processes, so the unelevated core could not talk to its own
elevated daemon.

### It is only on when it is real

Full Access is on when it is *configured* **and** the daemon reports
`elevated: true`. Configured-but-not-elevated — a removed task, a committed
`FULL_ACCESS=true`, a task that failed to start — used to be the worst state
available: confirmations skipped for privileged actions that then failed at the
daemon anyway. It now downgrades to cards and says so:

```
[Full Access] ON   elevated, session 1, confirmations bypassed, RED locked
[Full Access] OFF  configured, but the daemon is not elevated — using cards
```

`DEX_FULL_ACCESS` is the name. `FULL_ACCESS` is still read so an existing `.env`
keeps working.

### The RED band, and how to reach it

RED — Group Policy, `\Services\`, Winlogon, LSA, Defender, `\Run`, IFEO, UAC —
is refused by default. To make it possible:

```powershell
[Environment]::SetEnvironmentVariable('DEX_ALLOW_RED','true','User')
```

Set by hand, never by the installer: turning off every prompt and unlocking the
sharpest keys in Windows should not be the same gesture. Even then it is never
silent — **two independent gates**:

1. The Orchestrator classifies every `registry_write` through the daemon's
   `registry_classify` *before* gating it, and forces a RED path to Tier 2
   whatever tier the planner assigned and whatever Full Access says. A card
   always appears, naming what the key controls.
2. The daemon refuses RED anyway unless `DEX_ALLOW_RED=true`, so a core that has
   been bypassed entirely still cannot reach these keys.

Two gates because untrusted content reaches the planner. A web page or email
Dex reads can propose steps, and RED is where that would aim; a gate outside the
process the model talks to is the one that cannot be argued past.

**Full Access grants elevation, not permission.** Two things it deliberately does
*not* do:

- **Registry RED-band keys are never silent.** Refused outright by default, and
  even with `DEX_ALLOW_RED=true` they always raise a card. "Never change Windows
  security settings without asking" is a separate rule from "stop asking for
  admin", and collapsing the two turns a convenience toggle into a security
  bypass. `npm run test:full-access` asserts the card appears with Full Access
  on and the step marked Tier 4.
- **Tier 1 hand-offs still happen.** No amount of privilege lets Dex read a
  CAPTCHA or a password.

Revoke with `.\scripts\uninstall-daemon-service.ps1`.

---

## 9. Channels (optional)

Owner **ids** are not secret and live in `.env`; bot **tokens** go in the
credential store.

```powershell
npm run cred -- set telegram_bot_token     # from @BotFather
npm run cred -- set discord_bot_token
```
```ini
DEX_OWNER_TELEGRAM=123456789
DEX_OWNER_DISCORD=987654321
DEX_TRIGGER_PREFIX=@dex
```

A channel starts only with **both** a token and an owner id. A bot running with
no configured owner rejects everything anyway, and one that is running while
silently ignoring you is far harder to diagnose than one that says why it did
not start.

Discord additionally needs the **MESSAGE CONTENT** intent enabled in the
developer portal, or every message arrives empty.

**WhatsApp is deliberately opt-in and not a declared dependency:**

```powershell
npm install @whiskeysockets/baileys
$env:DEX_WHATSAPP = "true"
```

Baileys is **GPL-3.0**, which would pull this project into that licence's scope
if statically linked and distributed; and it is an **unofficial client** that
reverse-engineers WhatsApp Web, so accounts using it can be banned. Telegram and
Discord are official APIs. That trade should be a decision, not a side effect of
`npm install`.

---

## 10. Tests

```powershell
npm run typecheck
npm run test:channels     # Owner Gate — the remote security boundary
npm run test:workflows    # saved workflows + usage history
npm run test:slice45      # execution tiers, registry bands, escalation
npm run test:slice4       # browser hand-offs, MCP, credential store
npm run test:ws           # WebSocket protocol, stale-approval guard
npm run test:memory       # references, sessions, semantic cache
npm run test:boot         # the core actually starts
npm run test:daemon       # subprocess failure detection, single-instance
npm run test:scripts      # every .ps1 parses and is encoded so it will
npm run test:full-access  # downgrade, RED always asks, hand-offs survive
npm run test:scheduler    # cron, missed runs, unattended approval refusal
npm run test:e2e          # drives a real Windows app (needs daemon + app server)

npm run conformance       # every advertised action, against the real daemon

cd ui\dex-bar; flutter analyze; flutter test
```

None of these need an API key. `test:e2e` needs the daemon and app server
running; it brings its own WinForms window and closes it afterwards.

### The conformance harness

`npm run conformance` is the one that answers "does this actually work". It
walks `OS_ACTION_NAMES` from `core/brain/capabilities.ts` — the list the Brain
itself is shown — and drives each action against the real daemon over the real
pipe, confirming through the same `verifyStep` the Orchestrator uses. Each probe
reads current state first and restores it after.

**An advertised action with no probe fails the run.** Add an action to
`capabilities.ts` and you must add a probe in `tests/conformance/probes.ts`, or
the build stops. That rule exists because fourteen actions reached production
having never been executed once; fixing them individually would have left the
fifteenth in the same state.

Tiers, and how to ask for them:

```powershell
npm run conformance                              # read-only + round-trip
npm run conformance -- --destructive             # adds kill_process
npm run conformance -- --destructive --allow-network-drop   # adds set_wifi
```

`set_wifi` needs its own flag on top of `--destructive` because it is the only
probe that can cut you off from the machine it is running on. Do not pass it on
a machine you care about or are connected to remotely.

### On writing tests here

Make `import './support/isolate';` the **first** import of every test. It points
`DEX_DB` at a temp file and sets `DEX_TEST`, and `core/memory/db.ts` now throws
if a test opens the real database.

This is not hygiene. Eight of eleven test files wrote to `data/dex.db`, and the
result was two `set_dns` tasks recorded as COMPLETED — written by a suite running
against a mocked agent, for an action that had never reached the daemon. Reading
the history to find out what worked, which is the obvious thing to do and the
thing that eventually found the bug, gave a confident wrong answer for weeks.
(A workflow saved during development had separately hijacked six
confirmation-tier tests by matching their requests and replaying instead of
planning.) Run `npx ts-node scripts/prune-test-rows.ts` if you find fixtures in
your real history.

Anything that drives a GUI must **bring its own window**. An early version of the
e2e test targeted "Notepad"; Windows 11 Notepad uses tabs, so launching it joins
whatever is already open — which was the owner's document with unsaved work, and
the next step was `set_text`.

---

## 11. Working on Dex

### Layout

```
core/        brain (planning) · orchestrator (execution) · reliability (verification)
             confirmation · workflows · memory · secrets · server (WebSocket)
agents/      system (daemon IPC) · app (UI Automation) · browser · workspace (MCP) · desktop (vision)
channels/    cli · telegram · discord · whatsapp · base_channel (shared logic)
daemon/      elevated Python daemon + typed handlers (_proc.py is the shell boundary)
ui/dex-bar/  Flutter Windows overlay — theme/ tokens, widgets/primitives/
scripts/     run-dev · stop-dex · install/uninstall-daemon-service · prune-test-rows
tests/       one suite per slice, plus conformance/ (every action, for real)
```

Two files carry more weight than their size suggests:

- `core/brain/capabilities.ts` — the single list of what Dex can be asked to do.
  The planner's prompt is generated from it, the daemon is checked against it at
  startup, and the conformance harness iterates it. Adding an action anywhere
  else does not add an action.
- `daemon/handlers/_proc.py` — the only place a handler decides whether a
  command succeeded. Everything that shells out goes through it.

### The rules that matter

1. **The Brain plans; it never executes.** It also never authors steps for a
   saved workflow — it picks one and supplies arguments.
2. **Route on capability, never on agent name.** The registry resolves
   `can_control_os` → whichever agent provides it.
3. **A return value is a claim, not proof.** Nothing is `VERIFIED` until state
   was read back. "Could not check" is `UNVERIFIABLE`, never success.
4. **Climb the ladder.** Tier 1 (direct API) → Tier 2 (UI Automation) → Tier 3
   (vision). Never drive a GUI for something with an API.
5. **Add an action in one place, and prove it runs.**
   `core/brain/capabilities.ts` is what the planner is told; the daemon's
   `describe` is what actually exists; the core compares them at startup. They
   drifted once, and the symptom was tasks dying on `Unknown action` mid-run.
   Every advertised action also needs a probe in `tests/conformance/probes.ts`
   or `npm run conformance` fails — being *implemented* was never the same as
   being *exercised*, and fourteen of them shipped without ever running.
6. **A failed subprocess is a failure whichever stream carried the message.**
   Shell out through `daemon/handlers/_proc.py`, never `subprocess.run` directly.
   netsh reports errors on **stdout**, exits 1, and leaves stderr empty; a guard
   of `if returncode != 0 and result.stderr` let every DNS failure through as a
   success for the life of the project.
7. **Never build a one-way door.** `set_wifi` could disable an adapter and not
   re-enable it, because it enumerated adapters from a source that stops listing
   them once they are off — and the network you would need to fix it was the one
   it had just taken down. If an action can undo itself, test the undo.
8. **Save `.ps1` files as UTF-8 *with* a BOM.** Windows PowerShell 5.1 reads
   them as ANSI otherwise, so an em-dash in a comment becomes mojibake and can
   break a string twenty lines later. `install-daemon-service.ps1` had never once
   parsed because of this. `npm run test:scripts` checks it.

### Version control

- One **annotated tag per shipped slice** — `v0.1.0` … `v0.7.1`.
- One **feature branch per slice**: `feat/sliceN-name`.
- Merged back to `v3/dex` with **`--no-ff`**, so the branch stays visible.
- `main` is still the V2 code and has not been touched.

```powershell
git checkout -b feat/slice6-memory
# ...
git checkout v3/dex
git merge --no-ff feat/slice6-memory
git tag -a v0.7.0 -m "Slice 6 — ..."
git push origin v3/dex --tags
```

**Before every commit**, check the diff for secrets. `.gitignore` covers `.env*`,
`*.dpapi`, key and certificate files, `data/` (evidence screenshots and the usage
database) and the SQLite **WAL sidecars** — `data/*.db` does not match
`data/dex.db-wal`, and those hold the same history.

---

## 12. When something is wrong

| Symptom | Cause |
|---|---|
| `Daemon not running` | start it, or `.\scripts\stop-dex.ps1` then start — see the three rows below |
| `Daemon not running` but the log says `Listening` | you are talking to an elevated daemon from an unelevated core and the pipe DACL is wrong (§8). Check `%LOCALAPPDATA%\DEX\daemon.log` |
| `Another DEX daemon already owns …` | one is running. `.\scripts\stop-dex.ps1` |
| A command works, then the same command does not | almost always more than one daemon before this was enforced. `.\scripts\stop-dex.ps1` and check it exits 0 |
| `requires elevation (Run as administrator)` | the daemon is not elevated — §8 |
| `set_dns` succeeds but nothing changed | you are on a build before the `_proc` fix; netsh reports failure on stdout |
| App agent `/health` says `uia: false` | `pip install uiautomation` |
| Ollama outputs `@@@@@` | stale Vulkan ICD — pin `GGML_VK_VISIBLE_DEVICES` (§5) |
| `AMD driver is too old` | update Adrenalin; expect Vulkan, not ROCm, on RDNA2 mobile |
| Model loads but ignores images | missing `mmproj` file |
| Groq returns empty content | reasoning model out of output budget — raise `max_tokens` |
| Gemini 429 immediately | free tier can be 20/day; check `ai.dev/rate-limit` |
| Discord messages arrive empty | MESSAGE CONTENT intent not enabled |
| Telegram bot silent | `DEX_OWNER_TELEGRAM` unset or not your numeric id |
| A workflow runs when you did not expect | its saved *shape* matched — `/workflows`, then `/forget <name>` |
| Tests fail after local use | the test is missing `import './support/isolate';` (§10) |
| `A test tried to open the real database` | same — add the isolate import as the first line |

`DEX_DEBUG=true` logs gate refusals and MCP stderr.
