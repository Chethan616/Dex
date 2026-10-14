---
name: release-process
description: How DEX releases ship — tag triggers CI for the Windows installer; the Android APK is built and uploaded locally
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
  - Build: `cd android && ./gradlew :app:assembleRelease`. Signing comes from `~/.gradle/gradle.properties` `DEX_RELEASE_*`.
  - Copy the APK to `android/release/DEX-android-<ver>.apk` (gitignored).
  - Upload: `gh release upload <tag> …`. The name must match what `ReleaseChecker.kt` looks for.
  - The cert SHA-256 starts `2f727fa5…`. Verify it with `apksigner verify --print-certs`.
- **Notes.** Replace the generated ones with `gh release edit <tag> --title … --notes-file …`. **Never write a bare `@name` in notes:** GitHub turns it into a mention and lists that account under the release's Contributors (v3.3.0's "@BotFather" put a stranger there and the owner was furious). Write BotFather, or put it in backticks.
- **Before tagging:** `yarn licenses:scan`, tsc, vitest, and a scan of the new commits for token-shaped strings (a test's fake Telegram token shaped like a real one could trip GitHub push protection).
- **Current (2026-10-07):** the owner deleted every earlier release (v3.1.0–v3.3.0) and their tags, and restarted at **v1.0.0** as the first public release: desktop 1.0.0 + `DEX-android-1.0.34.apk` (versionCode 35). The desktop version may restart, but the **phone's versionName must always increase**: `ReleaseChecker.isNewer` compares names, so a lower one strands every installed phone. Anyone with desktop 3.x installed must uninstall before 1.0 (Squirrel launches the highest app-x.y.z). From 1.0.21 the phone updates itself in-app (update/AppUpdater.kt) from releases/latest, so the APK name must stay `DEX-android-<ver>.apk`. The CI Android job is a no-op without signing secrets; the publish job still creates the release.
- **Android-only update** (done 2026-10-01, 1.0.16 on v3.1.0, at the user's request "edit the previous release"):
  - bump `versionCode`/`versionName` only, then build;
  - `gh release upload` the new APK to the **latest** release (the phone's ReleaseChecker reads `releases/latest`);
  - checksum the uploaded asset against the local file;
  - `gh release delete-asset` the old APK;
  - fix the notes line that names the APK file.

  No new tag, and the Windows assets aren't touched.

**Why:** Secrets for the APK were never added to CI (adding them is an outward change that needs the user's OK).

**How to apply:** Follow these steps for the next release. Bump `versionCode`/`versionName` in `android/app/build.gradle.kts` and the desktop `package.json` first.
