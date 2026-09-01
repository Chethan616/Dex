# Dex Mesh — web client

A static PWA. No build server, no backend, no database. It is the phone's window
onto the PC (see [../docs/MESH.md](../docs/MESH.md)); all the state lives on the
PC.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole markup. Pairing form, then the console. |
| `js/protocol.js` | The wire types — mirror of `channels/mesh/protocol.ts`. |
| `js/crypto.js` | X25519 + HKDF-SHA256 + AES-256-GCM, byte-compatible with `channels/mesh/crypto.ts`. WebCrypto only. |
| `js/store.js` | IndexedDB — the pairing keypair and room id, nothing else. |
| `js/mesh.js` | Dial the relay, seal/open frames, reconnect with backoff. |
| `js/app.js` | The UI: renders the core's typed event stream, approval cards, file reassembly. |
| `sw.js` | App-shell cache so it opens offline. Never caches a mesh frame. |

## Run locally

Any static server:

```bash
cd web
python -m http.server 5173
# open http://localhost:5173
```

WebCrypto's X25519 needs a secure context — `localhost` counts, as does the
`https://` GitHub Pages origin.

## Pairing

1. On the PC: Dex → Settings → Mesh → **Pair a phone**. It shows `v1.<key>.<salt>`
   and a QR (the QR also carries the relay URL).
2. On the phone: enter the relay URL and the code, press **Pair**. The phone
   generates its own keypair in the browser, derives the shared key, and sends
   its public key inside the first sealed frame — which is also the proof it
   holds the matching private key. The PC adds it to `meshPairedDevices`.
3. The private key never leaves the browser's IndexedDB. Clearing site data
   un-pairs the device, and nothing else does.

## Deploy

`.github/workflows/deploy-web.yml` uploads this directory to GitHub Pages on
every push to `main` that touches `web/`. Enable Pages for the repo with the
source set to **GitHub Actions**.
