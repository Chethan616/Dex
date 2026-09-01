# channels/mesh — the PC side of Dex Mesh

Reaching this PC from a phone when there is no Bluetooth and no shared network.
The full design is in [../../docs/MESH.md](../../docs/MESH.md); this is the map
of the code.

## Files

| File | What it does |
|---|---|
| `protocol.ts` | The wire types. The single source of truth, mirrored by hand in `web/js/protocol.js`. |
| `crypto.ts` | X25519 → HKDF-SHA256 → AES-256-GCM sealed frames. `node:crypto` only. Byte-compatible with `web/js/crypto.js` (proven by `tests/smoke_mesh_interop.ts`). |
| `pairing.ts` | The PC's mesh identity (one keypair, in `%LOCALAPPDATA%\DEX\mesh_identity.json`, mode 600), pairing codes, room-id derivation, and the `meshPairedDevices` allow-list. |
| `mesh_channel.ts` | The `ChannelAdapter`. Dials the relay, decrypts and verifies each frame, hands the text to the Gateway, streams the core's typed events back. |

## How a request flows

```
phone ──seal──▶ relay ──copy──▶ mesh_channel.tryOpen()   verify: paired device?
                                        │ yes
                                        ▼
                       gateway.handle('mesh', deviceFp, text, deliverTo)
                                        │
              bus.subscribeAll ────────►│  every DexEvent → HostFrame → seal → relay → phone
              confirmations.registerProvider ──► Tier 2/3/1 cards → phone, answered from phone
                                        ▼
                              result → 'result' frame
```

`mesh_channel.ts` deliberately does **not** use `ChannelRuntime.run()` — that
renders progress as one coalesced emoji chat message, which is right for
Telegram and wrong for a web client that wants the raw typed stream. It reaches
the shared `Gateway` and `ConfirmationManager` through the `ChannelRuntime` it
is handed, so approvals are the same objects the Dex Bar sees and nothing about
the tier ladder is re-implemented.

## The one thing that is not "new files only"

`core/owner_gate.ts` has no `mesh` case — it identifies a sender by a plaintext
platform id, and the mesh identifies a sender by an X25519 signature checked
against `meshPairedDevices` *before* any prompt reaches the Gateway. Editing
`owner_gate.ts` is forbidden (docs/MESH.md §9), so `MeshChannel`'s constructor
extends the shared `OwnerGate` instance **in place** with the single case it
lacks: a `mesh` request whose senderId is a paired device fingerprint is the
owner. Every existing rule for every existing source is untouched — the
`test:channels` suite still passes unmodified, and `test:mesh` covers the
extension directly.

## Pairing

```bash
npm run mesh -- enable wss://<relay-host>     # once
npm run mesh -- pair                          # prints a code, waits for a phone
npm run mesh -- list
npm run mesh -- revoke <fingerprint>
```

The private key never leaves the machine. A paired device is a fingerprint in
`meshPairedDevices`; revoking removes it and the phone must pair again.

## Known limitation

The plain-`ws` relay path attaches the PC to **one** room per socket, so the
built-in server currently supports a single paired phone at a time (the common
case — Dex has one owner). Multiple simultaneous phones need the Cloudflare
Worker deployment, which puts the room id in the path and gives each its own
Durable Object. Adding multi-room support to the Node server is a `hello`-per-room
change in `mesh_channel.ts` and `mesh-relay/server.ts`; it was left out to keep
Phase 1–5 honest about what is proven.

## Tests

| Command | Proves |
|---|---|
| `npm run test:mesh` | tamper / replay / unpaired-sender rejection; relay opacity; pairing allow-list; the owner-gate extension |
| `npm run test:mesh-relay` | the real relay copies bytes between two sockets and never leaks one client to another; a sealed prompt → sealed event stream round-trips |
| `npm run test:mesh-interop` | `crypto.ts` (node) and `crypto.js` (WebCrypto) produce the same bytes both ways |
