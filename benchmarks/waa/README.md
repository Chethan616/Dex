# Running Windows Agent Arena with DEX

[Windows Agent Arena](https://github.com/microsoft/WindowsAgentArena) (WAA) is
154 tasks inside a Windows 11 virtual machine:
- LibreOffice, Chrome and Edge;
- File Explorer and Settings;
- VS Code, VLC, Notepad, Paint and other built-in apps.

Here **DEX runs inside that virtual machine**, so it works as on a real PC,
with its own Windows app control, browser and tools. That makes this the
benchmark that shows DEX itself, not only the model. (On OSWorld, DEX can only
look at screenshots and click; see `../osworld/`.)

`PROMPT.md` is a prompt for Claude Code that installs everything, sets it up,
runs all 154 tasks and writes the report. It all runs on your own PC and costs
nothing beyond your Claude plan.

## What you need

- **Windows 11.** Windows 10 can't run the nested virtual machine this needs.
- **Virtualization switched on in the BIOS/UEFI.** Task Manager › Performance ›
  CPU shows "Virtualization: Enabled" when it is.
- **RAM:** 32 GB is recommended. 16 GB works, but slowly, and the PC is hard
  to use during the run.
- **About 100 GB of free disk**, on an SSD.
- **A Claude plan with Claude Opus 5.5**, signed in to Claude Code. The usage
  limit will pause the run now and then. The run waits and carries on by
  itself.
- **Claude Code.** It installs everything else itself: WSL2, Ubuntu, Docker
  Engine, WAA, the Windows 11 virtual machine, and DEX inside it.

## How to start

1. Clone this repository and open **Windows Terminal** in its folder, normally,
   not as administrator.
2. Start Claude Code with permission prompts switched off, and with Opus:

   ```
   claude --dangerously-skip-permissions --model opus
   ```

3. Paste the part of `PROMPT.md` below the line.

**What `--dangerously-skip-permissions` means:** Claude runs every command
without asking first. That's what lets it install and set things up on its
own, but it can change anything your account can change. Use it on a PC where
that's fine, and close work you care about first.

**If the PC restarts** (installing WSL can need one), open the terminal in the
same folder again and run:

```
claude --dangerously-skip-permissions --model opus --continue
```

Then type `continue`. Claude keeps its place in `benchmarks/waa/PROGRESS.md`.

## The few things you do yourself

Claude asks for these when it gets to them:
- **Click Yes on Windows admin prompts.** Expect a few, for WSL and Windows
  features. Claude can't click them for you.
- **Restart the PC** when Windows needs it.
- **Switch on virtualization in the BIOS**, if it's off.
- **Download the Windows 11 Enterprise Evaluation ISO** from Microsoft's
  Evaluation Center, if its form stops Claude. It's free, for 90 days.
- **Make a sign-in token for DEX inside the VM.** Run `claude setup-token` in a
  second terminal, and save the token it prints to
  `%USERPROFILE%\waa-dex\claude-token.txt`. Don't paste it in a chat, and
  never commit it.

## What to expect

- **Time:**
  - setting up the Windows virtual machine takes an hour or more;
  - the 154 tasks take many hours;
  - plan on a day or two in total, including usage-limit pauses.
- **Watching:** the virtual machine's screen is at http://localhost:8006.
  **Watch, but don't click or type in it during a task:** DEX treats that as
  you taking over, and stops.
- **No DEX on your own PC:** you don't need DEX running on your own PC for
  this. It runs inside the VM.
- **One plan for both:** Claude Code in your terminal and DEX in the VM use the
  same Claude plan. The benchmark runs as a background process, so your
  terminal session stays mostly idle.

## How the score compares

The report gives a single run, with no best-of-N, plus the time limit and what
DEX could use. Published WAA numbers to put it next to:

| Agent | WAA score |
|---|---|
| People | 74.5% (WAA paper) |
| Agent S3 | 56.6%, best of several tries (Simular, Oct 2025) |
| Microsoft UFO2 | 30.5% (arXiv 2504.14603); like DEX, it runs inside the VM |
| Navi, WAA's own agent | 19.5% (WAA paper) |

## Cleaning up afterwards

Almost everything lives inside WSL's Ubuntu: Docker, the virtual machine's
disk and WAA. `wsl --unregister Ubuntu` removes all of it in one go, and also
deletes anything else in that Ubuntu, so check first. The ISO and the token
file are in your user folder: delete them by hand.
