---
name: desktop-ui-headless-render
description: Render DEX's desktop hub UI with sample data in headless Edge (no Electron, no window), used for the README images; tools in docs/play-store/tools/desk
metadata:
  type: reference
---

DEX's hub renderer runs in a plain headless browser. It opens no window on the owner's screen, so it can be used while they're active.

**Steps:**
1. Run `npx vite --config vite.hub.config.mts --port 5199 --strictPort` in `desktop/app`.
2. Load `http://localhost:5199/hub.html` with Playwright's `chromium.launch({ channel: 'msedge', headless: true })`. Playwright's own browsers aren't installed for 1.59, so use Edge.
3. Set `window.electronAPI` with an init script:
   - `docs/play-store/tools/desk/mock.js` is a deep Proxy. Calls resolve to defaults; `on*` calls return unsubscribe functions.
   - `sample.js` holds AgentSessions with real HlEvents: `user_input`, `tool_call`/`tool_result`, `thinking` (the reply), `widget`, `confirmation`, `done`.

**Gotchas:**
- Give sample sessions `hasBrowser: false`, or AgentPane crashes on `tabs.find` (the workspace-tab API returns undefined).
- The Marketplace needs `settings.connectors.list` and `settings.accounts.list` to return arrays.
- Hide the floating deck card with `hideFloating(text)`.
- Scroll the chat to the top for a full conversation.
- Find cards to lift with an exact-text XPath (the done summary repeats card titles).

**Output:** `capture.mjs` → `readme_frames.py` makes `docs/images/readme/*` (the hero: the desktop window plus the phone). See `docs/play-store/tools/README.md`. Related: [[android-screenshots-without-device]].
