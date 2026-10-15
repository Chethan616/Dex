---
name: android-screenshots-without-device
description: "Render DEX Android Compose screens to PNGs on the PC with Robolectric when the phone isn't connected"
metadata:
  node_type: memory
  type: reference
  originSessionId: baacd51d-de97-451d-b014-856abd9e3f87
  modified: 2026-09-29T17:05:06.206Z
---

Use this when `adb devices` is empty (no emulator or system images are installed; the SDK is at `D:\Android\Sdk`). It renders Compose UI on the JVM.

1. **Add test dependencies temporarily** in `android/app/build.gradle.kts`. Don't commit them.
   - `testImplementation("org.robolectric:robolectric:4.17")`
   - `testImplementation(platform(libs.compose.bom))`
   - `testImplementation("androidx.compose.ui:ui-test-junit4")`
   - `debugImplementation("androidx.compose.ui:ui-test-manifest")`
   - `testOptions { unitTests { isIncludeAndroidResources = true } }`
2. **Write the test class.**
   - Annotations: `@RunWith(RobolectricTestRunner::class)`, `@GraphicsMode(NATIVE)`, `@Config(sdk = [34], qualifiers = "w411dp-h914dp-xxhdpi", application = android.app.Application::class)`. The plain Application skips `DexApp` and Firebase.
   - Wrap the content in `DexTheme(mode, dynamicColor = false)`.
   - Provide `LocalHaptics provides rememberHaptics { false }`.
3. **Drive the clock.** Set `rule.mainClock.autoAdvance = false`, then call `advanceTimeBy(ms)` so animations settle.
4. **Capture.** `rule.onRoot().captureToImage().asAndroidBitmap()`, then compress to a PNG. An env var like `DEX_SHOTS` is a good way to set the output directory.
5. **Run:** `./gradlew :app:testDebugUnitTest --tests "*Shots*"`. The first run takes about 4 min (downloads); later runs about 1 min.

This worked on 2026-09-29 for the 1.0.15 welcome tour. Afterwards, revert the Gradle changes and delete `app/src/test`. Related: [[phone-adb-testing]].

Update 2026-10-06: Home's UI is `HomeContent(state, callbacks)` (no Firebase), so whole screens render with fake `HomeState`. Popups and sheets capture via `rule.onNode(isPopup())` / `isDialog()`. Font scale: `RuntimeEnvironment.setFontScale(1.3f)` with a `w360dp` qualifier. Keep the shot tests in the scratchpad and copy them in per run, never commit them.

Update 2026-10-15:
- **Store screenshots:** made by `docs/play-store/tools/StoreShots.kt` (the session screen is laid out from SessionScreen's now-`internal` pieces) and `tools/frames.py` (the headline, phone frame and lifted card). Output goes to `docs/play-store/screenshots/`.
- **A real emulator works too.** AVD `api28` (Android 9, x86_64) runs with WHPX:
  - Start it: `emulator -avd api28 -no-window -no-audio -gpu swiftshader_indirect -no-snapshot -port 5580`. It boots in about 20 s.
  - The owner's phone is often connected as well, so **always pass `adb -s emulator-5580`**.
  - Used to check the sign-in keyboard layout.

