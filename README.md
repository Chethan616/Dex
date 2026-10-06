# DEX

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

## License

MIT. Third-party components and their licenses are listed in `LICENSES.md`.
