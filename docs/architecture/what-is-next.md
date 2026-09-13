# What's next for Dex

> **Canonical plan** lives in `C:\Users\cheth\.claude\plans\see-the-design-md-and-bubbly-whistle.md`
> (a `/plan`-managed file). This document is the **repo-visible summary**
> so anyone reading the GitHub repo without access to that file still
> knows the roadmap. Where this doc and the slash-plan disagree, the
> slash-plan wins.

## Direction snapshot (post-2026.6.8)

After Phase B (rebrand) shipped, five direction changes were locked
that supersede earlier v1.3 / v1.4 designs:

1. **One channel, one client.** Dex talks to the user **only** through
   the official `dex-client` (desktop + mobile). No Telegram, WhatsApp,
   Discord, Slack, etc. The ~25 channel plugins under `extensions/`
   become opt-in installs; the bundled default ships with only
   `dex-client`.
2. **Mobile = native.** Android is Kotlin + Jetpack Compose + Material
   3 Expressive (`MaterialExpressiveTheme`, morph button shapes,
   polygon loading indicators, wallpaper-derived dynamic color). iOS
   is Swift 6 + SwiftUI + iOS 18 Liquid Glass (`.glassEffect()`,
   `Material.thin`, SF Symbols 6). **Not Flutter.**
3. **Flutter scope = desktop only.** Windows + Linux + macOS. Android
   and iOS Flutter targets are removed from `app/pubspec.yaml`.
4. **CLI onboarding moves into the desktop GUI.** `dex onboard`,
   `dex configure`, `dex doctor`, `dex models`, `dex plugins`,
   `dex update` all get GUI screens in the Flutter desktop app. The
   CLI commands stay for headless / scripting use, but the canonical
   user experience is GUI.
5. **Every API-key prompt links to the issuer's signup page.** Single
   source of truth at `dex/core/src/auth/key-issuer-urls.ts` (to be
   created). The GUI form imports the URL table; renders "Don't have
   one yet? Get one here →" beneath every key input.

## Execution order

The slash-plan locks this order:

1. **Phase C** (orchestration + OmniParser + Gemini Flash-Lite) — next.
2. **v1.2** (Live action surface + Stop button + Windows chrome).
3. **D.3** — move CLI onboarding into the desktop GUI (widens v1.4).
4. **D.4** — `key-issuer-urls.ts` + GUI form helper component.
5. **D.1** — channel consolidation (build `dex-client`, demote rest).
6. **D.2** — native mobile clients (Kotlin Compose + SwiftUI Liquid Glass).
7. **v1.5** — installer + production polish.

## Phase C (still next) — the 8-commit list

```
C.0  feat(orchestration): types + AutomationEngine interface
C.1  feat(orchestration): context-scanner.ts (Win32 + UIA + CDP, parallel)
C.2  feat(orchestration): capability-scorer.ts + scorer-weights + base table
C.3  feat(orchestration): router.ts + fallback chain wired into MCP dispatch
C.4  feat(orchestration): telemetry.sqlite + Beta-prior self-learner
C.5  feat(driver):        dex/drivers/omniparser/ + lazy ONNX weight download
C.6  feat(llm):           Gemini Flash-Lite across core + UFO² + browser-use
C.7  test(orchestration): perf bench + 4-app routing smoke + Flutter chip
```

Each commit has a single owner-verifiable gate. Total budget: ~2 weeks.

## API key issuer URLs (D.4 reference)

| Provider | Get-key URL |
|---|---|
| Anthropic | https://console.anthropic.com/account/keys |
| Gemini (AI Studio) | https://aistudio.google.com/app/apikey |
| Google Cloud (Vertex / Workspace OAuth) | https://console.cloud.google.com/apis/credentials |
| Groq | https://console.groq.com/keys |
| OpenAI | https://platform.openai.com/api-keys |
| OpenRouter | https://openrouter.ai/keys |
| Mistral | https://console.mistral.ai/api-keys |
| Perplexity | https://www.perplexity.ai/settings/api |
| ElevenLabs | https://elevenlabs.io/app/settings/api-keys |
| Deepgram | https://console.deepgram.com/project/default/keys |
| Azure Speech | https://portal.azure.com (Cognitive Services → Keys) |
| Brave Search | https://brave.com/search/api/ |
| Tavily | https://app.tavily.com/home |
| Firecrawl | https://www.firecrawl.dev/app/api-keys |
| Exa | https://dashboard.exa.ai/api-keys |

These get baked into a TS const in `dex/core/src/auth/key-issuer-urls.ts`
during D.4. The GUI form helper imports the const and renders a "Get
one here →" link under every key input.

## What's intentionally NOT in this list

- **Multi-OS GUI automation** (macOS/Linux native UFO² equivalents) — out of scope until v1.6.
- **Cloud relay / Tailscale** — out of scope until v1.6.
- **Replacing UFO² or browser-use** — MIT-licensed, battle-tested; keep using them.
- **Third-party messaging support beyond opt-in** — explicitly dropped per D.1.

## Status

- Phase B: **done** (`origin/main` through `19968f5b`, npm `2026.6.8`).
- Phase C: **unblocked** when 2026.6.8 publishes live and `dex onboard` works.
- Phase D (above): **scoped, awaiting greenlight**.
- Mobile native apps: **roadmap only**; ~6-8 weeks once Phase C + D.3 land.

Open the canonical plan file for the long-form versions of each phase,
including all per-commit gates, verification matrices, and risk
registers. This page exists so you don't HAVE to open it to know what's
next.
