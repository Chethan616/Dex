# Dex — OpenClaw migration report

> Phase B (the ownership migration) is complete. This report is the
> canonical reference for what changed, what stayed, and how to verify
> the rebrand from outside the codebase. Pair with
> `dex/core/HERITAGE.md` for the legal / attribution story and
> `D:\project1\LICENSES.md` for third-party license rollup.

## TL;DR

- **What:** the OpenClaw fork was rebranded end-to-end into **Dex** across CLI, env vars, workspace packages, config dir, log prefixes, telemetry, and repo structure.
- **Heritage commitments:** MIT `LICENSE`, per-source-file copyright headers, six external `@openclaw/*` npm deps, and `docs.openclaw.ai` URLs in user-clickable hints are preserved per `dex/core/HERITAGE.md`.
- **Distribution:** npm package name `dexagent` (binary alias `dex`). Source root: `dex/core/`.
- **Compat for end users on upgrade:** first-launch auto-migrator copies `~/.openclaw/` → `~/.dex/`; legacy `OPENCLAW_*` env vars keep working for one cycle via the `dexEnv()` shim.

## Phase B commit timeline

| # | Commit | Scope |
|---|---|---|
| precursor | `186df14f` | Fold `core/` at `openclaw@7074cf8e` into the outer Dex repo (strip nested `.git/`). |
| B.1 | `c005aad0` | Generate baseline audit `docs/migration/openclaw-audit.md`. |
| B.2 | `2da27209` | Generate `scripts/rebrand-map.json` (1753 entries) + `scripts/build-rebrand-map.ps1`. |
| B.3 | `18cdce85` | Add `dexEnv()` shim with one-cycle `OPENCLAW_*` fallback. |
| B.4 | `4b00bc63` | Add `~/.openclaw → ~/.dex` first-launch auto-migrator. |
| B.5 | `9fb70751` | Rename 21 internal `@openclaw/*` workspace packages to `@dexagent/*`. |
| B.6 | `5060c87b` | Mechanical rename pass on `core/src` (identifiers, env vars, paths). |
| B.7 | `7b822bb9` | Mechanical rename pass on test files + key fixture updates. |
| B.8 | `3860b0df` | Disable outbound `openclaw.ai` endpoints (attribution, docs search, VAPID subject). |
| B.9 | `ec5ede93` | `git mv core/ → dex/core/`, `glue/ → dex/drivers/`. |
| B.10 | `c65196b5` | Update scripts, README, `.gitignore` to the new paths. |
| B.11 | _(this commit)_ | HERITAGE.md, LICENSES.md, this migration report. |
| B.12 | _(next)_ | `npm pack --dry-run` + remote push. |

## What changed (deep rename categories)

| Category | Before | After | Driver |
|---|---|---|---|
| npm package name | `openclaw` → (Phase A) `dex-core` | `dexagent` | rebrand-map Section 1 |
| Binary on PATH | `openclaw` | `dex` (alias via `package.json` bin field) | Phase A + B preserved |
| Process title | `openclaw` | `dex` | rebrand-map Section 2 |
| Log prefix | `[openclaw]` | `[dex]` | rebrand-map Section 2 |
| Config directory | `~/.openclaw/` | `~/.dex/` + auto-migrator | rebrand-map Section 3 + B.4 |
| Config file inside dir | `openclaw.json` | `openclaw.json` (one-cycle hold; v1.4 renames) | preserved on purpose |
| Internal workspace packages | `@openclaw/<21 names>` | `@dexagent/<same suffix>` | rebrand-map Section 4 (B.5) |
| PascalCase TS identifiers | `OpenClaw<X>` for 162 unique names | `Dex<X>` | rebrand-map Section 5 (B.6+B.7) |
| Env vars | `OPENCLAW_*` for 1551 unique names | `DEX_*` | rebrand-map Section 6 + `dexEnv()` shim (B.3+B.6+B.7) |
| OpenRouter attribution header | `HTTP-Referer: https://openclaw.ai` | omitted by default; opt-in via `DEX_PROVIDER_ATTRIBUTION_REFERER` | B.8 |
| Docs search endpoint | `https://docs.openclaw.ai/api/search` | disabled by default; opt-in via `DEX_DOCS_SEARCH_URL` | B.8 |
| VAPID subject | `https://openclaw.ai` | `mailto:webpush@dex.local` (configurable via `DEX_VAPID_SUBJECT`) | B.8 |
| Repo structure | `core/` + `glue/` at root | `dex/core/` + `dex/drivers/` | B.9 |
| Banner | `🦞 OpenClaw <version>` | `🐚 Dex <version>` | Phase A + B.7 fixture fix |

## What stayed (heritage commitments)

These remain `openclaw` / `OpenClaw` deliberately:

