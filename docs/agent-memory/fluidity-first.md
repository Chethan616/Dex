---
name: fluidity-first
description: "The user values smooth, lag-free UI over flashy animation; what that rules out on Android (and desktop)"
metadata:
  node_type: memory
  type: feedback
  originSessionId: baacd51d-de97-451d-b014-856abd9e3f87
  modified: 2026-10-01T06:21:12.815Z
---

The user, 2026-10-01: "I prefer fluidity more than anything… EVERYTHING FEELS LAG I NEED FLUIDITY." They called the phone app's shared-element transitions and Home's card cascade laggy. But when 1.0.19 removed the bot that flies from a Home row into the chat's top bar, they asked for it back ("why u removed it i liked it"). Keep the delightful effect and rebuild it cheaply: 1.0.20 does it with `ui/avatar/BotFlight.kt`, an overlay avatar moved by its layer. Don't delete a liked animation for speed without asking.

**Why:** On their OnePlus (CPH2487, 120 Hz) the expressive motion stuttered. Smoothness is what they actually judge the app by; playfulness only counts if it's free.

**How to apply:**
- Prefer cheap motion: slides of opaque layers and short emphasized-decelerate tweens.
- Avoid shared elements, full-screen scale or fade transitions, per-item entrance cascades, and bouncy springs on navigation.
- Read animated values in draw or layer lambdas, never in composition.
- No infinite animations in lists (`BotAvatar(still = true)`).
- Firestore listeners run on a background executor.
- Lists open at their position instead of animating a scroll.
- Keep the baseline profile (`android/app/src/main/baseline-prof.txt`).

The commits for Android 1.0.19 (`ec9a8d17`) and 1.0.20 (`3461af49`) list each fix. Also: don't build heavy lists while a screen slides in, and don't decode images in composition. Related: [[phone-adb-testing]], [[no-metal-buttons]].
