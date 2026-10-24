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

## Update (same day, after first restart)

- First restart: HVCI scenario (`HypervisorEnforcedCodeIntegrity\Enabled`) is
  now 0, but **the master VBS flag was still on**
  (`HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard\EnableVirtualizationBasedSecurity = 1`).
  Disabling just the inner HVCI scenario isn't enough; nested virt also needs
  the outer VBS flag off. Gave the user one more command + restart:
  ```
  Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard" -Name "EnableVirtualizationBasedSecurity" -Value 0 -Type DWord
  Restart-Computer
  ```
- Credential Guard (`HKLM:\SYSTEM\CurrentControlSet\Control\LSA\LsaCfgFlags`)
  is not configured, so nothing else should be forcing VBS back on at boot.
- Docker's systemd service auto-starts on WSL boot (enabled earlier) —
  confirmed working after the restart with no manual steps.
- Restarted the background image build (`build-container-image.sh`); the
  first restart killed the in-progress pull, as expected, no real loss since
  it was only ~150MB into a 14GB layer. Still pulling.

## Update: VBS still "Running" after both registry disables

- After disabling both `HypervisorEnforcedCodeIntegrity\Enabled` and the
  master `EnableVirtualizationBasedSecurity`, and a full `wsl --shutdown` +
  fresh relaunch, `/dev/kvm` and the `svm` cpuinfo flag are still missing.
- `Get-CimInstance Win32_DeviceGuard` still reports
  `VirtualizationBasedSecurityStatus = 2` ("Running") even with both flags
  at 0. `SecurityServicesRunning = {0}` (none), so HVCI/Credential Guard
  specifically are confirmed off — something else is still keeping the VBS
  Secure Kernel container active (most likely Windows Hello "Enhanced
  sign-in security", which was the one DeviceGuard scenario still
  `Enabled = 1` — `WindowsHello` scenario).
- No Group Policy override found at
  `HKLM:\SOFTWARE\Policies\Microsoft\Windows\DeviceGuard` (key doesn't
  exist), so this isn't policy-enforced.
- Gave the user the decisive fix: disable VSM (Virtual Secure Mode) itself
  at the boot-config level, which backs all VBS features regardless of
  which one is using it, while leaving Hyper-V itself on for WSL2:
  ```
  bcdedit /set vsmlaunchtype off
  Restart-Computer
  ```
  Revert later with `bcdedit /set vsmlaunchtype auto` + restart.
- Image build died mid-pull with an "Unavailable ... EOF" error the first
  time a restart happened mid-pull — expected (dockerd goes down with WSL on
  restart); not a real problem, just restart it again once kvm is confirmed.

## Root cause found: KB5127648 (not a config issue at all)

