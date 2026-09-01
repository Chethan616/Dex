/**
 * Cloudflare Workers deployment of the Dex Mesh relay.
 *
 * Durable Objects give the per-room affinity the relay needs: every socket for
 * a given meshId is routed to the same `MeshRoom` instance, which is the only
 * thing that holds the host/client sockets. Same contract as `server.ts` — it
 * pairs two sockets and copies opaque frames, and it stores nothing that
 * outlives the room.
 *
 * Deploy:
 *   wrangler deploy
 * with a wrangler.toml declaring the Durable Object binding:
 *
 *   [[durable_objects.bindings]]
 *   name = "MESH_ROOM"
 *   class_name = "MeshRoom"
 *   [[migrations]]
 *   tag = "v1"
 *   new_classes = ["MeshRoom"]
 */

const MAX_FRAME_BYTES = 256 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Upgrade required — this is a WebSocket relay.\n', { status: 426 });
    }

    // The meshId is not known until the `hello` frame, so every socket lands on
    // a single well-known room object that then re-dispatches by meshId? No —
    // cheaper and still opaque: the client puts the room in the path,
    // /r/<meshId>, which is public routing data exactly like the hello frame.
    const match = url.pathname.match(/^\/r\/([a-f0-9]{16,64})$/);
    if (!match) return new Response('bad room path', { status: 400 });
    const meshId = match[1];

    const id = env.MESH_ROOM.idFromName(meshId);
    const stub = env.MESH_ROOM.get(id);
    return stub.fetch(request);
  },
};

export class MeshRoom {
  constructor(state) {
    this.state = state;
    /** @type {WebSocket | null} */
    this.host = null;
    /** @type {Set<WebSocket>} */
    this.clients = new Set();
  }

  presence() {
    return JSON.stringify({ t: 'presence', host: !!this.host, clients: this.clients.size });
  }

  broadcastPresence() {
    const msg = this.presence();
    if (this.host) try { this.host.send(msg); } catch {}
    for (const c of this.clients) try { c.send(msg); } catch {}
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    let role = null;

    server.addEventListener('message', (event) => {
      const data = event.data;
      if (typeof data === 'string' && data.length > MAX_FRAME_BYTES) {
        server.close(4002, 'frame too large');
        return;
      }

      if (role === null) {
        let hello;
        try {
          hello = JSON.parse(typeof data === 'string' ? data : '');
        } catch {
          server.close(4001, 'hello not JSON');
          return;
        }
        if (hello.t !== 'hello' || (hello.role !== 'host' && hello.role !== 'client')) {
          server.close(4002, 'bad hello');
          return;
        }
        if (hello.role === 'host' && this.host) {
          server.close(4003, 'room already has a host');
          return;
        }
        role = hello.role;
        if (role === 'host') this.host = server;
        else this.clients.add(server);
        this.broadcastPresence();
        return;
      }

      if (role === 'host') {
        for (const c of this.clients) {
          try { c.send(data); } catch {}
        }
      } else if (this.host) {
        try { this.host.send(data); } catch {}
      }
    });

    const cleanup = () => {
      if (role === 'host' && this.host === server) this.host = null;
      else this.clients.delete(server);
      if (!this.host && this.clients.size === 0) return;
      this.broadcastPresence();
    };
    server.addEventListener('close', cleanup);
    server.addEventListener('error', cleanup);

    return new Response(null, { status: 101, webSocket: client });
  }
}
