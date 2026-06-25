# DexV2 — Master Implementation & Execution Blueprint

> **Target Executor:** Gemini 3.5 Flash (or autonomous agent)
> **Objective:** Build the complete DexV2 ecosystem from scratch. Do not import `openclaw`. This document is the ultimate source of truth, integrating the Node.js backend (Brain), Python execution engines (Hands), and all four frontend clients (CLI, Flutter Desktop, Android Kotlin, iOS Swift).

---

## 1. System Architecture

DexV2 is a cross-platform, multi-agent control surface. The "Brain" runs locally on Windows with native Administrator privileges, intercepting messages from the user. The "Hands" physically execute tasks.

```text
┌─────────────────────────────────────────────────────────────┐
│  FRONTENDS (The Faces)                                      │
│  - Android (Kotlin + Jetpack Compose)                       │
│  - iOS (Swift + SwiftUI)                                    │
│  - Windows Desktop (Flutter, System Tray, Global Hotkeys)   │
│  - NPM CLI (dexagent cmdline)                               │
└───────────────────────────────┬─────────────────────────────┘
                                │ WebSocket :18789 / CLI args
┌───────────────────────────────▼─────────────────────────────┐
│  DEXV2 BRAIN (Node.js - Always Elevated via runas)          │
│  1. Owner Gate (ignores strangers on WA/Telegram/Discord)   │
│  2. Intent Cache (MiniLM-L6-v2 Semantic Embeddings)         │
│  3. 4-Tier LLM Router (0, 0.5, 1, 2) to save 97% tokens     │
│  4. Context & Prompt Caching (Anthropic/Gemini native)      │
└───────────────────────────────┬─────────────────────────────┘
                                │ JSON MCP Protocol / Stdio
┌───────────────────────────────▼─────────────────────────────┐
│  THE HANDS (Python 3.10 FastMCP Servers)                    │
│  - UFO2 / UFO3 (Native UI Automation, Vision, Cursor Ctrl)  │
│  - Browser-Use (Playwright Web Automation)                  │
│  - Core OS (PowerShell, DPAPI, Registry, File System)       │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Directory Structure

Scaffold the repository exactly as follows:

```text
d:\project1\DexV2\
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── dex.mjs                         # Global CLI entrypoint
│
├── src/                            # THE BRAIN (Node.js)
│   ├── index.ts
│   ├── cli/                        # Phase 8: NPM CLI
│   ├── config/                     # Phase 0: Schema & Loader
│   ├── db/                         # Phase 1: SQLite state, telemetry, creds
│   ├── utils/                      # Phase 1: elevate.ts, dpapi.ts
│   ├── brain/                      # Phase 2: Core intelligence pipeline
│   ├── llm/                        # Phase 3: Gemini/Claude/Groq providers
│   ├── tools/                      # Phase 4: Intent routing & result compression
│   ├── gateway/                    # Phase 7: WS Server
│   └── channels/                   # Phase 6: Owner-gated WA/Telegram
│
├── drivers/                        # THE HANDS (Python)
│   ├── windows-desktop/            # Phase 5: UFO2 & UFO3 wrappers
│   └── browser-control/            # Phase 5: Browser-Use wrappers
│
├── clients/                        # THE FACES (Frontends)
│   ├── desktop-flutter/            # Phase 9: Windows Flutter App
│   ├── android-compose/            # Phase 10: Kotlin App
│   └── ios-swiftui/                # Phase 11: Swift App
│
└── test/                           # 1:1 Vitest suite for src/
```

---

## Phase 0: Environment & Scaffolding

**Target:** `package.json`, `tsconfig.json`, `vitest.config.ts`
**Goal:** Perfect strict-mode TypeScript environment.

1. **Initialize Package:**
   ```powershell
   npm init -y
   npm pkg set type="module" bin.dex="./dex.mjs"
   npm install zod ws sqlite3 @xenova/transformers discord.js grammy @whiskeysockets/baileys commander
   npm install -D typescript vitest @types/node @types/sqlite3 @types/ws
   ```
2. **TSConfig:** Ensure `"moduleResolution": "Bundler"`, `"target": "ES2022"`, and `"strict": true`.
3. **Vitest:** Ensure globals are enabled so `test()` and `expect()` work out of the box.

---

## Phase 1: Persistence & Native Elevation

**Target:** `src/utils/elevate.ts`, `src/utils/dpapi.ts`, `src/db/migrations.ts`
**Goal:** Ensure the backend runs as Administrator seamlessly and secures tokens.

1. **`elevate.ts`**: The process MUST self-escalate on boot.
   - Use `execSync('net session')` to check for Admin rights.
   - If it throws, respawn via `powershell Start-Process -FilePath "node" -ArgumentList ... -Verb RunAs -Wait`, then `process.exit(0)`.
2. **`dpapi.ts`**: Wrap PowerShell `[System.Security.Cryptography.ProtectedData]` to encrypt/decrypt OAuth tokens natively without relying on flaky node bindings.
3. **SQLite Migrations**:
   - `telemetry.db`: Create `intent_cache` (storing `Float32Array` vectors as BLOBs) and `tier_patterns` for the adaptive regressor.
   - `creds.db`: Create `credentials` table for storing DPAPI-encrypted OAuth tokens.

---

## Phase 2: The Core Brain (0-Token Path)

**Target:** `src/brain/*`
**Goal:** Process 70% of intents without ever calling an LLM.

1. **Intent Normalizer (`intent-normalizer.ts`)**:
   - Strip filler regex: `/\b(please|kindly|for me|hey|dex)\b/gi`.
   - Convert aliases: "word" -> "winword", "twenty" -> "20".
2. **Tier 0 & 0.5 (Parametric Routers)**:
   - Create regex maps for exact tasks (e.g., `/^set volume to (\d+)$/i`).
   - Extract parameters and return strict JSON payloads: `{ tool: "shell", cmd: "$vol=..." }`.
3. **Semantic Cache (`intent-embedder.ts`)**:
   - Import `pipeline` from `@xenova/transformers`.
   - Load `Xenova/all-MiniLM-L6-v2`. Vectorize the normalized intent.
   - Compare against SQLite `intent_cache` via Cosine Similarity. If `> 0.93`, execute cached action instantly.
4. **Adaptive Regressor**:
   - Track successes/failures. 5 consecutive successes downgrade a task to a cheaper LLM tier. 2 failures escalate it.

---

## Phase 3: The LLM Engine (Prompt Caching)

**Target:** `src/llm/*`
**Goal:** Optimize Gemini/Claude API costs by 90% using context caching.

1. **Provider Interfaces**: Implement standard wrappers for `chat()`.
2. **Anthropic Cache Control**:
   - Append `cache_control: { type: "ephemeral" }` to the `system` block and the *last* tool in the tools array.
3. **Gemini Context Cache**:
   - Use the `/v1beta/cachedContents` API to pre-load system prompts.
4. **Grammar Constraints**:
   - Define `TIER1_ACTION_SCHEMA` (single step) and `TIER2_PLAN_SCHEMA` (multi-step arrays). Enforce them via `responseSchema` (Gemini) or `json_schema` (Claude) to prevent prose generation.

---

## Phase 4: Tools & Result Compression

**Target:** `src/tools/*`
**Goal:** Prevent prompt-bloat from the 20+ tool expansions.

1. **Semantic Tool Router**:
   - Map intents to subsets. If intent contains "email" -> inject `[gmail, exec]`. If intent contains "draw" -> inject `[windows-desktop]`.
   - NEVER inject all 25 tools at once. Max 4 tools per prompt.
2. **Result Compressor**:
   - When a tool returns 500 lines of text (e.g., PowerShell output), extract only lines containing "Error/Exception" plus the last 5 non-empty lines.

---

## Phase 5: The "Hands" (Python Execution Engines)

**Target:** `drivers/*`
**Goal:** Native OS and Web manipulation.

1. **UFO2/UFO3 Desktop Control (`drivers/windows-desktop/server.py`)**:
   - FastMCP server exposing `run_desktop_task`.
   - Integrate Microsoft UFO3 (vision-grounded). It must be able to literally move the cursor to **draw a picture in MSPaint** using screen pixels, not just opening the app.
2. **Browser-Use Web Control (`drivers/browser-control/server.py`)**:
   - FastMCP server exposing `run_browser_task`.
   - Wrap `browser-use` + Playwright. Handle complex web forms and university portals headlessly using Groq (Qwen3) or Gemini.

---

## Phase 6: Owner-Gated Channels

**Target:** `src/channels/*`
**Goal:** WhatsApp, Telegram, and Discord bots that only listen to the owner.

1. **Owner Gate (`owner-gate.ts`)**:
   - Reject any `senderId !== ownerId`.
   - **Self-Chat / DM**: If owner messages themselves, process immediately.
   - **Group Chat**: If owner types in a group, only process if the message starts with `@dex`. (e.g., `@dex grab the file`). If owner types "hi", ignore.
2. **Adapters**: Implement `baileys` (WhatsApp) and `grammy` (Telegram) to feed into the gateway.

---

## Phase 7: Gateway WebSocket Server

**Target:** `src/gateway/server.ts`
**Goal:** The central nerve center.

1. Expose `ws://127.0.0.1:18789`.
2. Stream real-time `StepEvents` (idle -> thinking -> awaiting -> acting -> done).
3. If an action is destructive, emit a `PendingAction` event and halt execution until a client sends an `APPROVE` packet.

---

## Phase 8: The NPM CLI (`dexagent`)

**Target:** `dex.mjs`, `src/cli/*`
**Goal:** Command-line control.

1. Use `commander`.
2. `dex start`: Boots the gateway and channels in the background.
3. `dex chat "..."`: Sends a query to the WebSocket. Renders the live steps using a CLI spinner (e.g., `ora`).

---

## Phase 9: Windows Desktop App (Flutter)

**Target:** `clients/desktop-flutter/*`
**Goal:** The flagship desktop interface.

1. Build a borderless, system-tray Flutter app.
2. Register a global hotkey (e.g., `Ctrl+Space`) to summon it.
3. **3-Pane UI**: Devices (left), Conversation (center), Live Actions (right).
4. **Action Previews**: When an action is pending, render an **Amber-bordered Card** in the right pane. The backend is halted until the user clicks the explicit `APPROVE` button.

---

## Phase 10: Android Client (Kotlin + Jetpack Compose)

**Target:** `clients/android-compose/*`
**Goal:** Mobile remote control for the PC.

1. Build a native Android app in Kotlin DSL.
2. **Networking**: Connect to the PC via `OkHttp WebSocket` (e.g., `ws://192.168.1.X:18789`).
3. **UI**: Jetpack Compose chat interface. Must replicate the Amber-bordered Action Preview cards so the user can approve/deny PC actions from their phone.

---

## Phase 11: iOS Client (Swift + SwiftUI)

**Target:** `clients/ios-swiftui/*`
**Goal:** iOS equivalent of the Android client.

1. Build a native iOS 16+ app in SwiftUI.
2. **Networking**: Connect via `URLSessionWebSocketTask`. (Requires Local Network privacy permissions in `Info.plist`).
3. **UI**: Mirror the Compose UI with native SwiftUI `ScrollView` and Action Preview cards.

---

## Verification & Acceptance Criteria

Before finalizing, Gemini MUST verify:
- **Zero-Token Verification**: `vitest` assertions proving that exact matches and parametric tasks bypass the LLM entirely.
- **Admin Isolation**: Running without Admin triggers the PowerShell `Start-Process` fallback.
- **Tool Routing**: "draw this PIC in MSPaint" routes to UFO3. "go to google.com" routes to browser-use.
- **Cross-Platform Parity**: The WebSocket JSON protocol (`ActionPreview`, `AgentState`) matches exactly across Flutter, Kotlin, and Swift clients.