After 4 restarts and disabling HVCI, master VBS, and VSM entirely, `/dev/kvm`
was still missing. Web search turned up multiple open microsoft/WSL GitHub
issues (#41947, #41955, #41917, #41968, #41918) describing this exact
symptom: **Windows Update KB5127648 broke nested virtualization specifically
on AMD hosts** — missing `svm` flag in `/proc/cpuinfo`, `/dev/kvm` gone,
`modprobe kvm_amd` fails with "Operation not supported", HCS
`ProcessorCapabilities` query fails with `0x8007000D`. The documented
workaround is uninstalling the KB.

Confirmed installed here: `Get-HotFix -Id KB5127648` → installed
2026-10-15, on build 26300. This explains why every VBS/HVCI/VSM change
(all legitimate, all correctly applied) never fixed it — none of that was
the actual cause.

All the VBS/HVCI/VSM changes made along the way are harmless to leave as
they are (security posture is slightly reduced until re-enabled, user's
choice) — they just weren't the fix.

Fix given to the user (needs admin):
```
wusa /uninstall /kb:5127648 /quiet /norestart
Restart-Computer
```

## Fixed: /dev/kvm now present

Removing `Package_for_RollupFix~31bf3856ad364e35~amd64~~26100.9711.1.30`
(the real DISM package backing KB5127648) via
`Remove-WindowsPackage -Online` and restarting worked.
`/dev/kvm` exists, `svm` and `npt` are in `/proc/cpuinfo` flags. Confirmed
`Get-HotFix -Id KB5127648` returns nothing — it's gone. Nested
virtualization is live. Total restarts needed: 4 (HVCI, master VBS, VSM
boot flag tried first and were real but insufficient fixes; the actual
cause was this specific Windows update).

**Note for later:** Windows Update will likely try to reinstall this same
rollup on its next run, which would silently re-break /dev/kvm. Worth
pausing updates for a few weeks, or at least checking `/dev/kvm` again
after any future Windows Update before assuming the environment is still
good, for a sanity check if WAA runs start failing with VM provisioning
errors down the line.

Continuing with PROMPT.md step 4 (ISO placement + prepare-image) now that
the environment is finally ready.

## Build failure: corrupted containerd cache (from the earlier interrupted pulls)

After nested virt was fixed, the image build ran uninterrupted for ~28 min
(2.8GB of the big layer) but then failed:
```
ERROR: failed to build: failed to solve: failed to compute cache key:
failed call to UtimesNanoAt for .../overlayfs/snapshots/20/fs/root:
no such file or directory
```
Cause: the three earlier builds that got killed mid-pull (by the Windows
restarts while chasing the KB5127648 fix) left inconsistent containerd
snapshot state. `docker builder prune -a -f` + `docker system prune -a -f`
reclaimed ~5GB of broken layers, `systemctl restart docker`, then restarted
the build. It's now pulling from 0 again (loses prior progress, but the
cache was unusable anyway).

## Build failed again, same error, with NO interruption this time

Second occurrence of the identical
`UtimesNanoAt .../overlayfs/snapshots/N/fs/root: no such file or directory`
error, but this time the build ran uninterrupted the whole way (no WSL
restart in between) and still hit it at the exact same stage (`FROM
build_azure`, i.e. the moment BuildKit tries to snapshot the freshly pulled
base image to use as a build stage). This rules out "leftover corruption
from earlier kills" as the sole cause — it looks like a real incompatibility
between BuildKit's containerd/overlayfs snapshotter and this WSL2 ext4/vhdx
filesystem on repeated large-layer builds.

Trying the standard workaround: force the classic (non-BuildKit) builder
with `DOCKER_BUILDKIT=0`, which uses the Docker daemon's own storage driver
instead of BuildKit's containerd snapshotter, sidestepping this bug class
entirely. Pruned the cache again and retrying.

## Classic builder worked past the overlayfs bug, then hit a network EOF

With `DOCKER_BUILDKIT=0`, all 13 small layers of `winarena-base:latest`
reached "Pull complete" — further than BuildKit ever got, confirming the
overlayfs/containerd snapshotter bug is sidestepped. But the build then
died before either of the two big layers (`d07febdf5eb2` 14.37GB,
`0ba6df935b97` 3.36GB) finished:
```
failed to copy: failed to send write: EOF
```
A plain network/transport interruption, unrelated to the overlayfs bug.
Restarted the build again with `DOCKER_BUILDKIT=0`, this time without
pruning the cache. The classic puller re-pulls layers from the registry on
retry rather than resuming mid-file (even small already-"Pull complete"
layers get re-downloaded, just fast since they're small); confirmed it is
progressing again and watching for it to reach the two big layers.

## ISO copy into place

Started copying the user's Windows 11 Enterprise Evaluation ISO (confirmed
correct edition, 8,225,329,152 bytes, from
`C:\Users\cheth\OneDrive\Desktop\26300.9457.260913-1737.26h2_ge_release_svc_refresh_CLIENTENTERPRISEEVAL_OEMRET_x64FRE_en-us.iso`)
into `/root/WindowsAgentArena/src/win-arena-container/vm/image/setup.iso`.
First attempt's background job silently never started (shell quoting
issue when backgrounding through a nested `wsl -d Ubuntu -u root -- bash
-lc "..."` wrapper — no log file, no destination file, no process ever
existed). Relaunched directly inside an interactive `wsl` bash session this
time; confirmed a real `cp` process running (PID 2076). Watching
`/root/iso-copy.log` and the destination file size for completion.

## Root cause found: corrupted edition-validation data in the 26H2 eval ISO

