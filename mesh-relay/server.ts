import { WebSocketServer, WebSocket, RawData } from 'ws';
import { createServer } from 'node:http';

/**
 * Dex Mesh relay — a switchboard, and nothing more.
 *
 * The whole job (docs/MESH.md §6.2):
 *
 *   1. Accept an outbound WebSocket from anywhere. Both the PC and the phone
 *      dial *in* to here; neither can accept a connection, so this is the only
 *      place they can meet.
 *   2. Read one `hello { meshId, role }` frame to learn which room a socket
 *      belongs to and whether it is the room's single `host` (the PC) or one of
 *      its `client`s (phones).
 *   3. Copy every subsequent frame between the host and the clients of that
 *      room, byte for byte, without parsing it.
 *   4. When the last socket of a room closes, forget the room.
 *
 * What it deliberately does NOT do: store anything, log a payload, keep history,
 * hold a database, or possess any key. Every frame after `hello` is an opaque
 * sealed envelope. If a change to this file would let it learn anything beyond
 * "N bytes for room X", the change is wrong.
 *
 * State: one `Map<meshId, Room>`, in memory, gone on restart. Both ends
 * reconnect and carry on — see §2, "There is no database, and that is a design
 * choice".
 */

const PORT = Number(process.env.PORT ?? 8787);
/** Drop a socket that never sends `hello`. */
const HELLO_TIMEOUT_MS = 10_000;
/** A frame larger than this is not one of ours — refuse it. */
const MAX_FRAME_BYTES = 256 * 1024;
/** Rooms with no traffic and no host for this long are swept. */
const IDLE_ROOM_MS = 10 * 60_000;

type Role = 'host' | 'client';

interface Peer {
  ws: WebSocket;
  role: Role;
  meshId: string;
  since: number;
}

interface Room {
  host?: Peer;
  clients: Set<Peer>;
  lastActivity: number;
}

const rooms = new Map<string, Room>();

function roomOf(meshId: string): Room {
  let room = rooms.get(meshId);
  if (!room) {
    room = { clients: new Set(), lastActivity: Date.now() };
    rooms.set(meshId, room);
  }
  return room;
}

function presenceFor(room: Room): string {
  return JSON.stringify({ t: 'presence', host: !!room.host, clients: room.clients.size });
}

function broadcastPresence(room: Room): void {
  const msg = presenceFor(room);
  if (room.host && room.host.ws.readyState === WebSocket.OPEN) room.host.ws.send(msg);
  for (const c of room.clients) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(msg);
  }
}

/** A tiny health endpoint so a platform's uptime check has something to hit. */
const http = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  res.writeHead(426, { 'content-type': 'text/plain' });
  res.end('Upgrade required — this is a WebSocket relay.\n');
});

const wss = new WebSocketServer({ server: http, maxPayload: MAX_FRAME_BYTES });

wss.on('connection', (ws) => {
  let peer: Peer | null = null;

  const helloTimer = setTimeout(() => {
    if (!peer) ws.close(4000, 'no hello');
  }, HELLO_TIMEOUT_MS);

  ws.on('message', (data: RawData, isBinary) => {
    // ── first frame: hello ────────────────────────────────────────────────
    if (!peer) {
      clearTimeout(helloTimer);
      let hello: { t?: string; meshId?: unknown; role?: unknown };
      try {
        hello = JSON.parse(data.toString());
      } catch {
        ws.close(4001, 'hello not JSON');
        return;
      }
      if (
        hello.t !== 'hello' ||
        typeof hello.meshId !== 'string' ||
        !/^[a-f0-9]{16,64}$/.test(hello.meshId) ||
        (hello.role !== 'host' && hello.role !== 'client')
      ) {
        ws.close(4002, 'bad hello');
        return;
      }

      const room = roomOf(hello.meshId);
      if (hello.role === 'host' && room.host && room.host.ws.readyState === WebSocket.OPEN) {
        // One host per room. A second is either a mistake or an attacker; the
        // incumbent keeps the room.
        ws.close(4003, 'room already has a host');
        return;
      }

      peer = { ws, role: hello.role, meshId: hello.meshId, since: Date.now() };
      if (peer.role === 'host') room.host = peer;
      else room.clients.add(peer);
      room.lastActivity = Date.now();
      broadcastPresence(room);
      return;
    }

    // ── every later frame: copy, do not read ──────────────────────────────
    const room = rooms.get(peer.meshId);
    if (!room) return;
    room.lastActivity = Date.now();

    if (peer.role === 'host') {
      // Host → all clients.
      for (const c of room.clients) {
        if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data, { binary: isBinary });
      }
    } else {
      // Client → host only. Clients never see each other.
      if (room.host && room.host.ws.readyState === WebSocket.OPEN) {
        room.host.ws.send(data, { binary: isBinary });
      }
    }
  });

  ws.on('close', () => {
    clearTimeout(helloTimer);
    if (!peer) return;
    const room = rooms.get(peer.meshId);
    if (!room) return;

    if (peer.role === 'host' && room.host === peer) room.host = undefined;
    else room.clients.delete(peer);

    if (!room.host && room.clients.size === 0) {
      rooms.delete(peer.meshId);
    } else {
      broadcastPresence(room);
    }
  });

  ws.on('error', () => {
    // 'close' follows and does the cleanup. Nothing to do here but not crash.
  });
});

// Sweep rooms that are hostless and silent — a client that dialed a room whose
// PC never showed up should not pin memory forever.
setInterval(() => {
  const now = Date.now();
  for (const [meshId, room] of rooms) {
    if (!room.host && now - room.lastActivity > IDLE_ROOM_MS) {
      for (const c of room.clients) c.ws.close(4004, 'room idle, no host');
      rooms.delete(meshId);
    }
  }
}, 60_000).unref();

http.listen(PORT, () => {
  console.log(`[mesh-relay] listening on :${PORT} — switchboard only, stores nothing`);
});
