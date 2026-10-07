# DEX

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/Chethan616/Dex?include_prereleases)](https://github.com/Chethan616/Dex/releases/latest)
[![Stars](https://img.shields.io/github/stars/Chethan616/Dex?style=social)](https://github.com/Chethan616/Dex/stargazers)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Good first issues](https://img.shields.io/github/issues/Chethan616/Dex/good%20first%20issue)](https://github.com/Chethan616/Dex/labels/good%20first%20issue)

An AI agent that works on your PC beside you — in a browser, your documents,
your apps and your accounts — while you keep using it. And a phone app that
starts tasks, follows them and answers DEX's questions from anywhere.

- **Desktop (Windows):** an Electron app. Each task gets a workspace: live
  browser tabs you and the agent share, the documents it makes or opens, and
  a chat. Engines: Claude Code, Codex, or BrowserCode with your own model
  keys.
- **Phone (Android):** a Jetpack Compose app, paired with the desktop
  through your own Firebase project. Start tasks, read the chat, approve
  steps, get the files.
- **Connectors:** Google (Gmail, Calendar, Drive, Docs, Sheets, Meet, Tasks),
  Microsoft 365, GitHub, Slack, Reddit, Hugging Face, Blender, WhatsApp, and
  more — DEX uses the service's API instead of clicking through its website.

Releases (installer, APK, source): https://github.com/Chethan616/Dex/releases

**DEX is open source, and built in the open.** If it's useful to you, a ⭐
helps more people find it. Ideas, bugs and pull requests are all welcome —
start with [CONTRIBUTING.md](CONTRIBUTING.md) or an issue labelled
[good first issue](https://github.com/Chethan616/Dex/labels/good%20first%20issue).

---

## Repository

```
desktop/app/          the Windows app (Electron + React + TypeScript)
  src/main/           main process: sessions, the shared browser (BrowserPool),
                      the agent's CDP broker, approvals, connectors, phone bridge
  src/renderer/hub/   the UI: dashboard, task workspace, chat, settings
  src/shared/         types and logic both sides use
  mcp-servers/        DEX's built-in MCP servers (Google, Microsoft, Reddit,
                      Blender, Windows)
  tests/              vitest unit tests
android/              the phone app (Kotlin, Jetpack Compose, Material 3 Expressive)
firebase/             Firestore rules and the setup script for your own project
docs/                 plans and research (docs/unify, docs/desktop-control)
TO_BE_DONE.md         the hand-over: state, rules, and what's next
```

## Building

**Desktop** (Windows, Node 22+, yarn):

```powershell
cd desktop\app
yarn install
yarn start          # dev build
npx vitest run      # tests
```

**Phone** (JDK 17+, Android SDK):

```powershell
cd android
.\gradlew :app:assembleDebug
```

Pairing the phone needs your own Firebase project: see `firebase/README.md`.
Release steps are in `TO_BE_DONE.md`.

## Contributing

Pull requests, issues and ideas are welcome — from a typo fix to a new
connector. [CONTRIBUTING.md](CONTRIBUTING.md) has the setup, the checks to run
and how reviews work. Be kind: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
Security issues go to [SECURITY.md](SECURITY.md), not a public issue.

## License

DEX is licensed under the **[Apache License 2.0](LICENSE)** — free to use,
change and ship, commercially too.

**Credit is required.** DEX was created by Chethan Krishna
([@Chethan616](https://github.com/Chethan616)). If you redistribute DEX or
build something from it, keep the attribution in [NOTICE](NOTICE) — in your
NOTICE file, docs or About screen — and mark the files you changed
(Apache-2.0 §4).

Third-party components and their licenses are in [LICENSES.md](LICENSES.md).
Releases up to v3.2.0 were MIT.
