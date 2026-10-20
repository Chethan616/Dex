# Running OSWorld with DEX

`PROMPT.md` is a prompt for Claude Code (on Opus 5.5) that builds a bridge
between DEX and [OSWorld](https://github.com/xlang-ai/OSWorld) and then runs
the benchmark. Read this first.

## What you need

- **Windows 10/11** with virtualization switched on (BIOS/UEFI), **16 GB of
  RAM or more**, and **tens of GB of free disk** for OSWorld's Ubuntu image.
- **VMware Workstation Pro** (free) for OSWorld's VM. Docker also works, but
  only on a Linux host with KVM.
- **Python 3.10+**, **Node 22+**, **yarn**, **Git for Windows**.
- **The Claude Code CLI**, signed in. It's what DEX runs tasks with.
  - A Claude subscription works, but its Opus usage limit will pause the run
    many times.
  - An Anthropic API key is faster, and you pay per token.
- **DEX from this repository:**

  ```powershell
  cd desktop\app
  yarn install
  yarn start
  ```

  For the benchmark, start it the way `PROMPT.md` says instead, with a
  debugging port.

## What to expect

- **This measures DEX's agent loop, prompts and Opus 5.5 driving a VM through
  screenshots.** DEX's own strengths don't apply inside OSWorld's virtual
  machine: its built-in browser, background Windows control and connectors.
  Expect a number near Opus 5.5's own computer-use results. The point is a
  score you can put next to the OSWorld leaderboard.
- **It's long.** The verified set has a few hundred tasks, each taking minutes.
  Plan on a day or more on a subscription. The prompt runs a small set first,
  then asks before the full run, with a time and cost estimate.
- **Make the number comparable:**
  - one run, with no best-of-N;
  - a fixed step budget, said in the report (OSWorld reports 15, 50 and 100);
  - no human help during tasks;
  - the observation type stated (screenshots, accessibility tree).

  Tasks that need a Google account need credentials set up as OSWorld's docs
  describe, or must be excluded, and the report says how many.
- **The official leaderboard** has its own submission and verification
  process: see OSWorld's README.

## Before the run

- In DEX, set **Settings › Agent approval** to Full access, so nothing waits on
  a click. Set **Settings › Desktop control** to off, so DEX can't touch the PC
  itself.
- Don't use the PC for other things during the run: the VM and DEX together
  are heavy.
- **Windows' debugging-port quirk:** if DEX is force-closed, its port
  (`AGB_CDP_PORT`) can stay taken by a process that's gone. Close DEX normally,
  or pick a new port (9225, 9226…).
- **Check the model:** every task should resolve to `claude-opus-5-5`, which
  DEX logs as `session.model.resolved` in `%APPDATA%\DEX\logs\engine.log`. If
  Claude Code falls back to a smaller model at a usage limit, that task doesn't
  count.

## A quicker check first

DEX's own Windows benchmark runs in about half an hour and shows that the setup
works:

```powershell
cd benchmarks\dex-bench
node selftest.mjs
node run.mjs --agent dex --cdp 9225
node report.mjs
```

DEX scored 24/24 on it with Opus 5.5 (see `benchmarks/dex-bench/results/`).
