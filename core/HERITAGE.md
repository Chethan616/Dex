# Dex (core/) Heritage

`core/` is a downstream of **OpenClaw** — github.com/openclaw/openclaw — at commit `7074cf8e23c1f64362c4f8c4bf32971ca94d5221` (2026-06-03). Forked into Dex on 2026-06-04.

OpenClaw is MIT-licensed. The original `LICENSE` file is preserved in this directory. All upstream copyright notices remain intact per MIT.

## Why we forked

Dex absorbs OpenClaw, Microsoft UFO², and browser-use into a single product. To give that experience a coherent identity, user-visible surfaces of the OpenClaw runtime were renamed to **Dex**:

- CLI command: `openclaw` → `dex`
- Process / launcher name: `openclaw` → `dex` (file remains `openclaw.mjs` to keep upstream diffs minimal; the user-facing binary alias is `dex`)
- Log prefix: `[openclaw]` → `[dex]` _(internal subsystem tag; not seen during normal use)_
- Config dir: `~/.dex/` → `~/.dex/` _(internal, post-A.5 follow-up)_
- Version banner: `🦞 OpenClaw <version>` → `🐚 Dex <version>`
- Docs links: removed (Dex does not have a docs site yet)

We did **not** rename:
- TypeScript class names, function names, internal types
- Test fixtures
- The `@openclaw/*` npm-scoped packages (these are the public plugin SDK; renaming them would break plugins)
- `docs.openclaw.ai` URLs in error hints (upstream's docs are still useful while we don't have our own)
- Comments and code commentary (so future upstream pulls remain mergeable)

The rebrand is mechanical: see `D:\project1\scripts\rebrand-map.json` for the exact-match replacement table, and `D:\project1\scripts\rebrand.ps1` for the application script.

## Upstream sync

To pull upstream improvements into this fork:

1. Re-clone OpenClaw at the new commit into a sibling directory (e.g. `vendor/openclaw-upstream/`).
2. Diff `vendor/openclaw-upstream/` against `core/`. To compare cleanly, reverse the rebrand map — apply `replace` → `find` on a copy of `core/` to produce an "OpenClaw-named" version, then diff.
3. Cherry-pick the interesting changes into `core/`.
4. Re-run `scripts/rebrand.ps1` to re-apply the DexCore naming to any newly-pulled strings.
5. Update the commit hash at the top of this file.

If `scripts/rebrand.ps1` fails loudly because a `find` string no longer exists upstream, that's the canary for an upstream rename. Update `rebrand-map.json` first, then re-run.

## Attribution

DexCore stands on the shoulders of:

- **OpenClaw** — github.com/openclaw/openclaw — MIT
- **Microsoft UFO²** — github.com/microsoft/UFO — MIT (loaded as a separate vendored dependency)
- **browser-use** — github.com/browser-use/browser-use — MIT (loaded as a separate vendored dependency)

Credit appears in Dex's Settings → About screen, in `D:\project1\LICENSES.md`, and via the per-file MIT copyright headers preserved in this directory tree.
