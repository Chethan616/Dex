# Third-party licenses — Dex

This file is the authoritative audit of every third-party component bundled with or vendored into Dex. **Pre-shipping rule:** no AGPL-licensed dependency is permitted in the shipped product. Optional add-ons the user installs themselves are not covered here.

Status legend: `✓ verified` · `△ pending` (filled in during the phase that vendors it) · `✗ blocked` (license incompatible — must remove or replace).

---

## Vendored repositories

| Component | License | SPDX | Source | Status |
|---|---|---|---|---|
| OpenClaw | MIT (expected) | `MIT` | https://github.com/openclaw/openclaw | △ pending — confirm in Phase 1 by reading `vendor/openclaw/LICENSE` |
| Microsoft UFO² | MIT (per README badge) | `MIT` | https://github.com/microsoft/UFO | △ pending — confirm in Phase 2 by reading `vendor/UFO/LICENSE` |

---

## Python dependencies (glue / MCP server)

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
| `http` | BSD-3-Clause | REST calls to OpenClaw gateway | △ pending — confirm in Phase 5 |
| `web_socket_channel` | BSD-3-Clause | WebSocket stream from gateway | △ pending — confirm in Phase 5 |
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