`setuperr.log` from inside WinPE showed the real error:
`CDlpActionProductKeyValidate::ValidateEICfgFile(2051): Result = 0x80070570`
(`ERROR_FILE_CORRUPT`). This is Setup validating the install.wim's embedded
edition-identification data, and it's corrupted — confirmed via real log
output, not guesswork. This explains why every variation failed identically
(no key, generic key, image-index override, ei.cfg, fully-manual zero-config
install all hit the exact same error at the exact same point). The
26300.9457 "26H2" Evaluation Center ISO itself is bad.

Also found and fixed two real bugs along the way while narrowing this down:
- QEMU/KVM crash (`cpu_asidx_from_attrs` assertion, `smm=on`) — fixed by
  using the non-secure firmware variant and 6 vCPUs (not 8, matching KVM's
  own recommended limit for this host).
- dockur's `install.sh` hardcodes `BOOT_MODE=windows_secure` (forcing the
  crash-triggering secure+TPM firmware) whenever `MANUAL=Y` and a Windows 11
  version is detected, with no env var to override — patched a local copy
  (`/root/install_patched.sh`, bind-mounted over `/run/install.sh`) to skip
  that forced override.

Tested and ruled out (not the cause): unattend file variations, ei.cfg,
image-index selection, and VM network connectivity (tried fully blocking
the VM's network, both via iptables — ineffective, bridged traffic bypasses
`FORWARD` without `br_netfilter` — and via `ip link set qemu down`, a true
link-down; error persisted identically either way).

## Switching to a UUP Dump 24H2 Enterprise ISO

Decision: get a clean Windows 11 24H2 (build 26100.9711) Enterprise ISO via
uupdump.net instead of the broken 26H2 Evaluation Center media. User
downloaded the UUP dump conversion package
(`26100.9711_amd64_en-us_professional_ac94e557_convert_virtual.zip`, saved
to D: per the "don't use C:" instruction) using: Windows 11 24H2 (26100.9711)
amd64 → English (US) → edition Windows Pro + "Download, add additional
editions and convert to ISO" → only "Windows Enterprise" checked under
additional editions, "Include updates" unchecked.

Extracted into `/root/uup/` in WSL (already on D: via the relocated distro)
and ran `uup_download_linux.sh` (installed `unzip` via apt first). The
9.76GB download keeps getting interrupted by **WSL itself restarting**
mid-download (confirmed via `dmesg`: `systemd-journald received SIGTERM
from PID 1 (systemd-shutdow)`, journal corruption messages) — this is the
same host-level WSL flakiness seen earlier in this session, unrelated to
the download itself. aria2 resumes cleanly each time (no re-downloading of
completed files), so wrote `/root/uup/retry_loop.sh` to auto-resume up to
50 times and left it running in the background.

## Paused for battery (user request, 2026-10-23)

User asked to stop all benchmark-related background work to save laptop
battery while a separate (unrelated) task runs. Stopped the retry loop,
aria2, and the stray `rawtest2` container (already exited). **Nothing
destructive was removed** — `/root/uup/UUPs/` (partial download, resumable),
`/root/install_patched.sh`, and all WAA/dockur state are untouched on disk.

**To resume:** `wsl -d Ubuntu -u root -- bash -lc "cd /root/uup && nohup
./retry_loop.sh > /dev/null 2>&1 & disown"` — will pick up the download
where it left off. Once the ISO is built, swap it in for
`/root/WindowsAgentArena/src/win-arena-container/vm/image/setup.iso` (back
up the current broken one first, or just overwrite since it's confirmed
bad) and retry `--prepare-image true` with the already-fixed config: 6
vCPUs, the patched `install_patched.sh` bind-mounted over `/run/install.sh`,
`MANUAL=Y` only if the new ISO somehow needs it (it likely won't, since
24H2 is the well-tested mainstream build — try the plain automated path
first before reaching for MANUAL mode again).

## Next, concretely

1. Watch `/root/build-image.log` until it either completes
   (`Successfully tagged winarena:latest`) or fails again at the big
   layers; if it fails with the same network EOF, just retry again without
   pruning (small layers are cheap to re-fetch, no need to throw away that
   progress).
