# Skill: shell access and the Windows registry

**If a task touches the Windows registry — reading or writing, any hive —
use `dex-registry` below, never a shell's own registry cmdlets.** That means
none of `Get-ItemProperty`, `Set-ItemProperty`, `New-ItemProperty`,
`Remove-ItemProperty`, `Get-Item`/`Remove-Item` on a `HKLM:`/`HKCU:`/etc.
path, or `reg.exe` — whether you run them through a `Bash` tool call, a
`PowerShell` tool call, or anything else you have natively. It does not
matter that a plain read looks harmless: `dex-registry` is the only path
that puts a write through the confirmation card at all, and reaching for a
native shell tool "just to read" is exactly the habit that leads to also
using it for the write a moment later. If your task involves the registry
in any way, this file is not optional background reading.

## `dex-sh` — a shell you might not already have

Your own Bash tool already covers most filesystem, process, and general
shell work — reach for that first. Use `dex-sh` specifically when you want
a *different* shell (cmd's own builtins, a PowerShell cmdlet, WSL) or when
you want the structured result and timeout this gives for free:

```bash
dex-sh powershell "Get-Service -Name Spooler | Select-Object Status" 15
dex-sh cmd "ipconfig /all" 10
dex-sh wsl "cat /etc/os-release" 10
```

Always returns `{"exitCode":N,"timedOut":bool,"stdout":"...","stderr":"..."}`
— the same shape whichever shell ran it, so if one shell fails for an
environment-specific reason (a missing tool, a PATH difference), you can
retry through another and compare the exact exit code and stderr rather
than just "it didn't work." `timedOut:true` (exit code 124) means the
timeout you gave it ran out — distinct from the command's own failure.

**A call can come back `{"exitCode":126,"stderr":"command not approved"}`
without ever running.** This is not `dex-sh` itself gating anything — it's
the session's own approval policy (the Settings pane's "Agent approval"
mode; the default, Full access, never sees this). If it
happens, say so plainly rather than retrying the same command — a retry
waits on the same confirmation card the first call already put up.

### `dex-sh session` — when one command isn't the point, a shell you keep is

The one-shot form above spawns a fresh process every call — nothing about
its working directory, environment, or a virtualenv you activated survives
to the next call. For a task that's genuinely several commands building on
each other in the same place (`cd` into a repo once, then run a few things
against it), start a session instead of re-establishing that context every
time:

```bash
dex-sh session start bash            # -> {"shellSessionId":"..."}
dex-sh session run <id> "cd myrepo"
dex-sh session run <id> "npm install"
dex-sh session run <id> "npm test"   # still inside myrepo — same live shell
dex-sh session end <id>              # always clean up when the task is done
```

`run` returns `{"exitCode":N,"timedOut":bool,"output":"..."}` — `output`
carries both what a one-shot call would split into stdout and stderr,
since a real terminal session doesn't keep those separate either. Each
`run` goes through the same approval policy the one-shot form does, so the
same `{"approved":false}`/`"command not approved"` case can happen here
too. Use the plain one-shot form for anything that's genuinely a single
command — a session is for when the *sequence* matters.

## `dex-registry` — reading is free; writing needs the user

Reading the registry is exactly as available as any other `dex-*` tool:

```bash
dex-registry read "HKCU\Software\SomeApp"
dex-registry get "HKCU\Software\SomeApp" "InstallPath"
dex-registry search "HKCU\Software" "SomeApp" 20
dex-registry export "HKCU\Software\SomeApp" "$DEX_DESKTOP_DIR/someapp-backup.reg"
```

`<path>` is hive-qualified: `HKLM\...`, `HKCU\...`, `HKCR\...`, `HKU\...`,
`HKCC\...` (long forms like `HKEY_CURRENT_USER` also work). `search` walks
depth-first and stops as soon as it has enough hits — pass a narrower root
than "all of HKCU" when you can, since a search that finds nothing still has
to walk everything under the root before giving up.

**Writing is different.** `set`, `delete`, and `import` never just happen:

```bash
dex-registry set "HKCU\Software\SomeApp" "Enabled" "1" DWord
dex-registry delete "HKCU\Software\SomeApp" "Enabled"     # one value
dex-registry delete "HKCU\Software\SomeApp"               # the whole key
dex-registry import "C:\path\to\file.reg"
```

Each of these backs up the affected key first (`set`/`delete` only — see
below for `import`), builds a plain description of exactly what is about to
change, and **blocks on a real person answering a card in the app** before
touching anything. There is nothing you can do to skip this — it is not a
flag, it is the tool. If the user denies it, the command exits non-zero with
`{"ok":false,"error":"the user denied this registry change"}` and nothing
was written; say so plainly rather than trying another way to make the same
change.

**`import` does not auto-back-up.** A `.reg` file can touch several keys at
once, and which ones aren't knowable without parsing the file yourself. If
you want the change to be undoable, `export` the specific keys you expect it
to affect *before* calling `import`.

## When this is genuinely the right tool

Registry changes are for real configuration work the user actually asked
for — toggling a documented setting, reading an installed app's config.
Reach for it the same way you'd reach for `dex-uia` over guessing screen
coordinates: because it is the structured way to do something you already
know needs doing, not a shortcut past confirming the plan with the user
first when the task itself is ambiguous.

**Nothing technically stops you from touching the registry yourself** —
`reg.exe`, or PowerShell's `Set-ItemProperty`/`New-ItemProperty`/
`Remove-ItemProperty`/`Remove-Item`, through a `Bash` or `PowerShell` tool
call instead of `dex-registry`. Permissions are not gated at that level.
Don't — the whole safety of this tool is the confirmation card, and driving
the registry directly bypasses it entirely, silently, with no card, no
backup, and no record of what changed or why.
