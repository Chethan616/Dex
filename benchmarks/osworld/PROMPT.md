# Prompt: run OSWorld with DEX on Claude Opus 5.5

Paste everything below the line into Claude Code, opened at the root of this
repository, with the model set to Opus 5.5 (`/model` → Opus). Read
`benchmarks/osworld/README.md` first: it lists what you need and what to
expect.

---

You're in the DEX repository: an Electron desktop app for Windows whose agent
engine is Claude Code. Measure DEX on the real **OSWorld** benchmark
(https://github.com/xlang-ai/OSWorld), its OSWorld-Verified task set, with
DEX's Claude Code engine on **Claude Opus 5.5**, and report a score that can be
compared with the OSWorld-Verified leaderboard.

**Read first**
- `TO_BE_DONE.md`, the "RESUME HERE" block at the top.
- `benchmarks/dex-bench/run.mjs`, the `dexAgent()` function. It shows how a
  script drives DEX: over the hub's CDP port it calls
  `window.electronAPI.sessions.create({ prompt, engine: 'claude-code', model })`,
  then `sessions.start(id)`, then polls `sessions.get(id)` until the task is
  `idle` or `stopped`. It sets the approval mode to Full access for the run and
  puts it back afterwards. It also waits out the plan's usage limit.
- `desktop/app/src/main/mcp/catalog.ts`: how DEX starts its built-in MCP
  servers (`builtIn`, `launchSpec`, `alwaysOnConnections`), and
  `desktop/app/src/main/hl/engines/runEngine.ts`, where a run gets its MCP
  servers. DEX runs Claude Code with `--strict-mcp-config`, so a server must be
  one of DEX's own, not one in `~/.claude.json`.
- `desktop/app/mcp-servers/microsoft/server.mjs`: a dependency-free stdio MCP
  server to copy the shape of.

**Rules**
- OSWorld's tasks happen in OSWorld's Ubuntu virtual machine, not on this PC.
  During the run, DEX's own browser and its Windows tools (`mcp__windows__*`)
  must not be used for the task. Turn Settings › Desktop control off for the run.
- Normal DEX must not change. Everything new is off unless the environment
  variable `DEX_OSWORLD_URL` is set.
- Never commit API keys, Google credentials, VM images, the OSWorld checkout,
  or anything under the VM folder. Work on a branch, and keep DEX's tests
  green: in `desktop/app`, `npx tsc --noEmit -p .` and `npx vitest run`.

**Build and run**
1. **OSWorld, outside this repo** (for example in `C:\osworld`).
   - Clone `xlang-ai/OSWorld` and create a Python 3.10+ virtual environment.
     Run `pip install -r requirements.txt`.
   - Use the VMware provider on Windows (VMware Workstation Pro, which is
     free), or Docker on a Linux host with KVM.
   - Run OSWorld's own quick start until the Ubuntu VM boots and
     `env.reset` / `env.step` / `env.evaluate` work.
   - Use the task list and rules the OSWorld README gives for OSWorld-Verified.
2. **An environment service**: `benchmarks/osworld-dex/env_service.py`. It
   owns one OSWorld `DesktopEnv` (`action_space="pyautogui"`) and serves on
   `127.0.0.1:8770`:
   - `POST /reset {task}` loads a task;
   - `GET /screenshot` returns a PNG;
   - `GET /a11y` returns the accessibility tree as text, truncated;
   - `POST /act {code}` runs one pyautogui action in the VM and returns a
     fresh screenshot;
   - `POST /done {status: "DONE" | "FAIL"}` ends the task;
   - `POST /evaluate` returns OSWorld's score for the task.

   It enforces the step budget (100 actions by default; refuse after that) and
   counts the steps.
3. **A DEX built-in MCP server**: `desktop/app/mcp-servers/osworld/server.mjs`
   (stdio, no dependencies), talking to `DEX_OSWORLD_URL`. Tools:
   - `osworld_screenshot` (the PNG as an MCP image content block);
   - `osworld_accessibility_tree`;
   - `osworld_act` (one pyautogui action per call);
   - `osworld_wait(seconds)`;
   - `osworld_done`;
   - `osworld_fail` (for a task that can't be done).

   Register it in `catalog.ts` as an always-on connection only when
   `DEX_OSWORLD_URL` is set, and check that the task's prompt names its tools.
4. **A runner**: `benchmarks/osworld-dex/run.mjs`, modelled on
   `benchmarks/dex-bench/run.mjs`. For each task:
   - `POST /reset`.
   - Create and start a DEX task (`engine: 'claude-code'`, `model: 'opus'`).
     Its prompt is the task's instruction after this preface: "You are
     operating a separate Ubuntu computer only through the osworld_* tools.
     Look with osworld_screenshot; act with osworld_act, one pyautogui action
     at a time; when the task is done call osworld_done; if it can't be done,
     call osworld_fail. Don't use your own browser, a shell on this PC, or
     Windows tools for the task."
   - Wait until the DEX task is idle, or a 30-minute timeout. Then
     `POST /evaluate`.
   - Append `{ id, domain, score, steps, seconds, model }` to a results JSON
     after every task, so a crash can resume where it stopped.
   - Record the model each task really used: DEX logs `session.model.resolved`
     in `%APPDATA%\DEX\logs\engine.log`, and it must be `claude-opus-5-5`. If
     Claude Code fell back to another model, mark the task and pause.
   - If an answer says the plan's usage limit was hit, wait for the reset and
     run the task again, as dex-bench's runner does.
5. **Order:** 3 tasks as a smoke test, then OSWorld's `test_small.json`, then
   the full verified set. After the small set, estimate the time and cost of
   the full run from it and tell me before you start it.
6. **Report:** `benchmarks/osworld-dex/results/REPORT.md`, with:
   - the overall success rate;
   - the rate by domain (chrome, gimp, libreoffice_calc, libreoffice_writer,
     libreoffice_impress, os, thunderbird, vlc, vs_code, multi_apps);
   - the step budget and the observation type (screenshot, accessibility tree);
   - a single run, no best-of-N;
   - how many tasks were excluded and why (for example, Google account tasks
     without credentials);
   - links to the raw results.

**Start DEX for the run** (Windows `cmd`, in `desktop/app`, after `yarn install`):

```
set AGB_CDP_PORT=9225&& set DEX_OSWORLD_URL=http://127.0.0.1:8770&& npx electron-forge start
```

In DEX: Settings › Agent approval → Full access; Settings › Desktop control →
off; the engine is Claude Code with the model Opus.