2. Watch `/root/iso-copy.log` / destination file size until it reaches
   8,225,329,152 bytes.
3. Once both are done: check in with the user before running
   `cd scripts && ./run-local.sh --prepare-image true` (takes over the VM
   display at http://localhost:8006 for ~20 minutes).

## ISO done; classic builder hit a new bug (tini/getopt), reverted to BuildKit

ISO copy confirmed complete: 8,225,329,152 bytes at
`/root/WindowsAgentArena/src/win-arena-container/vm/image/setup.iso`
(first background-copy attempt silently never started — a shell quoting
issue backgrounding through the nested `wsl ... -- bash -lc "..."`
wrapper; relaunched directly in an interactive session and confirmed a
real `cp` PID running this time).

The classic-builder (`DOCKER_BUILDKIT=0`) retry from the network-EOF
failure got as far as the base image's `ONBUILD COPY` step, then sat with
the container stuck in Docker's "Created" state (PID 0, never actually
started) for 10+ minutes. Root-caused two layered problems:
1. The ISO being present inside the WAA repo tree
   (`src/win-arena-container/vm/image/setup.iso`, whitelisted by WAA's own
   `.dockerignore`) bloated the build context from 4.3MB to 8.23GB on every
   build attempt. Moved it out to `/root/setup.iso.tmp` before building;
   move it back before `--prepare-image`.
2. Even with the small context, the same step hung again. Manually running
   `docker start -a <container>` on the stuck container showed the real
   problem instantly: `/usr/bin/tini: invalid option -- 'c'` — a
   getopt-permutation bug where tini (the base image's PID 1 /
   `ENTRYPOINT`) scans the whole argv for options rather than stopping at
   the first positional arg, and trips over the `-c` in the appended
   `/bin/sh -c '...'` build-step command. This is baked into
   `windowsarena/winarena-base:latest`'s own entrypoint, not anything in
   our scripts, and it only surfaces under the classic/legacy builder
   (which invokes ENTRYPOINT literally for `ONBUILD`/`RUN` steps); the
   classic builder's own wait-for-exit logic also never noticed the
   failure and just sat there, which is why it looked like a plain hang
   rather than a fast error.

Since BuildKit sidesteps this (it doesn't run steps through the image's
own entrypoint the same way), and the earlier BuildKit overlayfs
snapshotter bug might have been transient (tied to the leftover corrupted
cache from the restart-cycle era, already pruned since), switched back to
plain BuildKit (no `DOCKER_BUILDKIT=0`) and retried. This got past the
exact point where BuildKit failed twice before (`FROM build_azure`
extraction) cleanly — all small layers extracting fine, confirming the
earlier bug is not reproducing now. Watching for the two big layers
(14.37GB, 3.36GB) to extract; one is in progress as of this note.

Note: had one build-process duplication bug on my end (a classic-builder
`docker build` process didn't exit after its container was removed out
from under it, and a second BuildKit build was started on top of it) —
killed the stale process; only the real BuildKit build is running now.

Also hit one case of WSL itself freezing solid (unrelated to Docker)
during a `mv`/cleanup command; recovered with `wsl --shutdown` then a
fresh `wsl -d Ubuntu ...` call. Worth keeping in mind if a command ever
times out with no output at all — try shutdown/restart before assuming
anything else is wrong.

## Image build succeeded

`winarena:latest` built and tagged successfully with plain BuildKit
(44.2GB disk usage, 18.2GB content size). The earlier BuildKit overlayfs
snapshotter bug did not recur — it was tied to the leftover corrupted
cache from the restart-cycle era, which pruning had already cleared.
Moved the ISO back into place:
`/root/WindowsAgentArena/src/win-arena-container/vm/image/setup.iso`,
confirmed at the correct 8,225,329,152 bytes.

Step 4 of PROMPT.md (WAA setup) is now otherwise complete: repo cloned,
config.json written, ISO in place, image built. Next is
`cd scripts && ./run-local.sh --prepare-image true`, which takes over the
VM display at http://localhost:8006 for about 20 minutes to provision the
golden image — checking with the user before starting this, since it
takes over the display.
