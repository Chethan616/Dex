# Contributing to DEX

Thanks for wanting to help. DEX is an AI agent that works on your PC beside you,
with a phone app that follows it from anywhere — and it's built in the open.
Every kind of contribution counts: a bug report with clear steps, a fix, a new
connector, a better widget, docs, translations, or trying a release and saying
what felt off.

## Ways to help

- **Report a bug** — [open an issue](https://github.com/Chethan616/Dex/issues/new/choose)
  with what you did, what happened and what you expected. Screenshots help a lot.
- **Suggest something** — the feature template asks what problem it solves,
  which matters more than the solution.
- **Pick up an issue** — [good first issue](https://github.com/Chethan616/Dex/labels/good%20first%20issue)
  is a short, self-contained start; [help wanted](https://github.com/Chethan616/Dex/labels/help%20wanted)
  is bigger. Comment on it so two people don't do the same work.
- **Ask or share** — [Discussions](https://github.com/Chethan616/Dex/discussions).

## The repository

```
desktop/app/          the Windows app (Electron + React + TypeScript)
  src/main/           main process: sessions, the shared browser, the agent's
                      tools and approvals, connectors, the phone bridge
  src/main/hl/stock/  what the agent reads: AGENTS.md, dex-tools (its CLI
                      tools and their guides), domain skills
  src/renderer/hub/   the UI: dashboard, task workspace, chat, settings
  src/shared/         types and logic both sides use (widgets, reactions…)
  mcp-servers/        DEX's own MCP servers (Google, Microsoft, Windows…)
  tests/              vitest
android/              the phone app (Kotlin, Jetpack Compose, Material 3 Expressive)
firebase/             Firestore rules, and setup for your own Firebase project
docs/                 plans and research
TO_BE_DONE.md         the current state and what's next — a good map
```

## Set up

**Desktop** — Windows, Node 22+, yarn, Git for Windows:

```powershell
cd desktop\app
yarn install
yarn start              # the app, with hot reload for the UI
```

An agent engine runs the tasks: Claude Code or Codex (installed from the
app's engine picker), or BrowserCode with your own model key (Settings ›
Model providers).

**Phone** — JDK 17+ and the Android SDK:

```powershell
cd android
.\gradlew :app:assembleDebug
```

Pairing the phone with the desktop needs your own Firebase project (free
tier): see `firebase/README.md`. Never commit `google-services.json`,
`config/firebase.json`, keystores or any key.

## Before you open a PR

Run what your change touches — the same checks CI and reviewers run:

| Change | Run |
|---|---|
| Desktop code | `npx tsc --noEmit`, `npx vitest run` and `npx eslint <files>` in `desktop/app` |
| Phone code | `.\gradlew :app:compileDebugKotlin` in `android` |
| A new dependency | `yarn licenses:scan` in `desktop/app`, and a row in `LICENSES.md` |
| UI | a before/after screenshot in the PR, light and dark |

And a few habits that keep the codebase pleasant:

- **Small, focused PRs** are reviewed fastest. One change, one reason.
- **Match the code around you** — its naming, comment style, and the design
  tokens (desktop: `design/theme.global.css`; phone: `ui/theme`). No
  hard-coded colours in UI code.
- **Test behaviour, not implementation.** A bug fix comes with a test that
  failed before it.
- **Write for people.** UI text and docs in plain words, sentence case.
- **Commit messages** say what changed and why, in the present tense.

## Licensing of contributions

DEX is licensed under the [Apache License 2.0](LICENSE). By opening a pull
request you agree your contribution is licensed under it too (that's
Apache-2.0 §5 — there's no separate agreement to sign). You keep the
copyright to what you write, and you're credited in the git history.

Dependencies must be permissively licensed (MIT, Apache-2.0, BSD, ISC and
similar) — no GPL, AGPL or non-commercial licenses in the app. See
[LICENSES.md](LICENSES.md).

## Conduct and security

Be kind and assume good intent — see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
Found a vulnerability? Please report it privately as [SECURITY.md](SECURITY.md)
describes, not in a public issue.

Thanks again — and if DEX helps you, a ⭐ on the repo helps others find it.
