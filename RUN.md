# Running Dex

The short version. For setting up a machine from scratch — drivers, local
models, credentials, contributing — see [SETUP.md](./SETUP.md).

---

## Start it

```
RUN.bat
```

Double-click it, or run it from a terminal. That is the whole thing.

Nothing appears on screen. That is correct — Dex runs in the background and the
bar is summoned with a hotkey:

```
Alt + Space
```

Type what you want and press Enter.

## Stop it

```
STOP.bat
```

Use this rather than closing windows. There usually aren't any, and even in
`-Console` mode the daemon and agent servers outlive the terminal that started
them. Leftover daemons are not just untidy — several can serve the same named
pipe at once and answer requests unpredictably, which is a genuinely horrible
thing to debug.

---

## First run

`RUN.bat` checks the things people forget, in order, and stops with a useful
message rather than failing three screens later:

| Check | If it is missing |
|---|---|
| Node 24+ | tells you, and why 20 will not do |
| Python 3.11+ | tells you |
| `node_modules/` | runs `npm install` for you |
| `.env` | copies `.env.example`, then asks for a key |
| The Dex Bar | `run-dev.ps1` builds it (~1 minute, once) |

The one thing it cannot do for you is the API key. Dex needs one model to plan
with:

```powershell
npm run cred -- set groq_api_key
```

Groq has a free tier and is what Dex is tuned for. The key goes into the
Windows credential store encrypted with DPAPI, not into `.env` — see
[SETUP.md §7](./SETUP.md).

Then run `RUN.bat` again.

---

## What actually started

Five processes, none of them visible:

| | |
|---|---|
| `DexDaemon.py` | OS control — DNS, registry, power, audio, processes, apps |
| `agents/app/server.py` | driving applications by name, no screenshots |
| `agents/browser/server.py` | the web |
| `agents/desktop/server.py` | vision, for UI with no accessible controls |
| the core | planning, verification, and the WebSocket the bar talks to |

All of them log to `%LOCALAPPDATA%\DEX\` — `daemon.log`, `app.log`,
`browser.log`, `desktop.log`, `core.log`. With no console, those files are the
only output there is, so start there when something looks wrong.

---

## Options

```powershell
RUN.bat -Console      # every process in its own window, plus the dex> prompt
RUN.bat -NoBrowser    # skip the browser agent
RUN.bat -NoDesktop    # skip the vision agent (no GPU needed without it)
RUN.bat -CoreOnly     # core only; daemon and agents already running
```

Anything you pass goes straight through to `scripts\run-dev.ps1`.

`-Console` is the one to reach for while developing: you get the `dex>` prompt
and see tracebacks as they happen instead of tailing a file.

---

## Full Access — no admin prompts

Some things need administrator rights: DNS, wifi, power plans, `HKLM` registry
writes. Without them you get a clear refusal, not a silent failure:

```
netsh failed (1): The requested operation requires elevation
  — this needs an elevated daemon. Run scripts/install-daemon-service.ps1 once
```

Grant it once, from an **Administrator** PowerShell:

```powershell
.\scripts\install-daemon-service.ps1
```

One consent prompt, and never again. It registers a logon task that starts the
daemon elevated **in your own session**, so it keeps working after a reboot with
nothing to click.

Full Access also stops Dex asking you to confirm each risky step. Three things
it deliberately does not do:

- **RED registry keys stay refused** — Defender, Group Policy, `\Services\`,
  Winlogon, LSA, `\Run`, UAC. Reachable only with `DEX_ALLOW_RED=true`, and even
  then they always raise a confirmation card.
- **Hand-offs still reach you.** No privilege lets Dex read a CAPTCHA or type a
  password it does not know.
- **It turns itself off if it is not real.** Configured but not actually
  elevated means confirmation cards come back, and Dex says so at startup.

Revoke with `.\scripts\uninstall-daemon-service.ps1`.

---

## Check it works

```powershell
npm run conformance
```

Drives every action Dex advertises against the real daemon and reports what
works. Un-elevated, expect `set_dns` to fail with *"requires elevation"* — that
is the right answer, not a broken install.

---

## When something is wrong

| Symptom | What it means |
|---|---|
| Alt+Space does nothing | another app owns the hotkey; the bar still works if you focus it |
| "Core not connected" in the bar | the core is not running — `RUN.bat` |
| `Daemon not running` | run `STOP.bat`, then `RUN.bat` |
| Works, then does not, unchanged | almost always a leftover daemon. `STOP.bat` and check it exits cleanly |
| `requires elevation` | Full Access is not set up — see above |
| A task runs when you did not expect | a saved workflow matched. `/workflows`, then `/forget <name>` |
| `RUN.bat` seems to hang when piped | it is not hung. The background processes inherit the pipe, so it stays open. Redirect to a file instead: `RUN.bat > log.txt 2>&1` |

`%LOCALAPPDATA%\DEX\*.log` has the detail. `DEX_DEBUG=true` adds gate refusals
and MCP stderr.

---

## Useful commands

Inside the bar, or at the `dex>` prompt with `-Console`:

```
/save <name>              keep the last task as a workflow
/workflows                what you have saved      /forget <name>
/every <when> as <name>: <task>                    /schedules
/pause <name>  /resume <name>  /unschedule <name>
/history [search]         what you have asked
/stats [days]             what you use Dex for
run <name> ...            replay a workflow, no planning call
```

Scheduling reads how you would say it — `every day at 8`,
`every weekday at 07:30`, `every 30 minutes`, `every monday at 9pm` — or a cron
expression if you prefer.

A scheduled task runs with nobody watching, so anything needing approval is
**refused rather than queued**. If a schedule needs privileged steps, it needs
Full Access.