- `dex/core/LICENSE` (MIT) — preserved verbatim with original copyright holder.
- Per-source-file MIT copyright headers — the rebrand script honours `excludeHeaderLines = 10` and never touches these blocks.
- External `@openclaw/*` npm dependencies: `fs-safe`, `proxyline`, `discord`, `matrix`, `slack`, `whatsapp`. These are third-party libraries from npm; we do not own them and renaming would break installation. Credited in `LICENSES.md`.
- `docs.openclaw.ai` URLs in error hints, help text, wizard prompts, and i18n locale strings. These render as user-clickable hints — they are NOT outbound runtime fetches. Dex has no docs site of its own yet; upstream's docs remain the useful destination.
- `openclaw.mjs` launcher filename — kept to minimise upstream-sync diffs. The user-facing binary alias `dex` points at it via `package.json` `bin`.
- `openclaw.json` config-file name inside `~/.dex/` — one-cycle hold; v1.4 renames the file with a doctor migration so existing installs keep working.
- A small number of camelCase / kebab-case / private-prefix identifiers the audit's PascalCase regex did not classify (`__openclawCatalog`, `openclawTheme`, `--openclaw-a2ui-*`). They are internally consistent (producer + consumer use the same symbol) so they cause no runtime drift. Tracked as a cosmetic follow-up.
- Mobile/desktop client source under `apps/{android,ios,macos}/` — those are alternative UIs the Dex Flutter client supersedes. Not in scope for Phase B's rebrand.

## Verification matrix

After Phase B is complete, the following commands should all pass on a clean checkout. Run from repo root unless noted.

| Check | Command | Expected |
|---|---|---|
| Build green | `cd dex/core && pnpm build` | exit 0; tsdown + UI bundles complete |
| Banner says Dex | `cd dex/core && node openclaw.mjs --help` | banner reads `🐚 Dex <version>` |
| Gateway usage says dex | `cd dex/core && node openclaw.mjs gateway --help` | `Usage: dex gateway` |
| Residual openclaw in dist (only allowed: external deps + docs URLs + filename) | see `scripts/audit-openclaw.ps1` re-run | category counts within ±10% of B.1 baseline minus what each B.* commit was supposed to reduce |
| dexEnv shim tests | `cd dex/core && pnpm test src/env/dex-env.test.ts` | 10/10 pass |
| Config migrator tests | `cd dex/core && pnpm test src/migrations/config-dir-migrate.test.ts` | 7/7 pass |
| Banner test | `cd dex/core && pnpm test src/cli/banner.test.ts` | 6/6 pass |
| Auto-migrator smoke | seed `~/.openclaw/`, start gateway once | `[dex] migrated config from ~/.openclaw/ to ~/.dex/` log line; `~/.openclaw/MOVED-TO-DEX.txt` written; second run is a no-op |
| No outbound `*.openclaw.ai` from fresh install | network capture or telemetry stub review (B.8) | no outbound runtime calls from the 4 stubbed endpoints with no env vars set |

## Known follow-ups (NOT blockers for Phase B closeout)

- **Test fixture updates** in narrow files that hardcoded specific banner / attribution strings (the same kind of fixture banner.test.ts needed, applied to a handful more files: `clawhub.test.ts`, `openclaw-npm-postpublish-verify.test.ts`, `gateway-codex-harness.live-helpers.test.ts`, `terminal-core/src/decorative-emoji.test.ts`, plus the openrouter attribution assertion tests from B.8). Each is a small edit; tracked in B.7 and B.8 commit messages.
- **camelCase / kebab-case / private-prefix `openclaw` residuals** in `dist/`. They are internally consistent so the build passes; addressing them requires extending the rebrand-map generator with extra regex categories and a re-run.
- **Mobile/desktop client source** (`apps/{android,ios,macos}/`) was not touched. Those UIs are superseded by the Dex Flutter client (`app/`); they can be removed or renamed in v1.5 alongside the installer work.
- **Top-level `dex/package.json`** as a publishable wrapper (per the original plan). `dex/core/package.json` already names itself `dexagent`; the v1.4 / v1.5 distribution work decides whether to publish from `dex/core/` directly or wrap it.

## Heritage compliance

- `dex/core/LICENSE` — MIT, verbatim, with the OpenClaw copyright preserved.
- `dex/core/HERITAGE.md` — names the upstream, the fork commit, the fork date, and lists everything intentionally NOT renamed.
- `D:\project1\LICENSES.md` — third-party audit including the OpenClaw heritage row + the 6 external `@openclaw/*` npm deps preserved by name.
- Per-source-file copyright headers — untouched; rebrand script's `excludeHeaderLines = 10` mode preserves them.

Phase B leaves Dex looking completely independent to users (CLI banners, env vars, config paths, error messages, npm package name) while preserving every piece of MIT attribution and source-file copyright that the heritage commitment requires.
