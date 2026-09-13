# What lives in `dex/core/apps/` and `dex/core/extensions/`

Two directories you'll see in the repo with no obvious connection to the
Dex Flutter UI. Both are inherited from the OpenClaw upstream we forked.
This document tells you what each one is, what ships in the `dexagent`
npm tarball, what's actively used by Dex today, and what's reference
material kept for heritage / future work.

## TL;DR

| Folder | Purpose | Ships in npm tarball? | Used by Dex today? |
|---|---|---|---|
| `dex/core/apps/android/` | Upstream OpenClaw Android client (Kotlin) | No — excluded from npm `files[]` | No — superseded by the Dex Flutter UI in `app/` |
| `dex/core/apps/ios/` | Upstream OpenClaw iOS client (Swift) | No | No — superseded |
| `dex/core/apps/macos/` | Upstream OpenClaw macOS desktop client (Swift) | No | No — superseded |
| `dex/core/apps/macos-mlx-tts/` | macOS local TTS helper using MLX | No | Optional; pairs with the `tts-local-cli` extension |
| `dex/core/apps/shared/OpenClawKit/` | Cross-platform protocol + UI kit consumed by android/ios/macos | No | No — same fate as the mobile clients |
| `dex/core/apps/swabble/` | Internal demo / scratch app | No | No |
| `dex/core/extensions/` | 135 plugin packages: LLM providers, channels, search, voice, etc. | **Yes** — bundled into `dist/` and shipped | **Yes** — auto-loaded by the gateway |

## `apps/` in detail

