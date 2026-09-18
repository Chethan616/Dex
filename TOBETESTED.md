# To be tested

Written 2026-09-18. This is on **branch `feat/os-registry-tools`** (off
`v3/dex`) — separate from `feat/file-search`, `fix/browser-toggle-blank-screen`,
and `feat/desktop-uia-cua`, which each have their own `TOBETESTED.md`. None of
this is merged or pushed yet.

```
git checkout feat/os-registry-tools
cd desktop/app
yarn
npx electron-forge start
```

## dex-sh — a cross-shell wrapper

I live-tested all four shells directly (bash, cmd, powershell, wsl) plus the
timeout path. What I couldn't test: the agent actually reaching for it when
it should.

- [ ] Ask DEX to do something that's genuinely easier via `cmd` or
      `powershell` builtins than Bash (e.g. reading a Windows service's
      status, or a WMI-ish query) and see whether it uses `dex-sh` rather
      than fighting Bash-isms for something Windows-native.
- [ ] Force a failure in one shell and see whether it retries through
      another using the exit code / stderr `dex-sh` gives back, per the
      "diagnose and retry on a different shell" verify criterion in the
      plan — this is a judgment call by the agent, not something I could
      test statically.

## dex-registry — read freely, write only with your approval

This is the one built specifically to need YOUR click, not just testing.
I verified the whole mechanism end to end myself using a mock control
server (so I could simulate both an "approve" and a "deny" answer without
a real running app) against a fully disposable `HKCU\Software\...` test
key — never anything you have on this machine already:

- Read/get/search/export against a real key, correct results
- **A real bug I found and fixed**: `search` was materializing an entire
  subtree before applying its own result limit — a search rooted at
  `HKCU\Software` took about 90 seconds for one hit. It's a bounded,
  early-terminating walk now: same search, under half a second.
- **Another real bug I found and fixed**: `reg.exe export`/`import`
  succeeding was being reported as a failure, because redirecting a native
  command's stderr inside PowerShell wraps it in an ErrorRecord regardless
  of the actual exit code, and `$ErrorActionPreference = "Stop"` turned
  that into a thrown exception. `reg.exe import` actually restored the key
  correctly the whole time; only the JSON result lied about it.
- Full backup → delete → restore round-trip, confirmed byte-for-byte via
  read-back
- The full confirm-flow plumbing: `set` with a mocked "approve" actually
  wrote the value; `delete` with a mocked "deny" left the key completely
  untouched, exit code 1, correct error message

What I could NOT test without the real app running: **the actual
confirmation card rendering and being clickable in the UI**. I wired
`ConfirmationCard` into `PreviewDeck`, the IPC round trip
(`window.electronAPI.dex.confirmAnswer`), and the stuck-timer suspension
(unit-tested with fake timers, not a real 30-second wait) — but none of
that proves the card actually *looks right* or that clicking Approve/Deny
in the real window does what the code says it does.

- [ ] Ask DEX to make some harmless registry change (a value under your own
      `HKCU\Software`, not a system key) and confirm:
  - [ ] A card appears in the preview pane with a plain-language description
        of exactly what will change, and it reads clearly — this is a first
        design pass, not something I could iterate on without seeing it.
  - [ ] **Approve** actually applies the change; **Deny** actually blocks it
        (the mock testing proved the plumbing works; this proves the UI
        wired to it does too).
  - [ ] The card shows up even if you're mid-browser-task when it fires —
        I added an override so the deck forces itself up over a live page
        for this specific case, but haven't seen it happen live.
  - [ ] The session does NOT get marked "stuck" while the card sits
        unanswered for longer than 30 seconds (take your time on purpose).
- [ ] Confirm the backup file's path shown in the card is one you can
      actually go look at afterward (under `%TEMP%\dex-registry-backups\`
      by default).
- [ ] Try denying a change and confirm DEX's own follow-up response
      acknowledges the denial sensibly rather than retrying the same write
      immediately or claiming success.

## Known, disclosed gaps (not bugs — deliberate scope calls)

- `import` does not auto-back-up (a `.reg` file's blast radius isn't known
  without parsing it) — the skill doc tells the agent to `export` anything
  it expects the import to touch first, but nothing enforces that.
- `dex-registry search`'s depth cap (10) and early-exit-on-maxResults bound
  the walk, but a query with *no match* under a very broad root can still be
  slow in the worst case — it just won't be catastrophically slow the way
  the pre-fix version was.
- Nothing technically stops the agent from calling `reg.exe` directly
  through its own Bash tool instead of `dex-registry`, bypassing the
  confirmation entirely. This is doctrine (`registry.md` says not to),
  not a sandboxed enforcement — the same category of gap as MCP-first and
  the desktop-control fallback ladder elsewhere in AGENTS.md.
- `hasBrowser` (from the separate `fix/browser-toggle-blank-screen` branch)
  may have a second gap: `sessions:list`/`sessions:get` in `main/index.ts`
  compute it fresh via `!!browserPool.getWebContents(id)`, which is true for
  virtually every session (a view is created for every task regardless of
  type) — a periodic refresh of the session list could re-introduce the
  "Continue browsing" button for a non-browser task even after that fix.
  I found this while reading nearby code for this branch's confirmation
  route; I have NOT fixed it, since it lives in a different branch and
  wasn't what I was asked to do here. Worth a fast follow-up.
