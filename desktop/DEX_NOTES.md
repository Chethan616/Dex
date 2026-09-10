# DEX fork notes

This is a fork of [`browser-use/desktop`](https://github.com/browser-use/desktop)
(MIT), branched from tag **v0.0.31** onto `dex-fork`. Upstream `LICENSE` and
attribution are preserved.

Why a fork rather than the published app: DEX needs to change how the browser
engine is launched and, later, to add DEX's own desktop/OS/file agents. The
first of those turned out to be necessary immediately — see
[Harness routing](#harness-routing) below.

---

## Setup prerequisites (Windows)

These are easy to lose and invisible from the source alone. All were required
to get a working setup.

| Requirement | Value on the dev machine | Notes |
|---|---|---|
| Node | **22.23.2** via `fnm` | `package.json` demands `20.x \|\| 22.x`. System Node 24 is **rejected** by yarn's engine check. `fnm` keeps the system Node untouched. |
| Package manager | **yarn 1.22.x** | `npm install` fails on a `@visx/*` React 19 peer conflict. There is a `yarn.lock`; use it. |
| `browser-harness` | Python pkg, PyPI **0.1.13** (py 3.12) | Background daemon. Check with `browser-harness --doctor`. |
| `browser-harness-js` | vendored in this repo | `app/src/main/hl/stock/browser-harness-js/sdk/`. Needs Bun + Git Bash. |
| Bun | **1.4.2** | `irm bun.sh/install.ps1 \| iex`. Bootstrapped by the harness script if missing. |
| Git for Windows | `D:\Git` on this machine | Supplies `bash.exe`. Location matters — see below. |
| Visual Studio | VC++ v143 toolset, **no Windows SDK** | Enough, because native rebuilds are skipped. See [node-pty](#node-pty). |

Run the app:

```powershell
fnm use 22          # or ensure node -v reports 22.x
cd desktop/app
yarn install
npm start
```

A healthy harness looks like:

```
browser-harness --doctor
  [ok  ] chrome running
  [ok  ] daemon alive
  [ok  ] active browser connections — 1
  [FAIL] Browser Use cloud auth — optional
```

**Cloud auth failing is expected and fine.** DEX runs browser-use fully
locally; the cloud path is deliberately unused. It is marked *optional*
upstream.

---

## How the browser is actually driven

The Electron/TypeScript side never speaks CDP directly in the healthy path. It
shells out to a vendored CLI, which owns a persistent REPL that holds the CDP
connection:

```
Electron main (TypeScript)
  └─ engine adapter (claude-code / codex / browsercode)
       └─ browser-harness-js            ← .cmd shim → Git Bash → bash script
            └─ Bun
                 └─ CDP REPL server     ← long-lived, port = CDP_REPL_PORT
                      └─ CDP  ──────────► Chrome/Chromium (port 9222)
```

- The bridge is `app/src/main/hl/harness.ts`, which vendors the CLI out of
  `src/main/hl/stock/browser-harness-js/` into the runtime harness dir.
- Agents call it as a **command**, not a tool schema — e.g.
  `browser-harness-js 'await session.Page.navigate({url:"https://example.com"})'`.
  See `src/main/hl/stock/helpers.js`.
- `applyBrowserHarnessEnv` (`src/main/hl/engines/browserHarnessEnv.ts`) builds
  the child environment: prepends the SDK dir to `PATH`, derives a per-session
  `CDP_REPL_PORT`, sets the log path, and (our change) resolves `bash.exe`.
- `browser-harness` (the **Python** package) is a separate component with its
  own daemon and its own CLI (`'print(page_info())' | browser-harness`). It is
  not on the Electron→browser path above.

**Consequence for DEX:** the agent loop and LLM calls live on the
Electron/TypeScript side. So DEX's future `can_browse_web` becomes a call into
the Electron main process — no Python browser dependency is required.

---

## Fork changes

### Harness routing

**Symptom:** the agent worked, but drove Chrome through a raw-CDP PowerShell
fallback (`cdp.ps1`) instead of the harness — quietly, at reduced capability,
with nothing in the log saying so.

**Cause:** `browser-harness-js.cmd` searches only `%ProgramFiles%`,
`%ProgramFiles(x86)%` and `%LocalAppData%\Programs\Git` for `bash.exe`, then
falls back to `%BROWSER_HARNESS_JS_BASH%` from the ambient environment. With
Git installed at `D:\Git`, none of the three match, so everything depended on
that variable arriving — and it does not. Setting it at User scope only
affects processes created *afterwards*, so an already-running Electron app (or
one launched from a shell that predates the change) never sees it. Verified
directly: the variable was correct in the registry and absent from every
running process.

**Fix:** `applyBrowserHarnessEnv` resolves `bash.exe` itself and passes it
explicitly into the child env — an existing valid override wins, then the
standard installs, then derive it from wherever `git` really is on `PATH`
(this is what covers non-default drives). If nothing is found it now logs
loudly rather than degrading in silence.

Covered by `app/tests/unit/hl/browserHarnessEnv.test.ts`, including the
Git-on-`D:` case.

### node-pty

`electron-forge start` ran `@electron/rebuild` over `node-pty`, which needs a
full VC++ toolchain **including the Windows SDK**. Without the SDK, node-gyp
failed and took startup down before the app could launch.

The rebuild was pointless: node-pty ships N-API prebuilds under
`prebuilds/win32-x64/`, and N-API is ABI-stable across Node *and* Electron, so
the shipped binary already works. Excluded from both rebuild paths in
`forge.config.ts` (`rebuildConfig.ignoreModules`, and the `packageAfterPrune`
hook).

Note: `node-pty` is used only by `src/main/identity/codexLogin.ts` — Codex
OAuth. It is not on the Claude Code path.

### Dead git dependencies

`yarn.lock` pinned two git deps to commits that no longer exist upstream
(force-pushed away), so `yarn install` could not complete:

| Package | Was | Now |
|---|---|---|
| `libsignal` (via `@whiskeysockets/baileys`) | `1c30d7d7…` over SSH | `bcea72df…` over HTTPS |
| `@electron/node-gyp` | `06b29aaf…` over SSH | `0453f4fe…` over HTTPS |

Both repinned to current `master`/`main` HEADs and switched to HTTPS so no
GitHub SSH key is needed. The stale `integrity` hash on `@electron/node-gyp`
was dropped, since the content legitimately differs.

Local git config (`desktop/.git/config`, not global) also rewrites
`ssh://git@github.com/` → `https://github.com/` for the same reason.

---

## Gotchas

- **Silent degradation is the failure mode to watch.** A successful browse does
  *not* prove the harness was used. After any change to packaging or how the
  harness is spawned, confirm `browser-harness-js` actually launched (REPL on
  `CDP_REPL_PORT`, CDP on 9222, `browser-harness --doctor`) rather than
  assuming.
- **Packaging still owes work.** A *packaged* DEX must ship a working harness
  rather than relying on a dev environment. Not "done" until a release build
  browses through the real chain.
- **Pre-existing test failures.** 5 tests fail on Windows at v0.0.31, unrelated
  to this fork (POSIX/Linux/XDG path assumptions in `pathEnrich`,
  `chrome-import/paths`, `installer`, `stock-helpers`). Baseline is
  **379 passed / 5 failed**; with this fork's tests, **384 passed / 5 failed**.
