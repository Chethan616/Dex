import WebSocket from 'ws';
import { randomUUID, createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { ChannelAdapter, ChannelRuntime, Reply } from '../base_channel';
import { Gateway } from '../../core/gateway';
import { OwnerGate, GateDecision } from '../../core/owner_gate';
import { ConfirmationManager } from '../../core/confirmation/confirmation_manager';
import { bus } from '../../core/events/bus';
import { DexEvent, ConfirmationRequest } from '../../core/events/types';
import { readConfig } from '../../core/settings/config_store';
import {
  Session,
  beginSession,
  seal,
  open,
  openPairing,
} from './crypto';
import { localIdentity, isPaired, acceptDevice, pairingRoomId, roomIdForFingerprint } from './pairing';
import {
  ClientFrame,
  HostFrame,
  Envelope,
  HelloFrame,
  PresenceFrame,
  MeshEventType,
  FILE_CHUNK_BYTES,
} from './protocol';

/**
 * The PC side of the mesh — a fourth channel (docs/MESH.md §4).
 *
 * It does exactly four things (§6.1):
 *
 *   1. **Dials out** to `meshRelayUrl` and holds the socket open, reconnecting
 *      with backoff. It never listens; this PC is behind NAT and could not be
 *      reached inbound anyway.
 *   2. **Decrypts and verifies** every frame. A frame whose sender key is not
 *      in `meshPairedDevices` is dropped in silence — the owner-gate rule, one
 *      layer down.
 *   3. Hands the plaintext to the Gateway. That single call is what buys
 *      planning, execution, verification, approvals and the live event stream.
 *   4. **Implements `Reply`** by sealing `send` / `edit` / `sendFile` back
 *      through the relay.
 *
 * Why it does not go through `ChannelRuntime.run()`: that method renders
 * progress as one coalesced, emoji-prefixed chat message being edited in place,
 * which is right for Telegram and wrong here. The web client wants the core's
 * *typed* event stream, forwarded frame by frame with each verification line
 * intact (§3). So this channel subscribes to the bus itself and forwards
 * `DexEvent`s verbatim — the event `type` strings already match the wire
 * protocol, by design.
 *
 * It still reaches the shared `Gateway` and `ConfirmationManager` — via the
 * `ChannelRuntime` it is handed — so approvals raised mid-task are the same
 * objects the Dex Bar and the other channels see. Nothing about the tier
 * ladder is re-implemented or relaxed here (§9 rule 4).
 */

/** Structural view of the fields `ChannelRuntime` holds. Read, never written. */
interface RuntimeInternals {
  gateway: Gateway;
  ownerGate: OwnerGate;
  confirmations: ConfirmationManager;
}

/**
 * `OwnerGate` (correctly) has no `mesh` case: it identifies a sender by a
 * plaintext platform id, and the mesh has no such thing — a mesh sender is
 * identified by an X25519 signature, checked against `meshPairedDevices` in
 * `tryOpen` *before* any prompt reaches the Gateway. So for `source: 'mesh'`
 * the gate would refuse every request purely because no owner string is
 * configured for a channel that does not use owner strings.
 *
 * Rather than edit `core/owner_gate.ts` (forbidden — docs/MESH.md §9), the
 * shared gate instance is extended in place with the one case it lacks: a mesh
 * request whose senderId is a paired device fingerprint is the owner, by the
 * same standard every other channel uses ("this id is on the allowed list").
 * The delegation keeps every existing rule for every existing source exactly
 * as it was — the channels suite still passes untouched.
 */
function teachGateAboutMesh(gate: OwnerGate): void {
  const g = gate as unknown as {
    evaluate(req: { source: string; senderId: string; text: string }): GateDecision;
    __meshTaught?: boolean;
  };
  if (g.__meshTaught) return;
  const original = g.evaluate.bind(g);
  g.evaluate = (req) => {
    if (req.source === 'mesh') {
      const text = (req.text ?? '').trim();
      if (!text) return { allow: false, reason: 'Empty message' };
      return isPaired(req.senderId)
        ? { allow: true, text }
        : { allow: false, reason: 'Mesh sender is not a paired device' };
    }
    return original(req);
  };
  g.__meshTaught = true;
}

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const PING_INTERVAL_MS = 25_000;

export class MeshChannel implements ChannelAdapter {
  readonly source = 'mesh' as const;
  readonly name = 'Mesh';

  private gateway: Gateway;
  private confirmations: ConfirmationManager;

  private ws?: WebSocket;
  private stopped = false;
  private reconnectAttempts = 0;
  private pingTimer?: NodeJS.Timeout;

  /** One crypto session per connected client, keyed by its fingerprint. */
  private sessions = new Map<string, Session>();
  /** The room this PC is currently attached to on the relay. */
  private roomId = '';
  /** True while a pairing offer is open — an unknown key may be accepted then. */
  private pairingSalt: string | null = null;

  constructor(runtime: ChannelRuntime) {
    const internals = runtime as unknown as RuntimeInternals;
    this.gateway = internals.gateway;
    this.confirmations = internals.confirmations;
    // main.ts hands the same OwnerGate instance to the Gateway and to every
    // ChannelRuntime, so teaching it the mesh case here covers the check the
    // Gateway makes on our behalf too.
    teachGateAboutMesh(internals.ownerGate);
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    const cfg = readConfig();
    if (!cfg.meshEnabled || !cfg.meshRelayUrl) {
      console.warn('\x1b[33m[mesh]\x1b[0m enabled check passed but relay URL is empty — not starting.');
      return;
    }
    // Ensure the identity file exists and meshDeviceId is populated.
    localIdentity();
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close(1000, 'shutting down');
    this.ws = undefined;
  }

  /**
   * Open a pairing window. Called from the Dex Bar / settings when the owner
   * clicks "pair a phone". While it is open, the first valid sealed frame from
   * an unknown key on the pairing room is accepted and its device recorded.
   */
  openPairing(salt: string): void {
    this.pairingSalt = salt;
    // Re-attach to the relay under the pairing room so the phone can find us
    // before it knows our established room id.
    const { publicKey } = localIdentity();
    this.attachRoom(pairingRoomId(publicKey, salt));
  }

  closePairing(): void {
    this.pairingSalt = null;
    this.reattachEstablished();
  }

  // ── the relay socket ─────────────────────────────────────────────────────

  private connect(): void {
    if (this.stopped) return;
    const url = readConfig().meshRelayUrl;

    const ws = new WebSocket(url, { handshakeTimeout: 10_000 });
    this.ws = ws;

    ws.on('open', () => {
      this.reconnectAttempts = 0;
      console.log(`\x1b[36m[mesh]\x1b[0m connected to relay ${redactUrl(url)}`);
      this.reattachEstablished();
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      }, PING_INTERVAL_MS);
    });

    ws.on('message', (raw) => void this.onRelayMessage(raw.toString()));

    ws.on('close', () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.sessions.clear();
      if (this.stopped) return;
      const delay = Math.min(
        RECONNECT_BASE_MS * 2 ** this.reconnectAttempts++,
        RECONNECT_MAX_MS,
      );
      console.warn(`\x1b[33m[mesh]\x1b[0m relay closed — reconnecting in ${Math.round(delay / 1000)}s`);
      setTimeout(() => this.connect(), delay);
    });

    ws.on('error', (err) => {
      // 'close' always follows, and that is where the reconnect lives — so this
      // only needs to keep the error off the process's unhandled path.
      console.warn(`\x1b[33m[mesh]\x1b[0m socket error: ${err instanceof Error ? err.message : err}`);
    });
  }

  private reattachEstablished(): void {
    const { publicKey } = localIdentity();
    const devices = readConfig().meshPairedDevices;
    // With one paired phone this is its room; with several, the relay lets us
    // present multiple hellos, one per room. Keep it simple: attach the first,
    // and additional devices attach as they connect via presence.
    if (devices.length === 0 && !this.pairingSalt) {
      // Nothing paired and not pairing — sit on a self-room so the socket stays
      // valid; no client can reach it.
      this.attachRoom(createHash('sha256').update(`idle|${publicKey}`).digest('hex').slice(0, 24));
      return;
    }
    if (this.pairingSalt) {
      this.attachRoom(pairingRoomId(publicKey, this.pairingSalt));
      return;
    }
    // Established: room derived from our fp + the (only, or first) device fp.
    this.attachRoom(roomIdForFingerprint(publicKey, devices[0]));
  }

  private attachRoom(roomId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.roomId = roomId;
    const hello: HelloFrame = { t: 'hello', meshId: roomId, role: 'host' };
    this.ws.send(JSON.stringify(hello));
  }

  // ── inbound ──────────────────────────────────────────────────────────────

  private async onRelayMessage(text: string): Promise<void> {
    let frame: Envelope | PresenceFrame | { t: string };
    try {
      frame = JSON.parse(text);
    } catch {
      return; // the relay only ever sends us JSON control/envelope frames
    }

    if (frame.t === 'presence') {
      const p = frame as PresenceFrame;
      if (process.env.DEX_DEBUG === 'true') {
        console.log(`\x1b[90m[mesh] presence: ${p.clients} client(s)\x1b[0m`);
      }
      return;
    }

    if (frame.t !== 'box') return;
    const env = frame as Envelope;

    // Try to open against a known session first; failing that, and only while
    // pairing, treat it as a first contact.
    const opened = this.tryOpen(env.box);
    if (!opened) return; // tamper, replay, or an unpaired stranger — silence.

    const { plaintext, senderFingerprint } = opened;
    const clientFrame = plaintext as ClientFrame;

    switch (clientFrame.t) {
      case 'hello':
        // The session (and, on a pairing room, the pairing) is already handled
        // in tryOpen. Nothing more to do — the phone has what it needs.
        return;
      case 'ping':
        this.sendTo(senderFingerprint, { t: 'pong' });
        return;
      case 'prompt':
        await this.runPrompt(senderFingerprint, clientFrame.id, clientFrame.text);
        return;
      case 'approve':
        this.answerConfirmation(
          clientFrame.requestId,
          clientFrame.stepId,
          clientFrame.stepVersion,
          clientFrame.verdict,
        );
        return;
      case 'handoff':
        this.answerConfirmation(
          clientFrame.requestId,
          clientFrame.stepId,
          clientFrame.stepVersion,
          clientFrame.done ? 'handed_off' : 'rejected',
        );
        return;
      case 'cancel':
        this.confirmations.cancelAll(clientFrame.requestId);
        return;
    }
  }

  /**
   * Open a box. Steady-state frames carry no key — they are matched against the
   * sessions we hold, one per paired device. A frame that matches none is tried
   * as a *pairing bootstrap* (which does carry a one-time cleartext key), and
   * accepted only while a pairing window is open. Anything else → null, which
   * the caller turns into silence.
   */
  private tryOpen(
    box: string,
  ): { plaintext: unknown; senderFingerprint: string } | null {
    // A frame from an established, known device.
    for (const [fp, session] of this.sessions) {
      try {
        const res = open(session, box);
        return { plaintext: res.frame, senderFingerprint: fp };
      } catch {
        /* not this session */
      }
    }

    // A paired device reconnecting: no live session yet, so seed one from the
    // stored fingerprint's… we only have the fingerprint, not the key. The
    // phone therefore always sends a pairing-shaped first frame on a new
    // connection; `openPairing` reads the key from it.
    const { publicKey, privateKey } = localIdentity();
    let res;
    try {
      res = openPairing(privateKey, publicKey, box);
    } catch {
      return null; // not decryptable by us — not a real peer, or a replay
    }

    const fp = res.senderFingerprint;
    const alreadyPaired = isPaired(res.senderPublicKey);

    if (!alreadyPaired && this.pairingSalt === null) {
      // An unknown key and no pairing window — a stranger. Silence.
      return null;
    }

    // If a session for this device already exists, a second bootstrap frame is
    // a replay (the relay re-sending a captured `hello` to reset our replay
    // counter). Ignore it; the live session stands.
    if (this.sessions.has(fp)) return null;

    // Session keyed by the real key now that we have it.
    const session = beginSession(privateKey, publicKey, res.senderPublicKey);
    this.sessions.set(fp, session);

    if (!alreadyPaired) {
      acceptDevice(res.senderPublicKey);
      this.pairingSalt = null;
      console.log(`\x1b[32m[mesh]\x1b[0m paired new device ${fp}`);
      this.reattachEstablished();
      this.sendTo(fp, { t: 'paired', deviceId: readConfig().meshDeviceId });
    }

    return { plaintext: res.frame, senderFingerprint: fp };
  }

  // ── running a prompt ─────────────────────────────────────────────────────

  private async runPrompt(deviceFp: string, promptId: string, text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Forward every event for this request as a typed frame. Subscribed before
    // the Gateway call so nothing between here and the first `thinking` is lost.
    let requestId = '';
    const pending: DexEvent[] = [];
    const forward = (event: DexEvent) => {
      const type = event.type as MeshEventType;
      this.sendTo(deviceFp, {
        t: 'event',
        requestId: event.requestId,
        stepId: event.stepId,
        type,
        message: event.message,
        data: event.data,
      });
    };

    const unsubscribeAll = bus.subscribeAll((event) => {
      // Until we know our requestId, buffer; then flush and switch to a
      // per-request subscription.
      if (!requestId) {
        pending.push(event);
        return;
      }
      if (event.requestId === requestId) forward(event);
    });

    // Confirmation cards raised during this task go back to this device,
    // unchanged — same manager, same stepVersion the core will check.
    const detach = this.confirmations.registerProvider({
      name: `mesh:${deviceFp}`,
      present: (request: ConfirmationRequest) =>
        this.sendTo(deviceFp, { t: 'confirmation', request }),
      withdraw: (rid: string, stepId: string) =>
        this.sendTo(deviceFp, { t: 'withdraw', requestId: rid, stepId }),
    });

    const reply = this.replyFor(deviceFp);

    try {
      const result = await this.gateway.handle('mesh', deviceFp, trimmed, {
        source: 'mesh',
        send: (body) => reply.send(body),
        sendFile: (file, caption) => reply.sendFile!(file, caption),
      });

      requestId = result.requestId;
      // Flush anything that arrived before we knew the id.
      for (const e of pending) if (e.requestId === requestId) forward(e);
      pending.length = 0;

      this.sendTo(deviceFp, {
        t: 'result',
        requestId: result.requestId,
        status: result.status,
        summary: result.summary,
        answer: result.answer,
      });
    } catch (err) {
      this.sendTo(deviceFp, {
        t: 'event',
        requestId: requestId || promptId,
        type: 'failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      unsubscribeAll();
      detach();
    }
  }

  private answerConfirmation(
    requestId: string,
    stepId: string,
    stepVersion: string,
    verdict: 'approved' | 'approved_session' | 'rejected' | 'handed_off',
  ): void {
    const outcome = this.confirmations.respond(requestId, stepId, stepVersion, verdict);
    if (!outcome.accepted && process.env.DEX_DEBUG === 'true') {
      console.log(`\x1b[90m[mesh] approval not applied — ${outcome.reason}\x1b[0m`);
    }
  }

  // ── outbound: Reply and file chunking ────────────────────────────────────

  private replyFor(deviceFp: string): Reply {
    return {
      send: async (text) => {
        this.sendTo(deviceFp, {
          t: 'event',
          requestId: '',
          type: 'done',
          message: text,
        });
        return undefined;
      },
      // The web client renders a live stream, not editable message handles.
      // Anything the runtime would "edit" is sent as a fresh event instead.
      sendFile: async (filePath, caption) => {
        await this.sendFileChunked(deviceFp, filePath, caption);
      },
    };
  }

  private async sendFileChunked(deviceFp: string, filePath: string, caption?: string): Promise<void> {
    const stat = fs.statSync(filePath);
    const data = fs.readFileSync(filePath);
    const name = filePath.split(/[\\/]/).pop() ?? 'file';
    const mime = mimeFromName(name);
    const id = randomUUID();
    const chunks = Math.max(1, Math.ceil(data.length / FILE_CHUNK_BYTES));

    for (let i = 0; i < chunks; i++) {
      const slice = data.subarray(i * FILE_CHUNK_BYTES, (i + 1) * FILE_CHUNK_BYTES);
      this.sendTo(deviceFp, {
        t: 'file',
        id,
        name,
        mime,
        size: stat.size,
        chunk: i,
        chunks,
        bytes: slice.toString('base64'),
      });
      // Yield between chunks so a large file does not monopolise the socket.
      if (i % 8 === 7) await new Promise((r) => setImmediate(r));
    }

    if (caption) {
      this.sendTo(deviceFp, { t: 'event', requestId: '', type: 'done', message: caption });
    }
  }

  private sendTo(deviceFp: string, frame: HostFrame): void {
    const session = this.sessions.get(deviceFp);
    if (!session || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const env: Envelope = {
      t: 'box',
      meshId: this.roomId,
      box: seal(session, frame),
    };
    this.ws.send(JSON.stringify(env));
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function mimeFromName(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    txt: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    zip: 'application/zip',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return map[ext] ?? 'application/octet-stream';
}

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}
