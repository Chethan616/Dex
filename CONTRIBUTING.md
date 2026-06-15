# Contributing to Dex

Thanks for your interest in Dex — a calm cockpit for commanding agents you can
trust. This guide gets you from clone to PR.

## Project layout

- `dex/core/` — the agent framework (TypeScript, the `dexagent` npm package).
- `dex/core/drivers/` — the automation engines (UFO² desktop, browser-use).
- `app/` — the Flutter desktop app (the UI / client).
- `LICENSES.md`, `dex/core/HERITAGE.md` — upstream attribution.

## Prerequisites

- **Node 22.19+** (24 recommended) + **pnpm** for `dex/core`.
- **Flutter** (stable) with Windows desktop enabled for `app/`.
- A **Gemini API key** (free tier works) to run the agent locally.

## Build & run

```bash
# Framework
cd dex/core
pnpm install
pnpm build
npm install -g .          # exposes `dex` on PATH

# App
cd ../../app
flutter pub get
flutter run -d windows
```

`dex engines setup` installs the desktop + browser engines into `~/.dex/engines`.

## Before you open a PR

- **Format & analyze.** App: `flutter analyze` must be clean on touched files.
  Core: follow `dex/core/AGENTS.md` (oxfmt, tsgo, `pnpm test <path>`).
- **Build.** App: `flutter build windows --debug`. Core: `pnpm build`.
- **Keep commits focused** and conventional-ish (`feat:`, `fix:`, `chore:`…).
- **Don't commit secrets** — keys live in `~/.dex/`, never in the repo.
- **Match the surrounding code** — comment density, naming, idioms.

## Branches & commits

- Branch off `main` (or the active feature branch). Don't commit directly to
  `main` for non-trivial changes.
- Sign your work in the commit body if you like; co-author tags welcome.

## Reporting bugs / requesting features

Use the issue templates under **New issue**. Include your OS, the build you're
on, and — for agent/gateway issues — the relevant Diagnostics log.

## Code of Conduct

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).