`apps/` is the upstream OpenClaw multi-platform UI tree. OpenClaw shipped
its own native mobile/desktop clients before settling on a strategy. For
Dex we kept the directory but the **Flutter app at `D:\project1\app\`
replaces all of them.**

Each `apps/<platform>/` directory has:
- Its own native build system (Gradle for Android, Xcode for iOS/macOS).
- An import of `apps/shared/OpenClawKit/` for the gateway protocol + a
  small UI library.
- No connection to the published npm package.

### Decision matrix

| Subfolder | Keep, deprecate, or delete? | Why |
|---|---|---|
| `android/` | **Deprecate, keep on disk for now** | Building a native Android app requires Android Studio + signing keys. Useful as reference when we wire the Flutter Android target. Not worth a `git rm` until v1.5 mobile work starts. |
| `ios/` | Deprecate, keep on disk | Same. iOS provisioning is annoying; Flutter handles it via Xcode anyway. |
| `macos/` | Deprecate, keep on disk | Same; macOS native target will come back as Flutter `flutter run -d macos` per `design.md`. |
| `macos-mlx-tts/` | Investigate | The TTS pair-process is the only thing in `apps/` that has a reason to ship alongside the npm package. Track for v1.4 voice work. |
| `shared/OpenClawKit/` | Keep | The `tool-display.json` inside it is imported by `ui/src/ui/tool-display.ts` (you saw the path resolve breakage in B.6). Hard dependency of the gateway UI bundle today. |
| `swabble/` | Delete in v1.5 cleanup | Scratch UI; no consumers. |

Phase B never touched `apps/` because nothing in there blocks the npm
publish. v1.5 (per the plan file) is where this either becomes the
installer's `runtime/` payload or gets dropped entirely.

## `extensions/` in detail (the 135 plugins)

Every directory under `dex/core/extensions/` is a self-contained plugin.
Each one has:
- `package.json` with name like `openclaw-plugin-<id>` (note: this is the
  *plugin* manifest convention; **not** the upstream OpenClaw npm name).
- `src/` with the runtime: registration helpers, an API barrel, plus
  whatever the plugin actually does.
- `openclaw.plugin.json` — the manifest contract file the plugin loader
  scans for. This **filename stays as-is** (see `HERITAGE.md`); renaming
  it breaks plugin discovery for every host.
- Usually `SKILL.md` (a model-facing skill description) and tests.

### Categories — what these 135 plugins do

The plugins fall into about a dozen functional buckets:

#### LLM providers (~30 plugins)
The bridge from the gateway to each model vendor. Authentication, model
catalog, capability mapping, request shaping.

```
anthropic, anthropic-vertex, openai, codex, codex-supervisor, copilot,
copilot-proxy, github-copilot, google, mistral, groq, perplexity,
arcee, cerebras, chutes, deepinfra, deepseek, fireworks, gmi, huggingface,
inworld, kilocode, kimi-coding, lmstudio, microsoft, microsoft-foundry,
minimax, moonshot, novita, nvidia, ollama, openrouter, opencode,
opencode-go, qianfan, qwen, sglang, stepfun, synthetic, tencent, together,
venice, vercel-ai-gateway, vllm, voyage, xai, zai,
alibaba, amazon-bedrock, amazon-bedrock-mantle, byteplus,
cloudflare-ai-gateway, litellm, volcengine
```

The gateway picks one as the "brain" via `dex models set primary`. The
rest are available as fallbacks, capability-specific (vision, embedding,
TTS, image), or per-skill overrides.

#### Messaging channels (~25 plugins)
Two-way bridges so a user can DM the agent from their preferred app.

```
telegram, whatsapp, discord, slack, signal, imessage, irc, matrix,
msteams, feishu, line, mattermost, nextcloud-talk, nostr,
synology-chat, tlon, twitch, zalo, zalouser, qqbot, sms, voice-call,
google-meet, googlechat
```

Each registers itself in the gateway's channel registry. Dex's `app/`
Flutter UI is itself a "channel" in the gateway's eyes (the local one).

#### Voice / audio (~6 plugins)
```
azure-speech, deepgram, elevenlabs, senseaudio, talk-voice,
tts-local-cli
```

TTS in, STT out, voice loops. Pairs with `apps/macos-mlx-tts/` for
on-device synthesis on macOS.

#### Image + video generation (~5 plugins)
```
comfy, fal, image-generation-core, pixverse, runway,
video-generation-core, video-generation-providers.live.test.ts, vydra
```

#### Search + web (~7 plugins)
```
brave, duckduckgo, exa, firecrawl, perplexity (also LLM),
searxng, tavily, web-readability
```

#### Memory backends (~3 plugins)
```
memory-core, memory-lancedb, memory-wiki
```

Pick one: in-process Kysely (`memory-core`), local vector store
(`memory-lancedb`), or external wiki integration.

#### Coding-agent runtimes (~6 plugins)
```
codex, codex-supervisor, copilot, copilot-proxy, github-copilot,
kilocode, kimi-coding, opencode, opencode-go
```

These embed external coding agents (OpenAI Codex, GitHub Copilot, etc.)
as sub-runtimes the gateway can delegate to.

#### Infrastructure + utility (~20 plugins)
```
acpx, active-memory, admin-http-rpc, bonjour, browser, canvas,
clickclack, device-pair, diagnostics-otel, diagnostics-prometheus,
diffs, diffs-language-pack, document-extract, file-transfer, gradium,
llm-task, media-understanding-core, migrate-claude, migrate-hermes,
oc-path, open-prose, openshell, phone-control, policy, qa-channel,
qa-lab, qa-matrix, test-support, thread-ownership, tokenjuice,
webhooks, workboard, xiaomi
```

The "long tail": IPC bridges (`acpx`), observability
(`diagnostics-otel`), the browser MCP (`browser`), document handling
(`document-extract`), and so on.

### Plugin load order at gateway startup

1. Gateway reads `~/.dex/dex.json` (formerly `openclaw.json`).
2. `dist/bundled-plugin-metadata.generated.json` lists every plugin that
   ships in `dexagent`'s tarball.
3. The plugin loader scans for `openclaw.plugin.json` files and dispatches
   to each plugin's `register` entry.
4. Channel plugins announce themselves to the channel registry.
5. Provider plugins announce themselves to the model catalog.
6. The Flutter app (the "local" channel) connects via WebSocket and sees
   the registry the gateway built.

### Verifying a plugin loaded — quick smoke

```cmd
dex plugins list                          REM full registry
dex plugins list --enabled                REM only what's active
dex plugins show telegram                 REM detail one plugin
dex plugins disable codex-supervisor      REM toggle off if it's noisy
dex plugins enable codex-supervisor       REM toggle back on
```

If a plugin fails to register, `dex doctor` shows the error under
"Plugin registry health".

### Adding your own plugin

The plugin SDK is `@dexagent/plugin-sdk`. Minimal flow:

```ts
// my-plugin/src/index.ts
import { definePlugin } from "@dexagent/plugin-sdk";

