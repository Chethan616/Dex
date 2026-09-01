/**
 * The mesh wire protocol — the single source of truth for what crosses the
 * relay, shared by the PC (`mesh_channel.ts`) and mirrored by the web client
 * (`web/js/protocol.js`).
 *
 * Two layers:
 *
 *   1. The **envelope** — what the relay sees. A tiny JSON object with a public
 *      `meshId` for routing and an opaque `box` (base64 ciphertext). The relay
 *      never parses `box`; it cannot, because it holds no key.
 *   2. The **plaintext frames** — what is inside `box` once a paired peer
 *      decrypts it. These are `ClientFrame` (phone → PC) and `HostFrame`
 *      (PC → phone), and their `type` strings are the core's own event names
 *      (see `core/events/types.ts`) so a `DexEvent` forwards without being
 *      translated.
 *
 * If a change here would let the relay learn anything beyond "a byte string of
 * length N is destined for meshId X", the change is wrong — see docs/MESH.md §9.
 */

/** The relay's routing header. Everything else is sealed. */
export interface HelloFrame {
  t: 'hello';
  /** Public room id. Two sockets presenting the same one are paired. */
  meshId: string;
  /** At most one 'host' per room (the PC); any number of 'client's (phones). */
  role: 'host' | 'client';
}

/**
 * A sealed message on the wire. The relay copies these between the two sockets
 * of a room verbatim.
 */
export interface Envelope {
  t: 'box';
  meshId: string;
  /** base64( senderPublicKey(32) || nonce(12) || ciphertext+tag ) */
  box: string;
}

/** Relay → peer, out of band: the other side of the room came or went. */
export interface PresenceFrame {
  t: 'presence';
  /** True when a host is connected for this room. */
  host: boolean;
  /** How many clients are connected. */
  clients: number;
}

export type RelayFrame = HelloFrame | Envelope | PresenceFrame;

// ── plaintext: phone → PC ────────────────────────────────────────────────────

export type ClientFrame =
  /**
   * The first sealed frame of every connection. Carries the phone's public key
   * in the clear at the front of the box (see `sealPairing`/`openPairing`) so
   * the PC can find or create the session for it. On a pairing room this also
   * registers the device; the PC answers with `{ t: 'paired' }`.
   */
  | { t: 'hello' }
  | { t: 'prompt'; id: string; text: string }
  | {
      t: 'approve';
      requestId: string;
      stepId: string;
      /** Echoed back exactly as received — it is a hash of the step shown. */
      stepVersion: string;
      verdict: 'approved' | 'approved_session' | 'rejected';
    }
  | { t: 'handoff'; requestId: string; stepId: string; stepVersion: string; done: boolean }
  | { t: 'cancel'; requestId: string }
  | { t: 'ping' };

// ── plaintext: PC → phone ───────────────────────────────────────────────────

/** Mirrors `EventType` in core/events/types.ts, plus the terminal aliases. */
export type MeshEventType =
  | 'thinking'
  | 'routing'
  | 'planning'
  | 'selecting'
  | 'dispatching'
  | 'executing'
  | 'retrying'
  | 'awaiting'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface MeshConfirmationRequest {
  requestId: string;
  stepId: string;
  stepVersion: string;
  capability: string;
  action: string;
  params: Record<string, unknown>;
  tier: 1 | 2 | 3 | 4;
  description: string;
  createdAt: number;
  expiresAt: number;
}

export type HostFrame =
  | {
      t: 'event';
      requestId: string;
      stepId?: string;
      type: MeshEventType;
      message: string;
      data?: unknown;
    }
  | { t: 'confirmation'; request: MeshConfirmationRequest }
  | { t: 'withdraw'; requestId: string; stepId: string }
  | {
      t: 'result';
      requestId: string;
      status: string;
      summary: string;
      answer?: string;
    }
  | {
      t: 'file';
      /** A file transfer id, so concurrent transfers do not interleave. */
      id: string;
      name: string;
      mime: string;
      size: number;
      chunk: number;
      chunks: number;
      /** base64 of this chunk's bytes. */
      bytes: string;
    }
  | { t: 'paired'; deviceId: string }
  | { t: 'pong' };

/** Bytes per file chunk before base64. One WebSocket frame per chunk. */
export const FILE_CHUNK_BYTES = 48 * 1024;

/** A frame the relay itself understands, versus one it must just forward. */
export function isRelayControlFrame(v: unknown): v is HelloFrame | PresenceFrame {
  return (
    typeof v === 'object' &&
    v !== null &&
    ((v as { t?: unknown }).t === 'hello' || (v as { t?: unknown }).t === 'presence')
  );
}
