# @dexagent/screen-context — Phase H

**Status**: SCAFFOLD ONLY. Type contract + facade interface + the **non-disruption banned-API checker** land here. The actual capture / extract / mesh implementations are gated on the H.1 verification spot-checks in `docs/h-research/screen-context-comparison.md` §12.

## Two locked principles (from the slash-plan, restated here so they stay visible)

1. **Observer mode by default.** Screen-context never brings an app to the foreground, never switches tabs, never minimizes / maximizes / rearranges windows, never steals keyboard or mouse focus, never interrupts fullscreen apps. Read only.
2. **Cross-device works without uploads.** The user on a phone asks a question about what's on their laptop. Dex on the phone never sees the file or screenshot — only the structured `ContextPayload` (and optionally a single compressed PNG with explicit per-session consent).

`src/non-disruption.ts` enforces principle #1 at build time. It exports `BANNED_APIS` (Win32 / macOS / X11 / browser DOM calls that violate observer mode) and `scanSourceForBannedApis(source)` which `test/policy.test.ts` will run over the package's own source on every CI pass. **A H.3+ commit that imports or calls any banned API fails the build.**

## What's actually in this scaffold

| File | Status | Purpose |
|---|---|---|
| `src/types.ts` | shipped | `ContextPayload`, `CaptureRequest`, `CaptureResult`, `ScreenContextError`, `Result<T,E>` |
| `src/index.ts` | scaffold | `createScreenContext()` facade — every method returns `not-yet-implemented` |
| `src/non-disruption.ts` | **real** | Banned-API constants + `scanSourceForBannedApis()` scanner |
| `src/index.test.ts` | shipped | Contract-shape tests |
| `src/non-disruption.test.ts` | shipped | Tests the policy scanner against real source snippets (positive + negative cases) |

When H.3+ adds real `capture/win32.ts` / `extract/uia.ts` / `mesh/request.ts` / etc., a single `policy.test.ts` at the package root will scan all of them and fail the build if any banned API sneaks in.

## v1 deliverable scope (from the slash-plan)

| Phase | Owner | Status |
|---|---|---|
| H.3 — Win32 capture + UIA extractor | H.3 | ⏳ gated on H.1 §12 |
| H.4 — Browser DOM extractor via CDP (UIA fallback) | H.4 | ⏳ |
| H.5 — VS Code / JetBrains extractor via their MCP servers | H.5 | ⏳ |
| H.6 — OCR fallback path (Tesseract) | H.6 | ⏳ |
| H.7 — `non-disruption.ts` rule set + static-policy test | H.7 | **partial in this scaffold** |
| H.8 — Cross-device transport (phone → laptop) | H.8 | ⏳ |
| H.9 — Server-side session.ts cache for follow-up continuity | H.9 | ⏳ |
| H.10 — Permission UI (per-pair, per-session, per-app deny-list) | H.10 | ⏳ |
| H.11 — macOS / Linux capture paths (post-Windows MVP) | H.11 | ⏳ |

## Why ship the policy checker before any capture code?

Because the principle is harder to add later than to enforce from day one. Every capture / extract module that lands in H.3+ will be scanned. If a future contributor (me, a subagent, a curl-pasted snippet) imports `SetForegroundWindow` thinking it's harmless, the build will refuse the commit — and the violator gets pointed at this README. The cost of building the scanner now (~50 LOC) is a fraction of the cost of finding a focus-stealing call in production.
