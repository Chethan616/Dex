# Third-party licenses — Dex

This file is the authoritative audit of every third-party component bundled with or vendored into Dex. **Pre-shipping rule:** no AGPL-licensed dependency is permitted in the shipped product. Optional add-ons the user installs themselves are not covered here.

Status legend: `✓ verified` · `△ pending` (filled in during the phase that vendors it) · `✗ blocked` (license incompatible — must remove or replace).

---

## Vendored repositories

> The repo itself contains only the Dex agent (`dex/`) and the Flutter app
> (`app/`). The automation **engines** (UFO² + browser-use) are no longer
> vendored — they're fetched/built into `~/.dex/engines` by `dex engines
> setup`, or bundled prebuilt in the MSI. agent-zero was reference-only;
> its step-row UI + mode concepts were ported into Dex and its source was
> removed (2026-06-13).

| Component | License | SPDX | Source | Status |
|---|---|---|---|---|
| **Dex core** (forked from OpenClaw, see `dex/core/HERITAGE.md`) | MIT | `MIT` | https://github.com/openclaw/openclaw — heritage commit `7074cf8e23c1f64362c4f8c4bf32971ca94d5221`, forked 2026-06-04 | ✓ MIT preserved in `dex/core/LICENSE`; original per-file copyright headers intact per MIT |
| Microsoft UFO² | MIT (per README badge) | `MIT` | https://github.com/microsoft/UFO | Runtime engine — NOT vendored in the repo. Fetched by `dex engines setup` (git clone) or bundled prebuilt in the MSI. MIT attribution travels with the bundled copy. |
| browser-use | MIT (per manifest.json) | `MIT` | https://github.com/browser-use/browser-use | Runtime engine — NOT vendored. pip-installed into the engine venv by `dex engines setup`; bundled prebuilt in the MSI. |
| Playwright (transitive of browser-use) | Apache-2.0 | `Apache-2.0` | https://github.com/microsoft/playwright | Installed into the browser-use venv (`playwright install chromium`). |

### External `@openclaw/*` npm dependencies (preserved upstream, NOT rebranded)

Per the heritage commitment in `dex/core/HERITAGE.md`, the following scoped packages stay as third-party upstream deps and are credited here:

| Package | Source | Used by |
|---|---|---|
| `@openclaw/fs-safe` | npm registry (`@openclaw/fs-safe@0.3.0`) | Cross-cutting filesystem safety helpers used throughout `dex/core/` |
| `@openclaw/proxyline` | npm registry (`@openclaw/proxyline@0.3.3`) | HAProxy PROXY protocol decoder for gateway TLS termination |
| `@openclaw/discord` | npm registry | Discord channel plugin runtime |
| `@openclaw/matrix` | npm registry | Matrix channel plugin runtime |
| `@openclaw/slack` | npm registry | Slack channel plugin runtime |
| `@openclaw/whatsapp` | npm registry | WhatsApp channel plugin runtime |

These remain `@openclaw/*` because they are third-party libraries Dex does not own. Renaming them would break installation. The user-visible Dex surface (CLI, banners, env vars, log prefixes) is fully rebranded; these scoped imports are purely an internal dep contract.

---

## Python dependencies (dex/drivers/ MCP servers)

| Package | License | Source | Status |
|---|---|---|---|
| `mcp` (FastMCP) | _(check on install)_ | https://github.com/modelcontextprotocol/python-sdk | △ pending — fill in Phase 3 |
| _(UFO² transitive deps reused from its venv)_ | _(see vendor/UFO/requirements.txt)_ | — | △ pending |

---

## Flutter dependencies (`app/pubspec.yaml`)

Approved budget per `prompt.md` §8: a small handful, justified individually.

| Package | License | Why | Status |
|---|---|---|---|
| `flutter` (SDK) | BSD-3-Clause | the framework | ✓ |
| `http` | BSD-3-Clause | REST calls to the Dex gateway | △ pending — confirm in Phase 5 |
| `web_socket_channel` | BSD-3-Clause | WebSocket stream from the Dex gateway | △ pending — confirm in Phase 5 |
| `intl` | BSD-3-Clause | localized timestamps | △ pending — confirm in Phase 5 |

**Not included** (intentionally): GetX, Provider/Riverpod (we use built-in `ChangeNotifier`), animation libraries, icon webfonts, Material You theming packs.

---

## Fonts

| Font | License | Source | Status |
|---|---|---|---|
| Geist (variable) | OFL-1.1 | https://github.com/vercel/geist-font | △ pending — confirm in Phase 5 (download single variable .ttf) |
| Geist Mono (variable) | OFL-1.1 | https://github.com/vercel/geist-font | △ pending — confirm in Phase 5 |

---

## Out-of-band / opt-in components (NOT bundled)

These are mentioned in `prompt.md` but are explicitly user-installed if used, not shipped in Dex:

- **Open Interpreter** — AGPL. Not bundled. User may install separately at their own risk.
- **Ollama / local model weights** — not bundled; users provide their own.

---

## Audit checklist (for Phase 7 close-out)

- [ ] Every row above is `✓ verified`, not `△ pending`.
- [ ] No transitive dependency is AGPL (run a tooling check on `pubspec.lock` + Python venv).
- [ ] The full text of each non-MIT license is preserved in `vendor/<project>/LICENSE`.
- [ ] Attribution screen / "About Dex" in the app surfaces this list (or a link to it).
