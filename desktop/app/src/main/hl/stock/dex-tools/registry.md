# Skill: shell access and the Windows registry

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

**Nothing technically stops you from calling `reg.exe` yourself through
Bash instead of `dex-registry`.** Permissions are not gated at that level.
Don't — the whole safety of this tool is the confirmation card, and driving
the registry directly bypasses it entirely.