export default definePlugin({
  id: "my-plugin",
  register(ctx) {
    ctx.commands.add("my-plugin:hello", async () => {
      ctx.runtime.log("hi from my plugin");
    });
  },
});
```

```jsonc
// my-plugin/openclaw.plugin.json  (filename is the heritage contract)
{
  "id": "my-plugin",
  "entry": "./src/index.ts",
  "skill": "./SKILL.md"
}
```

Drop it under `dex/core/extensions/my-plugin/`, run `pnpm install` from
`dex/core/`, rebuild, and the loader picks it up.

## What's intentionally NOT in either folder

- The Flutter UI lives at `D:\project1\app\` (sibling of `dex/`), NOT
  inside `dex/core/apps/`.
- The MCP driver servers (UFO² + browser-use Python wrappers) live at
  `D:\project1\dex\drivers\`, NOT inside `dex/core/extensions/`. They're
  separate processes spawned by the gateway over MCP stdio.
- The vendored upstream UFO² and browser-use Python source lives at
  `D:\project1\vendor\UFO\` and `D:\project1\vendor\browser-use\`.

## How this maps to the Phase B / C work

| Phase B commit | What it changed in `apps/` or `extensions/` |
|---|---|
| B.5 | Renamed every `@openclaw/<workspace-pkg>` import in `extensions/*/package.json` to `@dexagent/<workspace-pkg>`. None of the 135 plugin IDs changed. |
| B.6 / B.7 | Rebrand pass touched test fixtures + identifiers across `extensions/`. The `openclaw.plugin.json` manifest filename **stayed** as the loader contract. |
| B.9 | Moved `core/extensions/` to `dex/core/extensions/` via `git mv`. |
| B.13 sweep | The launcher rename (`openclaw.mjs` → `dex.mjs`) caught a few extension files that hardcoded the launcher (`extensions/acpx/src/runtime.test.ts`, `extensions/matrix/src/plugin-entry.runtime.{js,test.ts}`, `extensions/ollama/ollama.live.test.ts`). |

Phase C (orchestration + OmniParser + Gemini Flash-Lite) plans to add
**three** more extensions:
- `extensions/omniparser/` — pixel-only screen parser (new).
- Existing `extensions/google/` gains the Gemini Flash-Lite catalog entry.
- A new `dex/orchestration/` (sibling of `dex/core/`) routes between
  UFO² / browser-use / OmniParser via capability scoring.

## How extensions WORK end-to-end

Walk through one concrete example so the loader story is concrete:
`extensions/anthropic/`.

1. **Discovery.** At gateway startup, the loader reads
   `dist/extensions/anthropic/openclaw.plugin.json` (the manifest) and
   imports `dist/extensions/anthropic/index.js` (the entry).
2. **Registration.** `index.js` calls `definePlugin({ id: "anthropic",
   register })`. Inside `register`, the plugin:
   - Adds an auth profile type (`anthropic-api-key`).
   - Registers a provider in the model catalog (claude-sonnet-4-6 etc.).
   - Wires runtime helpers for tool-call shaping.
3. **Auth.** When the user runs `dex onboard`, the wizard prompts for an
   Anthropic key, writes it into `~/.dex/credentials/anthropic.json`,
   and binds it to a provider id.
4. **Per-request lifecycle.** When the agent picks `anthropic/claude-...`
   for a turn, the gateway:
   - Resolves the auth profile.
   - Calls the plugin's `chat` helper with the model id + tools + prompt.
   - The plugin POSTs to `https://api.anthropic.com/v1/messages`.
   - Streams the response back through the gateway to the Flutter app.
5. **Telemetry / failure handling.** Plugin reports its own errors via
   `ctx.runtime.log` + `ctx.runtime.event`. `dex doctor` shows
   per-provider health.

Other plugin categories follow the same shape; only the surface they
register against differs (channels vs. providers vs. memory backends
vs. workboard tools etc.).

## When you're poking around

If you want to know what a specific plugin does:

```cmd
type dex\core\extensions\<plugin-id>\SKILL.md
type dex\core\extensions\<plugin-id>\openclaw.plugin.json
dir dex\core\extensions\<plugin-id>\src
```

Most plugins have a short `README.md` or `SKILL.md` describing the
contract. The `package.json` `name` field is the npm-published name if
the plugin is ever externalized.
