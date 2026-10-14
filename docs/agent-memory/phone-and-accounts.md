---
name: phone-and-accounts
description: "DEX Android app (android/), Firebase bridge, and one-click OAuth accounts — how they fit and what still needs the user's own cloud setup"
metadata:
  node_type: memory
  type: project
  originSessionId: baacd51d-de97-451d-b014-856abd9e3f87
  modified: 2026-09-26T14:31:10.909Z
---

As of 2026-09-26 DEX has:
- **One-click accounts** (desktop/app/src/main/accounts): Google (loopback+PKCE), GitHub (device flow), Slack (OAuth v2). They fill MCP connections in the keytar store. Google uses DEX's own dependency-free MCP server `desktop/app/mcp-servers/google/server.mjs` (Gmail/Calendar/Meet/Drive/Docs/Sheets/Contacts/Tasks), launched with Electron's Node via `launchSpec` in mcp/catalog.ts.
- **Phone bridge** (src/main/firebase/bridge.ts): Firebase Auth Email/Password — same email+password on desktop (stored in keytar) and phone = pairing (switched from Google sign-in on 2026-09-26 at the user's request); Firebase project is `dexv3-chethan616`; Firestore `users/{uid}/{devices,sessions/blocks,commands}`; reuses renderer/logs/transcript.ts. Rules/functions/setup in `firebase/`.
- **Android app** at `android/` (not dex/core/apps/android, which is OpenClaw upstream): Compose, material3 1.5.0-alpha (needs compileSdk 37), vendored thinking-orbs in `android/orbs`, native bot avatars, haptics. SDK is at D:\Android\Sdk (ANDROID_HOME env var is wrong).

**Why:** user wants "connect with Google" instead of nerdy token/file-path setup, and a rich M3 Expressive phone app.

**How to apply:** OAuth client ids (config/oauth-clients.json) and Firebase apps/config (firebase/setup.ps1 → google-services.json + config/firebase.json; the CLI login had expired and gcloud's account lacks access to the project) must be created by the user in their own Google/Firebase accounts — never create cloud resources without asking. No emulator/device was available, so the Android UI was never visually verified. [[project-overview]]
