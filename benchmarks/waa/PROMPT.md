# Prompt: run Windows Agent Arena with DEX on Claude Opus 5.5

**How to start.** Read `benchmarks/waa/README.md` first. Then:
1. Open Windows Terminal (not as administrator) in the root of this repository.
2. Run:

   ```
   claude --dangerously-skip-permissions --model opus
   ```

3. Paste everything below the line.

If the PC has to restart partway through, open the terminal in the same place
again and run:

```
claude --dangerously-skip-permissions --model opus --continue
```

Then type `continue`.

---

You're in the DEX repository: an Electron desktop app for Windows whose agent
engine is Claude Code. Measure DEX on **Windows Agent Arena (WAA)**
(https://github.com/microsoft/WindowsAgentArena), its 154 tasks, with **DEX
running inside WAA's Windows 11 virtual machine**: its built-in browser, its
Windows app control and its tools all work there as on a real PC. Use DEX's
Claude Code engine on **Claude Opus 5.5**. Report a score that can be put next
to the published WAA numbers.

Everything runs on this PC. Install whatever is missing yourself. I started you
with `--dangerously-skip-permissions`, so run commands without asking me. Stop
only for the things in "What only I can do".

## Hard rules

- **No money.**
  - No Azure, no cloud machines, no paid APIs, no sign-ups for anything paid,
    and no Docker Desktop.
  - Use Docker Engine inside WSL2 Ubuntu.
  - The only cost is the Claude plan I'm signed in with. Never use an Anthropic
    or OpenAI API key.
  - If WAA's scripts want an OpenAI key for their own agent, give them a dummy
    value. We don't use their agent.
- **Never commit or print secrets:** the Claude token, keys or passwords. Never
  commit the Windows ISO, VM disks, the WAA checkout, or the files in DEX's
  `.gitignore`.
- **Keep a progress log** in `benchmarks/waa/PROGRESS.md`: what's done, what's
  next, and exact commands. Update it after every step, so a restart or a new
  session can carry on from it.
- **Don't change how DEX normally behaves.** If DEX has a bug that blocks the
  run, fix it in its own commit with a test, and keep DEX's tests green: in
  `desktop/app`, `npx tsc --noEmit -p .` and `npx vitest run`. Work on a
  branch, not `main`.
- **DEX must never see WAA's task files, checkers or expected answers.** It
  gets only each task's instruction.

## What only I can do

Ask me plainly, one thing at a time, and wait:
- Switch on virtualization in the BIOS/UEFI, if it's off. Task Manager ›
  Performance › CPU shows "Virtualization: Enabled" when it's on.
- Click **Yes** on Windows admin prompts. Before each one, tell me it's coming
  and why. Then check that it worked, because you can't see the prompt's
  result.
- Restart the PC when Windows needs it. Before asking, write `PROGRESS.md`.
- Download the **Windows 11 Enterprise Evaluation ISO** (free, 90 days) from
  Microsoft's Evaluation Center, if Microsoft's form stops you from getting it
  yourself. Tell me where to save it.
- Run `claude setup-token` in another terminal, for DEX inside the VM, and save
  the printed token to `%USERPROFILE%\waa-dex\claude-token.txt`. Read it from
  there. Never echo it, log it or commit it.

## Steps

1. **Check the PC.**
   - Windows 11, because nested virtualization in WSL2 needs it.
   - Virtualization is enabled.
   - Free RAM and disk: about 100 GB of disk is needed, on an SSD.
   - Write what you found to `PROGRESS.md`. If the PC is too small, say so and
     stop.
2. **WSL2 and Ubuntu.**
   - Install them if missing: `wsl --install -d Ubuntu --no-launch`, which
     needs an admin prompt and maybe a restart.
   - Set up Ubuntu without an interactive user, with `ubuntu.exe install --root`.
     Run commands in it as root: `wsl -d Ubuntu -u root -- bash -lc "..."`.
   - Write `%USERPROFILE%\.wslconfig` with `nestedVirtualization=true`. Give it
     a memory and processor share that leaves the VM 8 GB and 4–8 cores, and
     Windows enough to stay usable. Then run `wsl --shutdown`.
   - Check that `/dev/kvm` exists in Ubuntu.
3. **Docker Engine in Ubuntu**, not Docker Desktop.
   - Install it with apt.
   - Turn systemd on in `/etc/wsl.conf`, or start the service by hand.
   - Check that `docker run --rm hello-world` works, and that a container can
     use `/dev/kvm`.
4. **WAA.**
   - Clone `microsoft/WindowsAgentArena` inside Ubuntu's own file system
     (`/root/WindowsAgentArena`), not under `/mnt/c`, which is slow.
   - Follow its README for running locally:
     - its config file (dummy keys);
     - the Windows ISO renamed and placed where it says;
     - preparing the golden image (`--prepare-image true`), which takes a long
       time;
     - then one task with its own default agent to check that resetting and
       evaluating work.

     You only need the reset and evaluate parts to work; their agent can fail
     without an API key.
   - The VM's screen is at http://localhost:8006. Tell me that address so I can
     watch.
5. **DEX inside the VM.**
   - Find out how WAA resets the VM between tasks, and make everything below
     survive it. Put it in the golden image if a reset throws changes away.
   - Install, inside the VM:
     - Git, Node 22 LTS and yarn;
     - the Claude Code CLI;
     - DEX from source, at this repository's current commit.

     Use the same commit, not the v2.2.0 installer: later fixes matter for long
     runs, such as the one for "Browser pool full" after 10 tasks.
   - DEX starts at sign-in with:
     - `AGB_CDP_PORT=9225`;
     - `CLAUDE_CODE_OAUTH_TOKEN` from the token file, set as a user environment
       variable inside the VM only.

     Check that DEX's engine says Claude Code is signed in.
   - DEX settings in the VM:
     - Settings › Agent approval → Full access;
     - Settings › Desktop control → on;
     - the engine is Claude Code with the model Opus.
   - Change nothing else that WAA's tasks might check: no change to the default
     browser, no files on the desktop.
6. **The connection.** Keep the code in `benchmarks/waa/` in this repository,
   and copy it into the WAA checkout or the VM.
   - **In the VM:** `waa-task.mjs`, modelled on `dexAgent()` in
     `benchmarks/dex-bench/run.mjs`.
     - It connects to DEX's hub at `127.0.0.1:9225` and calls
       `window.electronAPI.sessions.create({ prompt, engine: 'claude-code', model: 'opus' })`,
       then `sessions.start(id)`.
     - It polls `sessions.get(id)` until the task is idle or stopped, or 30
       minutes pass.
     - It writes `{ answer, seconds, steps, model, status }` to a result file.
     - It waits out the plan's usage limit and runs the task again, as
       dex-bench's runner does.
     - If DEX isn't running, it starts DEX first.
   - **In WAA:** a `dex` agent, beside WAA's own agents, so WAA's own runner
     does the reset, the evaluation and the results files. Its first `predict`:
     - starts `waa-task.mjs` in the VM through WAA's in-VM server, detached;
     - polls for the result file;
     - returns `DONE`, or `FAIL` when DEX's answer says the task can't be done.

     Find out how WAA scores tasks that can't be done, and match it.
   - **The prompt DEX gets** is the task's instruction after this preface: "Do
     this on this PC. Use the apps the task names: the installed Chrome or
     Edge, LibreOffice, VS Code, VLC, File Explorer, Settings and so on. The
     check looks at those apps and files, so don't do the task in DEX's own
     browser (it's fine for looking something up). Don't ask questions; nobody
     will answer. If it can't be done, say 'INFEASIBLE' and why."
7. **Check the model.** Every task must resolve to `claude-opus-5-5`. DEX logs
   it as `session.model.resolved` in `%APPDATA%\DEX\logs\engine.log` inside
   the VM. If a task ran on another model, mark it, wait for the limit to reset
   and run it again.
8. **Order.**
   - First 3 tasks from different apps, as a smoke test. Look at the VM screen
     and logs, and fix what's broken.
   - Then estimate the full run's time from those 3, tell me, and run all 154
     tasks without waiting for me.
   - Run the benchmark as a background process, so this session isn't using the
     plan while it runs. Check on it about every 30 minutes, and resume it if it
     stops.
   - Results go to a file after every task, so a crash resumes where it
     stopped.
9. **Report:** `benchmarks/waa/results/REPORT.md`, with:
   - the success rate overall and by WAA's domains;
   - DEX's median time and actions per task;
   - the time limit;
   - a single run, no best-of-N;
   - what DEX could use (its Windows app control, accessibility tree,
     screenshots, browser and shell);
   - any task that was excluded or rerun, and why.

   Compare it with the published WAA numbers:
   - Agent S3, 56.6% best-of-N (Simular, Oct 2025);
   - Microsoft UFO2, 30.5% (arXiv 2504.14603);
   - Navi, 19.5%, and people, 74.5% (the WAA paper).

   Include links to the raw results. Commit the report and the code in
   `benchmarks/waa/` on the branch.

## Known DEX issue

A Store app that DEX opens again, such as Calculator, can be wrongly treated as
"the user took over". That's DexDesk `Watch()` in
`desktop/app/mcp-servers/windows/host/DexDesk.cs`: the foreground change plus
any input in the same 2 s. Inside the VM, nobody touches anything, so it should
be rare. If it happens, note the task in the report. Don't change DEX in the
middle of a scored run.
