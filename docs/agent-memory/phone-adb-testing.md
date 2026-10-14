---
name: phone-adb-testing
description: "How to test DEX for Android on the user's real phone over adb — lag, coordinates, where notifications show, WebView debugging"
metadata:
  node_type: memory
  type: reference
  originSessionId: baacd51d-de97-451d-b014-856abd9e3f87
  modified: 2026-09-28T18:35:36.383Z
---

The user's phone: OnePlus CPH2487, Android 16 / ColorOS, 1240×2772 at 560 dpi (354×792 dp). Connected over adb when they say so.

- **Input lags.** Taps land seconds late, and screenshots can be stale. Take a screenshot after every step before the next tap. Blind tap chains end up on the launcher (for example, the clock widget sits where the home prompt bar is).
- Screenshot: `adb exec-out screencap -p > $TEMP/dexphone/NN.png`. Shrink to 413×924 before viewing, then multiply ×3 to get device px.
- `adb shell input text` goes through the keyboard's autocorrect and garbles words. That's fine for prompts.
- Reinstalling (`adb install -r`) kills the app. The next Back then exits to the launcher.
- **Notifications:** the live "working" notification (channel `live`, LOW importance) shows under the shade's **Silent** section, collapsed. Expand it to reach Stop, and scroll, because the clear-all button covers it. In `dumpsys notification`, use only the "Notification List" part: entries after `mArchive=` were already removed.
- **WebView pages** (the 3D viewer): release builds can't be inspected. Temporarily add `WebView.setWebContentsDebuggingEnabled(true)`, then `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>` and evaluate over CDP with a small Node WebSocket script. Remove it before the final build.
- Desktop DEX dev runs via `npx electron-forge start` in desktop/app. Main-process changes need a restart: kill the forge node process tree and start it again.

Related: [[phone-and-accounts]]
