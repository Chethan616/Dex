# dex-mesh-relay

A WebSocket switchboard for [Dex Mesh](../docs/MESH.md). It pairs two sockets
that present the same room id and copies frames between them. It parses nothing
past the first `hello`, stores nothing, and holds no key — the payloads are
end-to-end encrypted between the PC and the phone, and the relay only ever sees
ciphertext.

If a change here would let the relay learn anything beyond *"N bytes for room
X"*, the change is wrong.

## Run locally

```bash
npm install
npm run dev          # ws://localhost:8787
```

### Prove it works (Phase 1 done-when)

Two terminals, on different networks:

```bash
# terminal A — the "host"
npx wscat -c ws://<relay-host>:8787
> {"t":"hello","meshId":"aaaaaaaaaaaaaaaa","role":"host"}

# terminal B — a "client"
npx wscat -c ws://<relay-host>:8787
> {"t":"hello","meshId":"aaaaaaaaaaaaaaaa","role":"client"}
> {"hello":"from the client"}      # arrives verbatim in terminal A
```

`{"t":"presence",...}` frames are the relay telling each side who else is in the
room. Everything else is copied without being read.

## Deploy

### Cloudflare Workers (recommended — free, per-room affinity via Durable Objects)

```bash
npx wrangler deploy
```

Uses `worker.js` and `wrangler.toml`. The client connects to
`wss://dex-mesh-relay.<subdomain>.workers.dev/r/<meshId>` — the room id is in
the path, which is public routing data just like the `hello` frame.

### Fly.io / Render (the plain Node server)

```bash
npm run build && npm start          # honours $PORT
```

`server.ts` is a standard `ws` server with an HTTP `/healthz`. Any platform that
gives you a long-lived TCP socket and a port will run it.

## What it is not

No accounts. No message history. No file storage. No logging of payloads. If the
relay restarts, both ends reconnect and carry on. If you replace it with a
different one, you change a URL in the PC's settings and re-pair nothing.
