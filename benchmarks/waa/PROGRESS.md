# WAA progress log

Keep this current: what's done, what's next, exact commands. A restart or new
session resumes from here.

## Environment (checked 2026-10-21)

- Windows 11 Home, build 26300. Virtualization enabled in firmware.
- RAM: 16 GB total (README recommends 32 GB; "works, but slowly" per its own notes).
- CPU: AMD Ryzen 9 5980HX, 8 cores / 16 threads.
- **C: drive was almost full (7.6 GB free).** Freed by:
  - Uninstalling Docker Desktop (not used here anyway — the hard rule is Docker
    Engine inside WSL2 Ubuntu, not Docker Desktop). Freed ~42 GB.
  - Moving the default `Ubuntu` WSL distro from C: to **D:\WSL\Ubuntu**
    (export → unregister → import). Freed ~17.7 GB more.
  - C: now ~70 GB free, D: ~236 GB free. Everything for this benchmark lives
    on D: via the Ubuntu distro's vhdx.
- `C:\Users\cheth\.wslconfig`: `memory=12GB, swap=4GB, processors=6,
  nestedVirtualization=true`.
- **Blocker found and fixed (pending restart):** Core Isolation > Memory
  Integrity (HVCI) was on, which prevents Hyper-V from exposing nested
  virtualization (VMX/SVM) to the WSL2 guest — `/dev/kvm` was missing even
  with everything else correct. Gave the user the exact admin PowerShell
  command + restart (not done by me: needs elevation I don't have, and it's a
  security-relevant toggle the user should consciously make).
  ```
  Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity" -Name "Enabled" -Value 0 -Type DWord
  Restart-Computer
  ```
  To re-enable afterward: same command with `-Value 1`, restart.
- Docker Engine 29.9.2 installed in Ubuntu via apt (docker-ce, not Desktop).
  `docker run --rm hello-world` passed. User `cheth` added to `docker` group.
- Working on git branch `waa-benchmark` (off `unify`), not `main`.

## Done

1. Freed disk space, moved Ubuntu distro to D:, enabled nested virt in
   `.wslconfig` (step 1-2 of PROMPT.md).
2. Installed Docker Engine in Ubuntu (step 3). Verified with hello-world.
3. Cloned `microsoft/WindowsAgentArena` into `/root/WindowsAgentArena` inside
   Ubuntu (on D: via the distro's vhdx), not under `/mnt/c` (step 4).
4. Converted WAA's `.sh` scripts to Unix line endings (its own README note for
   WSL2) and made them executable.
5. Wrote `/root/WindowsAgentArena/config.json` with a dummy OpenAI key (hard
   rule: no paid APIs; WAA's own agent won't be used, only DEX).
6. Started `./scripts/build-container-image.sh` in the background inside
   Ubuntu (log: `/root/build-image.log`). This builds `winarena:latest`,
   pulling `windowsarena/winarena-base:latest` (~17 GB) from Docker Hub on the
   way. Doesn't need KVM, so it runs while waiting on the restart below.

## Blocked on the user

- **Restart the PC** after disabling Memory Integrity (command above). Once
  done, tell me and I'll verify `/dev/kvm` and continue.
- **Windows 11 Enterprise Evaluation ISO** (~6 GB, free 90-day trial) from
  https://info.microsoft.com/ww-landing-windows-11-enterprise.html — its
  download form needs a JS-rendered signup I can't script. Save it anywhere;
  I'll move it into place.

## Next (once unblocked)

1. Verify `/dev/kvm` exists; check the container image build finished
   (`tail /root/build-image.log` inside Ubuntu).
2. Move/rename the ISO to
   `/root/WindowsAgentArena/src/win-arena-container/vm/image/setup.iso`.
3. `cd scripts && ./run-local.sh --prepare-image true` — builds the ~30 GB
   golden image, ~20 min, watch at http://localhost:8006, don't touch the VM
   while it provisions.
4. Install inside the VM: Git, Node 22 LTS, yarn, Claude Code CLI, DEX from
   source at this repo's current commit (not the v2.2.0 installer).
5. `claude setup-token` (the user runs this, saves the token to
   `%USERPROFILE%\waa-dex\claude-token.txt`).
6. DEX inside the VM: `AGB_CDP_PORT=9225`, `CLAUDE_CODE_OAUTH_TOKEN` from the
   token file, Settings > Agent approval > Full access, Settings > Desktop
   control > on, engine Claude Code / model Opus.
7. Write `waa-task.mjs` (modelled on `dexAgent()` in
   `benchmarks/dex-bench/run.mjs`) and the `dex` WAA agent per PROMPT.md step 6.
8. Smoke test 3 tasks, then the full 154-task run as a background process,
   checked every ~30 min.
9. `benchmarks/waa/results/REPORT.md` per PROMPT.md step 9.
