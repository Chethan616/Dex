# Dex Mesh — reaching your PC from anywhere

**For the person building this.** You are adding one feature to a system that
already works. This document explains enough of the existing architecture to
make your part fit, then specifies exactly what to build.

The most important thing on this page: **you will not need to edit any file the
core team is working on.** The seams are already cut. If you find yourself
opening `core/orchestrator/`, `core/brain/`, `agents/`, or `daemon/`, stop —
something has been misunderstood, and a merge conflict is coming.

---

## 1. What Dex is

Dex is a Windows automation agent. You say what you want in ordinary language;
it works out the steps, picks the cheapest mechanism for each, does it, and
then **reads the state back to check it actually happened**.

```
   you ──▶ Gateway ──▶ Brain ──▶ Orchestrator ──▶ Agents ──▶ Windows
                                      │                          │
                                      └──── verify ◀─────────────┘
```

- **Gateway** (`core/gateway.ts`) — one request in, one result out. Owns the
  session, resolves references ("the report"), and decides what to say at the end.
- **Brain** (`core/brain/planner.ts`) — one model call that returns a *plan*: a
  small DAG of steps. It never executes anything.
- **Orchestrator** (`core/orchestrator/orchestrator.ts`) — runs the steps,
  raises confirmations for risky ones, and verifies each result.
- **Agents** (`agents/*`) — the hands. System (Windows APIs), App (UI
  Automation), Browser, Files, Delivery, Workspace.

### The rule that shapes everything

**A return value is a claim, not proof.** Nothing is reported as done until
state was read back. If it cannot be checked, it says `UNVERIFIABLE` — never
"worked". You will see this reflected in the events you stream to the phone,
and you should not smooth it over.

### The tier ladder

Every step is one of four confirmation tiers:

| Tier | Meaning |
|---|---|
| 4 | Silent. Reads, launching an app, volume. |
| 3 | Pre-approve once per session. |
| 2 | **Always confirm.** Deleting, installing, registry writes, running programs. |
| 1 | Hand-off to the human. Passwords, CAPTCHAs. |

This matters to you because **a remote request is still subject to it**. A phone
2 km away can raise a Tier 2 card, and the person holding the phone answers it.
You get that for free — see §4.

---

## 2. Your problem: no Bluetooth, no shared Wi-Fi, 2 km apart

The phone and the PC cannot see each other. The PC is behind NAT and has no
public address. Neither can accept an inbound connection.

**Both ends dial out to a small relay in the middle.**

```
  phone (web app)                relay                    PC (Dex core)
  GitHub Pages          Cloudflare / Fly.io           channels/mesh/
        │                        │                           │
        │──── wss:// ───────────▶│◀──────── wss:// ──────────│
        │      (outbound)        │        (outbound)         │
        │                        │                           │
        │═══════ end-to-end encrypted payloads ══════════════│
                    the relay only sees ciphertext
```

Both sides make **outbound** WebSocket connections, which every NAT and
firewall permits. The relay pairs two sockets that present the same mesh id and
copies bytes between them. That is its entire job.

### There is no database, and that is a design choice

The relay holds two things, both in memory, both gone when it restarts:

- a map of `meshId → the sockets currently connected for it`
- nothing else

No accounts, no message history, no file storage, no user table. If the relay
restarts, both ends reconnect and carry on. If the relay is replaced by a
different one, you change a URL.

This is possible because **all the state lives on the PC already** — the task
history, the workflows, the files. The phone is a window onto that machine, not
a copy of it.

### The relay must not be trusted

It is a box on someone else's computer that your requests pass through. So:

- **Payloads are end-to-end encrypted.** Pairing performs an X25519 exchange;
  everything after is sealed with the derived key. The relay routes on a public
  mesh id and can read nothing else.
- **The PC authorises, not the relay.** An inbound request is refused unless it
  is signed by a device in `meshPairedDevices`. A compromised relay can drop or
  delay messages; it cannot inject one.
- **Files are encrypted too.** "Send me that PDF" must not become "the relay
  operator has my PDF".

---

## 3. What the user experience must be

The requirement, in the owner's words:

> "display the aadhaar file, it's mostly in my PC downloads folder"

and the phone should show *searching → found → fetching → here it is*, not a
spinner and then an answer.

That granularity already exists. The core emits a typed event for every stage:

```
thinking     "display the aadhaar file…"
planning     Plan: "Find and send the Aadhaar document" — 2 step(s)
selecting    step_1: find_files
executing    FileAgent is working on it
done         Found 1 match: C:\Users\cheth\Downloads\aadhaar.pdf
selecting    step_2: send_file
done         Sent aadhaar.pdf to mesh
done         Here it is — aadhaar.pdf, 1.2 MB, from your Downloads folder.
```

**Your job is to forward these, not to invent them.** The web client renders the
same stream the desktop app does.

---

## 4. Why this is a small job: it is a channel

