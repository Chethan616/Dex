# Licenses

## DEX

DEX is licensed under the **Apache License 2.0** ([LICENSE](LICENSE)).
Copyright 2026 Chethan Krishna ([@Chethan616](https://github.com/Chethan616)) and the DEX contributors.

**What that means**

- **Use, change, ship and sell it**, privately or commercially, for free.
- **Keep the credit.** If you redistribute DEX or something built from it,
  keep the [NOTICE](NOTICE) file's attribution ("DEX was created by Chethan
  Krishna (@Chethan616)", with the link) in your NOTICE, your docs or your
  About screen. Mark the files you changed. That's Apache-2.0 §4(b) and (d).
- **Contributions** are under the same license (Apache-2.0 §5): no extra
  agreement to sign.
- **A patent grant** comes with it from every contributor, and ends for anyone
  who sues over the code's patents.

Versions up to v3.2.0 were released under the MIT License. Those releases stay
MIT; everything after them is Apache-2.0.

## Third-party components

Checked on 2026-10-07. Re-run the dependency scan with `yarn licenses:scan` in
`desktop/app` (scripts/license-scan.mjs) before each release.

### Code DEX is built from

| Component | Where | License | Notes |
|---|---|---|---|
| Browser Use desktop app | `desktop/` (where DEX started) | MIT | Notice kept in `desktop/LICENSE-browser-use` |
| Browser Use browser-harness | `desktop/app/src/main/hl/stock/` (browser harness, domain skills) | MIT | Synced by `scripts/sync-domain-skills.mjs` |
| Thinking orbs | `android/orbs` | MIT | `android/orbs/LICENSE` |
| Bot avatars (Libraries.dev) | `android/…/ui/avatar/BotShapes.kt`, desktop avatars | MIT | Credited in the phone's Settings › About |
| `<model-viewer>` | `android/app/src/main/assets/viewer` | Apache-2.0 | `LICENSE-model-viewer.txt` beside it |
| Material Symbols (Rounded) | `android/app/src/main/res/drawable/ic_task_*.xml` | Apache-2.0 | |
| material-3-expressive-catalog (meticha) | patterns adapted in the phone's UI | Apache-2.0 | Credited in Settings › About |

### Desktop app (`desktop/app`) — npm production dependencies

414 packages are reachable from `package.json`'s `dependencies`:

| License | Packages |
|---|---|
| MIT | 286 |
| Apache-2.0 | 60 |
| ISC | 32 |
| BSD-3-Clause | 24 |
| BlueOak-1.0.0 | 2 |
| BSD-2-Clause, 0BSD, Unlicense, Python-2.0, MIT AND Zlib, MIT AND ISC | 1 each |
| Dual-licensed, used under the permissive option (MIT OR WTFPL; MIT OR GPL-3.0-or-later — `jszip`; BSD-2 OR MIT OR Apache-2.0) | 3 |
| **GPL-3.0** — `libsignal` 6.0.0, pulled in by `@whiskeysockets/baileys` (MIT) for the WhatsApp channel | **1** |

**libsignal (GPL-3.0).** WhatsApp's protocol needs Signal's encryption, and
its JavaScript implementation is GPL-3.0. Apache-2.0 code may be combined into a
GPL-3.0 work, but not the other way round, so:

- **DEX's source is Apache-2.0.** You may use any part of it under Apache-2.0
  terms.
- **The Windows installer bundles libsignal.** As a combined work it is
  distributed under GPL-3.0, and this repository is its complete source.
  Redistributing the installer means following GPL-3.0 (offering the source).
- **Planned:** move the WhatsApp channel to an optional download, so the
  installer itself is Apache-2.0 only (TO_BE_DONE §3.8).

Electron ships Chromium's own third-party notices (`LICENSES.chromium.html` in
the installed app).

### Phone app (`android`)

| Package | License |
|---|---|
| Jetpack Compose, Material 3, AndroidX (core, lifecycle, navigation, webkit, credentials…) | Apache-2.0 |
| Kotlin standard library, kotlinx.coroutines, kotlinx.serialization | Apache-2.0 |
| Firebase (Auth, Firestore, Messaging), Google ID (sign-in) | Apache-2.0 |
| Google Play services libraries those pull in | Android Software Development Kit License (Google's terms; redistributable in apps) |
| Coil, OkHttp | Apache-2.0 |
| Thinking orbs (`android/orbs`, vendored) | MIT |

No copyleft code is in the APK. (JUnit, EPL-1.0, is only used by tests and isn't shipped.)

### Not bundled

- **Agent engines** (Claude Code, Codex, OpenCode) are installed by the user
  under their own terms.
- **Blender** is a separate program DEX drives when the user has it installed
  (GPL; not linked or shipped).
- **Models** (local or hosted, e.g. on Hugging Face) come under their own
  licenses and terms.
- **Fonts:** none are shipped; the UI uses the system font when Geist isn't
  installed.

## Rules for adding a dependency

1. Permissive only (MIT, Apache-2.0, BSD, ISC and similar) for anything
   bundled. No GPL, AGPL, SSPL or non-commercial licenses in the app — the
   libsignal case above is the one known exception, and it's planned out.
2. Add it to this file in the same PR, with where it's used.
3. Vendored code keeps its license file next to it, and a line in
   [NOTICE](NOTICE) when its license asks for one.
