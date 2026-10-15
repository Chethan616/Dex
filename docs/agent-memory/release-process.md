---
name: release-process
description: How DEX releases ship — tag triggers CI for the Windows installer; the Android APK is built and uploaded locally; latest is v2.0.0 (2026-10-14)
metadata:
  node_type: memory
  type: project
  originSessionId: baacd51d-de97-451d-b014-856abd9e3f87
  modified: 2026-09-29T17:04:59.409Z
---

DEX's first public GitHub release was **v3.1.0**, on 2026-09-29: https://github.com/Chethan616/Dex/releases/tag/v3.1.0. It was tagged on `feat/low-latency` at `ea2e14e1`, with Android 1.0.15.

- **Tag rule.** A `vX.Y.Z` tag must equal `desktop/app/package.json`'s version. It triggers `.github/workflows/dex-release.yml`.
- **What CI does.**
  - Builds the Squirrel installer: `dex-setup.exe`, `RELEASES` and `.nupkg`. The installed app auto-updates from `releases/latest/download/RELEASES`.
  - Publishes the release with auto-generated notes.
- **Android is local.** CI has no Android signing secrets, so the Android job skips.
  - Build: `cd android && ./gradlew :app:assembleGithubRelease` (since 2026-10-15 there are two flavors: `github` self-updates from Releases; `play` has no updater). The APK is at `app/build/outputs/apk/github/release/app-github-release.apk`. Signing comes from `~/.gradle/gradle.properties` `DEX_RELEASE_*`.
  - Copy the APK to `android/release/DEX-android-<ver>.apk` (gitignored).
  - Upload: `gh release upload <tag> …`. The name must match what `ReleaseChecker.kt` looks for.
  - The cert SHA-256 starts `2f727fa5…`. Verify it with `apksigner verify --print-certs`.
- **Notes.** Replace the generated ones with `gh release edit <tag> --title … --notes-file …`. **Never write a bare `@name` in notes:** GitHub turns it into a mention and lists that account under the release's Contributors (v3.3.0's "@BotFather" put a stranger there and the owner was furious). Write BotFather, or put it in backticks.
- **Before tagging:** `yarn licenses:scan`, tsc, vitest, and a scan of the new commits for token-shaped strings (a test's fake Telegram token shaped like a real one could trip GitHub push protection).
- **Current (2026-10-07):** the owner deleted every earlier release (v3.1.0–v3.3.0) and their tags, and restarted at **v1.0.0** as the first public release: desktop 1.0.0 + `DEX-android-1.0.34.apk` (versionCode 35). The desktop version may restart, but the **phone's versionName must always increase**: `ReleaseChecker.isNewer` compares names, so a lower one strands every installed phone. Anyone with desktop 3.x installed must uninstall before 1.0 (Squirrel launches the highest app-x.y.z). From 1.0.21 the phone updates itself in-app (update/AppUpdater.kt) from releases/latest, so the APK name must stay `DEX-android-<ver>.apk`. The CI Android job is a no-op without signing secrets; the publish job still creates the release.
- **v2.0.0 (2026-10-14):** desktop 2.0.0 + `DEX-android-2.0.0.apk` (versionCode 37; the phone's versionName jumped 1.0.35 → 2.0.0 to match). The owner asked for it ("release v2 now") while another machine continues the work, so pull before any later bump. Notes are written by hand in the v1.0.0 style (what's new, install/update, build it with us, licenses).
- **Android-only update** (done 2026-10-01, 1.0.16 on v3.1.0, at the user's request "edit the previous release"):
  - bump `versionCode`/`versionName` only, then build;
  - `gh release upload` the new APK to the **latest** release (the phone's ReleaseChecker reads `releases/latest`);
  - checksum the uploaded asset against the local file;
  - `gh release delete-asset` the old APK;
  - fix the notes line that names the APK file.

  No new tag, and the Windows assets aren't touched.

**Why:** Secrets for the APK were never added to CI (adding them is an outward change that needs the user's OK).

**How to apply:** Follow these steps for the next release. Bump `versionCode`/`versionName` in `android/app/build.gradle.kts` and the desktop `package.json` first.

**2026-10-15:** the owner released **v2.0.0** (desktop 2.0.0, Android versionName 2.0.0, versionCode 37) from their PC (`931b17db`). Troubleshooting (`7533df5a`) and workflows (`8963092f`, `de842ac8`) came after it, so the next release is 2.0.1 with phone versionName > 2.0.0.

**Google Play (from 2026-10-15):**
- Play gets the `play` flavor bundle: `./gradlew :app:bundlePlayRelease`, copied to `android/release/DEX-android-<ver>-play.aab`. It's uploaded in Play Console by the owner; there's no API access.
- Everything for Play is in `docs/play-store/README.md`: listing copy, form answers, icon, feature graphic, and the steps.
- The privacy policy is `PRIVACY.md`; the deletion page is `docs/delete-account.md`.
- Every Play upload needs a new `versionCode`. The first Play bundle was 2.0.1 / 38, then 2.0.1 / 39 (sign-in and greeting fixes). Local copies are named `DEX-android-<name>-<code>-play.aab`.
- `bundlePlayRelease` also writes `native-debug-symbols.zip` (task `zipPlayReleaseNativeSymbols`). Upload it per version in App bundle explorer › Downloads to clear Play's "no debug symbols" warning.
- AGP's `debugSymbolLevel` can't help: the only native libs are AndroidX's (graphics-path, datastore), shipped already stripped.