Dex already talks to Telegram, Discord and WhatsApp. Each is a **channel
adapter** — roughly 150 lines that receive a message and send text back.
Everything else is shared:

`channels/base_channel.ts` → `ChannelRuntime` gives every channel:

- **the owner gate** — a non-owner gets *silence*, not a refusal. Replying
  "unauthorised" confirms the bot is listening and tells an attacker their id is
  merely wrong.
- **live progress** — it subscribes to the event bus and streams steps back,
  rate-limited and coalesced.
- **approvals** — a Tier 2 card raised mid-task is presented on the channel that
  asked, and answered from there.
- **file delivery** — `Reply.sendFile` is how "send it to my phone" works.

So **the mesh is a fourth channel.** Implement this interface and everything
above arrives with it:

```ts
export interface ChannelAdapter {
  readonly source: DexRequest['source'];   // 'mesh' — already added for you
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface Inbound {
  senderId: string;                 // the paired device's fingerprint
  chatType: 'direct' | 'group';     // always 'direct'
  chatId: string;                   // the mesh session id
  text: string;
}

export interface Reply {
  send(text: string): Promise<string | undefined>;
  edit?(handle: string, text: string): Promise<void>;
  sendFile?(filePath: string, caption?: string): Promise<void>;
}
```

Read `channels/telegram.ts` first. It is the shortest complete example, and
yours has the same shape.

---

## 5. The seams — everything you need already exists

These were added ahead of time so your work is **new files only**.

| Seam | Where | State |
|---|---|---|
| `'mesh'` as a request source | `core/events/types.ts:63` | ✅ done |
| Mesh settings | `core/settings/config_store.ts` — `meshEnabled`, `meshRelayUrl`, `meshDeviceId`, `meshPairedDevices` | ✅ done |
| Startup wiring | `src/main.ts` — loads `channels/mesh/mesh_channel` when enabled, and warns instead of crashing when absent | ✅ done |
| Owner gate | `core/owner_gate.ts` — takes a per-source id | ✅ exists |
| File delivery | `Reply.sendFile` → `agents/delivery/` | ✅ exists |

**`src/main.ts` already contains this. Do not change it:**

```ts
const mesh = readConfig();
if (mesh.meshEnabled && mesh.meshRelayUrl) {
  const { MeshChannel } = require('../channels/mesh/mesh_channel');
  started.push(new MeshChannel(runtime));
}
```

Create `channels/mesh/mesh_channel.ts` exporting `MeshChannel` and it starts.

---

## 6. What to build

### 6.1 `channels/mesh/` — the PC side (TypeScript)

```
channels/mesh/
  mesh_channel.ts     ChannelAdapter. Dials the relay, holds the socket open.
  crypto.ts           X25519 pairing, sealed boxes. Use node:crypto.
  pairing.ts          Generate/accept a pairing code; persist via updateConfig().
  protocol.ts         The wire types, shared with the web client.
```

`mesh_channel.ts` does four things:

1. **Connect out** to `meshRelayUrl`, reconnect with backoff. Never listen.
2. **Decrypt and verify** each inbound frame. Refuse anything not signed by a
   device in `meshPairedDevices` — silently, per the owner-gate rule.
3. **Hand the text to `runtime.handle('mesh', inbound, reply)`.** That single
   call buys you planning, execution, verification, approvals and progress.
4. **Implement `Reply`** — encrypt and send `send`, `edit` and `sendFile` back
   through the relay.

Chunk files: fixed-size encrypted chunks with an index, reassembled on the
client. A 12 MB PDF over one WebSocket frame will fail on some relays.

### 6.2 `mesh-relay/` — the switchboard (TypeScript, ~150 lines)

A WebSocket server that:

- accepts connections, reads one `hello { meshId, role }` frame
- keeps at most one `host` (the PC) and any number of `client` sockets per meshId
- copies every subsequent frame between them, **without parsing the payload**
- drops everything when the last socket for a meshId closes

It must not: store anything, log payloads, or be able to decrypt.

Deploy free on Cloudflare Workers (Durable Objects give you the per-room
affinity), Fly.io, or Render.

### 6.3 `web/` — the client (static, GitHub Pages)

A PWA. No build server, no backend, no database.

- **Pairing** — the PC shows a code (and a QR); the phone enters it; both derive
  the shared key. The key is kept in the browser's IndexedDB and never leaves it.
- **Prompt box** — one field, same as the desktop.
- **Live step stream** — this is the point. Render each event as it lands, with
  its verification line. Copy the desktop app's mapping; the shapes are in
  `app/lib/core/models/` and `app/lib/core/state/conversation_store.dart`, which
  is a faithful implementation of the same protocol.
- **Approval cards** — Tier 2 arrives here. Approve and Deny must send the
  `stepVersion` back **exactly as received**: it is a hash of the step you were
  shown, and the core refuses a stale one.
- **Files** — receive chunks, reassemble, offer a download.

