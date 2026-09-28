# DEX for Android

Your PC's DEX, in your pocket: start tasks, watch them run as a live chat, and
approve what needs you — including straight from the notification.

* **Jetpack Compose + Material 3 Expressive** (`material3` 1.5 alpha):
  `MaterialExpressiveTheme` with `MotionScheme.expressive()`, shape-morphing
  buttons (`ButtonDefaults.shapes()`), connected `ToggleButton` groups, the
  FAB menu, wavy progress, the expressive `LoadingIndicator` and pull-to-refresh
  — patterns after [meticha/material-3-expressive-catalog](https://github.com/meticha/material-3-expressive-catalog).
* **Thinking orbs** — `orbs/` is the Compose port of Libraries.dev's orb engine
  (branch `feat/android-compose-port` of andresain123/Libraries, MIT), the same
  nine states the desktop uses: searching = web search, weaving = browser,
  connecting = MCP/apps, solving = reading, composing = editing, working =
  commands, shaping = desktop control, listening = sub-agents/approvals,
  breathing = thinking.
* **Living bot avatars** — `ui/avatar/`: the eighteen bot-avatars bodies
  (generated into `BotShapes.kt` from the npm package) drawn natively: they
  breathe, blink, glance and tilt, hop while working, sleep when paused, and
  jump when tapped. Avatars fly between the list and the task screen as shared
  elements.
* **Haptics** — `ui/haptics/Haptics.kt`: system feedback constants for UI
  ticks/toggles/confirm/reject, and `VibrationEffect.Composition` signatures
  for sending a task, a task finishing, approvals and the bot hop.
* **Firebase** — see `../firebase/README.md`. Pairing is the Google account.

## Build

```powershell
# once: creates the Firebase project + writes app/google-services.json
powershell -ExecutionPolicy Bypass -File ..\firebase\setup.ps1

.\gradlew :app:assembleDebug
.\gradlew :app:installDebug
```

Without `app/google-services.json` the app still builds and shows a setup
screen. `local.properties` points at the SDK (`sdk.dir=D:\\Android\\Sdk` here).

## Regenerating bot shapes

From `desktop/app` (where `bot-avatars` is installed), re-run the generator
used to create `app/src/main/java/com/chethan616/dex/ui/avatar/BotShapes.kt`
— it reads `botAvatarTypes`, `botAvatarShapes`, `botAvatarParts` and
`botAvatarPresets` and emits one `BotShape` per type.
