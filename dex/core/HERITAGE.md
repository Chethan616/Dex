# Dex Heritage

`dex/core/` is a downstream of **OpenClaw** — github.com/openclaw/openclaw — at commit `7074cf8e23c1f64362c4f8c4bf32971ca94d5221` (2026-06-03). Forked into Dex on 2026-06-04.

OpenClaw is MIT-licensed. The original `LICENSE` file is preserved in this directory. All upstream per-file copyright headers remain intact per MIT.

## Why we forked

Dex absorbs OpenClaw, Microsoft UFO², and browser-use into a single product. To give that experience a coherent identity, the OpenClaw runtime was rebranded across every user-visible surface (Phase A through Phase B of the Dex build plan):

- CLI command: `openclaw` → `dex`
- npm package name: `openclaw` → `dexagent` (binary alias on PATH stays `dex`)
- Process / launcher title: `openclaw` → `dex` (the launcher file remains `openclaw.mjs` to keep upstream diffs minimal; the user-facing binary alias is `dex`)
- Log prefix: `[openclaw]` → `[dex]` _(internal subsystem tag; not seen during normal use)_
- Config dir: `~/.openclaw/` → `~/.dex/` (first-launch auto-migrator at `dex/core/src/migrations/config-dir-migrate.ts` copies the legacy tree on upgrade)
- Env vars: `OPENCLAW_*` → `DEX_*` (one-cycle fallback via `dex/core/src/env/dex-env.ts`)
- Workspace packages: `@openclaw/{acp-core,agent-core,gateway-protocol,…}` → `@dexagent/<same-suffix>` (21 internal packages)
- Outbound openclaw.ai endpoints: disabled by default, opt-in via `DEX_*` env vars (B.8)
- Version banner: `🦞 OpenClaw <version>` → `🐚 Dex <version>`
- Docs links: stubbed (Dex does not have its own docs site yet)
- Tagline: "All your chats, one OpenClaw." → "A calm cockpit for commanding agents you can trust."

## What we did NOT rename (heritage commitment)

These stay as `openclaw` / `OpenClaw` so MIT attribution survives and so future upstream sync stays mergeable:

- **The MIT `LICENSE` file** in this directory — preserved verbatim, with the original copyright holder.
- **Per-source-file copyright headers** at the top of each `.ts` / `.js` file. The rebrand script respects `excludeHeaderLines = 10` so it never touches these blocks.
- **External `@openclaw/*` npm dependencies**: `@openclaw/fs-safe`, `@openclaw/proxyline`, `@openclaw/discord`, `@openclaw/matrix`, `@openclaw/slack`, `@openclaw/whatsapp`. These are third-party libraries we do not own; renaming would break installation.
- **Test fixtures asserting upstream / heritage behaviour** (e.g. snapshot of the OpenClaw protocol). Tests that assert behaviour, not branding, kept their references.
- **`docs.openclaw.ai` URLs in error hints, help text, wizard prompts, and i18n locales** — Dex has no docs site yet; upstream's docs remain the useful destination. These render as user-clickable strings, NOT as runtime fetches.
- **`openclaw.mjs` launcher filename** — keeping it minimises upstream-sync diffs. The user-facing binary alias `dex` points at it via the `bin` field in `package.json`.
- **`openclaw.json` config-file name inside `~/.dex/`** — one-cycle hold; v1.4 renames the file to `dex.json` with a doctor migration.
- **TypeScript class names, function names, and internal types where Section 5's audit regex didn't classify them as PascalCase identifiers** (`__openclaw*` private prefixes, `openclawTheme` camelCase, `--openclaw-a2ui-*` CSS custom properties). Internally consistent (producer + consumer use the same symbol), so they don't break anything; cosmetic follow-up tracked separately.

The mechanical rebrand pipeline lives at:

- `D:\project1\scripts\build-rebrand-map.ps1` — generates the canonical replacement table by scanning `dex/core/` source.
- `D:\project1\scripts\rebrand-map.json` — exact-match find/replace table (~1750 entries across 6 sections).
- `D:\project1\scripts\rebrand.ps1` — applies the map with section + src/tests scope filters.

## Upstream sync

To pull upstream improvements into this fork:

1. Re-clone OpenClaw at the new commit into a sibling directory (e.g. `vendor/openclaw-upstream/`).
2. Diff `vendor/openclaw-upstream/` against `dex/core/`. To compare cleanly, reverse the rebrand map — apply `replace` → `find` on a copy of `dex/core/` to produce an "OpenClaw-named" version, then diff.
3. Cherry-pick the interesting changes into `dex/core/`.
4. Re-run `scripts/rebrand.ps1` to re-apply the Dex naming to any newly-pulled strings.
5. Update the commit hash at the top of this file.

If `scripts/rebrand.ps1` fails loudly because a `find` string no longer exists upstream, that's the canary for an upstream rename. Update `rebrand-map.json` first, then re-run.

## Attribution

Dex stands on the shoulders of:

- **OpenClaw** — github.com/openclaw/openclaw — MIT
- **Microsoft UFO²** — github.com/microsoft/UFO — MIT (loaded as a separate vendored dependency in `vendor/UFO/`)
- **browser-use** — github.com/browser-use/browser-use — MIT (loaded as a separate vendored dependency in `vendor/browser-use/`)

Credit appears in `D:\project1\LICENSES.md`, in Dex's "About Dex" Settings panel (Phase v1.4), and via the per-file MIT copyright headers preserved in this directory tree.