Deploy with GitHub Actions to Pages. It is static; there is nothing to run.

---

## 7. The wire protocol

Keep this in `protocol.ts` and mirror it in the web client. Everything below is
the *plaintext*; the relay only ever sees the sealed envelope.

```ts
// PC ← phone
type ClientFrame =
  | { t: 'prompt'; id: string; text: string }
  | { t: 'approve'; requestId: string; stepId: string; stepVersion: string;
      verdict: 'approved' | 'approved_session' | 'rejected' }
  | { t: 'cancel'; requestId: string }
  | { t: 'ping' };

// PC → phone
type HostFrame =
  | { t: 'event'; requestId: string; stepId?: string;
      type: 'thinking' | 'planning' | 'selecting' | 'executing'
          | 'awaiting' | 'done' | 'failed' | 'cancelled';
      message: string; data?: unknown }
  | { t: 'confirmation'; request: ConfirmationRequest }
  | { t: 'result'; requestId: string; status: string; summary: string; answer?: string }
  | { t: 'file'; name: string; mime: string; size: number;
      chunk: number; chunks: number; bytes: string /* base64 */ }
  | { t: 'pong' };
```

The event names are not arbitrary — they are the core's own, so you can forward
without translating. See `core/events/types.ts`.

---

## 8. Plan

Each phase ends somewhere demonstrable. Do not start the next until the
previous one is provably working.

### Phase 1 — Relay (half a day)
Build `mesh-relay/`. Two `wscat` sessions with the same meshId can exchange
bytes. Deploy it. **Done when:** two terminals on different networks can talk.

### Phase 2 — Crypto and pairing (one day)
`crypto.ts` and `pairing.ts`. X25519 → HKDF → AES-256-GCM sealed frames, with
tests for tampering, replay and an unpaired sender. **Done when:** a unit test
shows a modified ciphertext is rejected, and the relay's view is opaque.

### Phase 3 — MeshChannel (one day)
`mesh_channel.ts`. Dial, decrypt, `runtime.handle(...)`, stream back.
**Done when:** a `wscat` client sends `{"t":"prompt","text":"what is my volume"}`
and receives the step events and the answer.

### Phase 4 — Web client, read-only (one day)
Static page, pairing, prompt box, live step stream. Deploy to Pages.
**Done when:** the Aadhaar scenario in §3 works end to end from a phone on
mobile data — search, found, fetched — with the file arriving.

### Phase 5 — Approvals and polish (one day)
Confirmation cards, cancel, reconnect, offline state, PWA install.
**Done when:** a Tier 2 step raised on the PC is approved from the phone, and
the core accepts the `stepVersion`.

---

## 9. Rules

1. **Do not edit** `core/`, `agents/`, `daemon/`, `src/main.ts`, `app/`, or
   `ui/dex-bar/`. Everything you need is already there. If something is
   genuinely missing, open an issue rather than reaching in — that file is
   probably being edited right now.
2. **New directories only:** `channels/mesh/`, `mesh-relay/`, `web/`.
3. **The relay learns nothing.** If a change would let it read a payload, that
   change is wrong.
4. **Never weaken the tier ladder.** Remote is not a reason to auto-approve. A
   plan that fans out into a dozen Tier 2 steps should raise a dozen cards on
   the phone, queued — the desktop app does exactly this, see
   `app/lib/core/state/conversation_store.dart`.
5. **Silence for strangers.** An unpaired device gets no response at all.
6. **`npm run typecheck` and the existing suites must stay green.** You should
   not need to change a single existing test.

---

## 10. Getting started

```bash
git clone <repo>
git checkout claude          # this branch
npm install
npm run typecheck            # should pass before you touch anything

cat channels/telegram.ts     # the shortest complete channel — yours is this shape
cat channels/base_channel.ts # what you get for free
cat core/events/types.ts     # the event names you will forward
```

Then Phase 1. The relay is independent of Dex entirely — you can build and
deploy it before reading another line of this codebase.

---

## Appendix — how the PC end already works

Useful context, not something to change.

**Windows control** goes through a privileged daemon over a named pipe with an
explicit DACL. Actions are banded like a traffic light: green runs silently,
amber confirms, red is refused outright and stays refused even under Full
Access. The same idea governs shell commands and registry writes.

**Nothing opens a console.** Every child process is created with
`CREATE_NO_WINDOW` inside a job object that kills them if the app dies. There is
a test that enumerates desktop windows to prove it.

**Memory** is SQLite at `%LOCALAPPDATA%\DEX\dex.db` — every task, its outcome,
its duration, and the workflows saved out of the ones worth repeating. A
workflow stores the *plan* with the varying values replaced by parameters, so
re-running with different values costs no model call at all.

**Settings** are `%LOCALAPPDATA%\DEX\settings.json`; API keys are in the Windows
credential store, DPAPI-encrypted against the user's account. Neither is in the
repo. Do not add a `.env`.
