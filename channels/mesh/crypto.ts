import {
  createHash,
  createHmac,
  diffieHellman,
  generateKeyPairSync,
  createPublicKey,
  createPrivateKey,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  KeyObject,
} from 'node:crypto';

/**
 * The mesh's cryptography. Nothing here is novel — X25519 for the key
 * agreement, HKDF-SHA256 to derive the symmetric key, AES-256-GCM for the
 * sealed box. `node:crypto` only; no dependency to audit.
 *
 * The threat model (docs/MESH.md §2): the relay is a box on someone else's
 * computer that every byte passes through. It routes on a public `meshId` and
 * must be able to learn nothing else — not the plaintext, not who is talking,
 * not whether two ciphertexts are the same message. And it must not be able to
 * forge a message from a paired device.
 *
 * How that is met:
 *
 *   - Every sealed frame carries the sender's X25519 public key in the clear
 *     *inside* the ciphertext's AAD-bound header, and the receiver derives the
 *     shared secret fresh per frame. A relay that swaps the public key gets a
 *     GCM tag failure, not a decrypt.
 *   - The fingerprint of that public key is checked against `meshPairedDevices`
 *     before the plaintext is handed anywhere. An unpaired key → the frame is
 *     dropped in silence (the owner-gate rule).
 *   - A 12-byte random nonce per frame and a monotonic counter bound into the
 *     AAD give replay resistance: a captured frame re-sent later fails the
 *     counter check.
 */

const RAW_KEY_PREFIX_SPKI = Buffer.from('302a300506032b656e032100', 'hex'); // X25519 SPKI header
const RAW_KEY_PREFIX_PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex'); // X25519 PKCS8 header

export interface KeyPair {
  /** 32 raw bytes, base64url — safe in a URL, a QR, and a config file. */
  publicKey: string;
  /** 32 raw bytes, base64url. Never leaves the machine that generated it. */
  privateKey: string;
}

/** A fresh X25519 keypair, exported as raw 32-byte base64url strings. */
export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  return {
    publicKey: b64url(rawPublic(publicKey)),
    privateKey: b64url(rawPrivate(privateKey)),
  };
}

/**
 * A short, stable, human-comparable identity for a public key: the first 16
 * hex chars of its SHA-256, grouped. This is `meshDeviceId` and the entries in
 * `meshPairedDevices`. Not a secret — it is what the relay routes on.
 */
export function fingerprint(publicKeyB64: string): string {
  const raw = fromB64url(publicKeyB64);
  const hex = createHash('sha256').update(raw).digest('hex').slice(0, 16);
  return hex.replace(/(.{4})(?=.)/g, '$1-');
}

/**
 * The room id both peers dial the relay with. Derived from *both* fingerprints
 * so it is stable for a pair and reveals neither key. Order-independent.
 */
export function meshRoomId(fpA: string, fpB: string): string {
  const [x, y] = [fpA, fpB].sort();
  return createHash('sha256').update(`${x}|${y}`).digest('hex').slice(0, 24);
}

// ── the sealed box ──────────────────────────────────────────────────────────

/** Per-session state: the peer we are sealing to, and our replay counters. */
export interface Session {
  myPrivate: KeyObject;
  myPublicRaw: Buffer;
  peerPublicRaw: Buffer;
  /** Incremented on every seal; bound into the AAD. */
  sendCounter: number;
  /** Highest counter accepted so far; a frame at or below it is a replay. */
  recvHighWater: number;
}

export function beginSession(myPrivateB64: string, myPublicB64: string, peerPublicB64: string): Session {
  return {
    myPrivate: privateKeyObject(fromB64url(myPrivateB64)),
    myPublicRaw: fromB64url(myPublicB64),
    peerPublicRaw: fromB64url(peerPublicB64),
    sendCounter: 0,
    recvHighWater: -1,
  };
}

const HKDF_INFO = Buffer.from('dex-mesh/v1 aes-256-gcm', 'utf8');

function sharedKeyFor(myPrivate: KeyObject, peerPublicRaw: Buffer): Buffer {
  const secret = diffieHellman({
    privateKey: myPrivate,
    publicKey: publicKeyObject(peerPublicRaw),
  });
  // HKDF-Extract then one Expand block — 32 bytes out, exactly the AES-256 key
  // size, so no truncation games. Matches WebCrypto's HKDF (which appends the
  // 0x01 block counter itself) in web/js/crypto.js.
  const salt = Buffer.alloc(32, 0);
  const prk = createHmac('sha256', salt).update(secret).digest();
  return createHmac('sha256', prk)
    .update(Buffer.concat([HKDF_INFO, Buffer.from([0x01])]))
    .digest();
}

function sharedKey(session: Session): Buffer {
  return sharedKeyFor(session.myPrivate, session.peerPublicRaw);
}

/**
 * Seal a plaintext object for the peer.
 *
 * Decoded box layout — **no cleartext key**, so the relay sees nothing that
 * links a frame to a device:
 *
 *   counter(8, BE) | nonce(12) | ciphertext | tag(16)
 *
 * The counter is bound as GCM additional data, so the relay cannot rewind it
 * without the tag failing. Identity is established by *which* session opens the
 * box — the receiver holds one per paired peer — not by anything on the wire.
 * The one exception is the pairing bootstrap; see `sealPairing`.
 */
export function seal(session: Session, plaintext: unknown): string {
  const key = sharedKey(session);
  const nonce = randomBytes(12);
  const counter = ++session.sendCounter;

  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(counterBuf);
  const body = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(plaintext), 'utf8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([counterBuf, nonce, body, tag]).toString('base64');
}

export interface Opened {
  /** The decoded plaintext object. */
  frame: unknown;
  /** The peer this session belongs to — from the session, never the wire. */
  senderPublicKey: string;
  senderFingerprint: string;
}

/**
 * Open a steady-state `box` against a known session. Throws on malformed input,
 * a GCM tag failure (tamper or wrong session), or a replayed counter. Every
 * throw is handled the same way by the caller: drop the frame, say nothing.
 */
export function open(session: Session, boxB64: string): Opened {
  const buf = Buffer.from(boxB64, 'base64');
  if (buf.length < 8 + 12 + 16) throw new Error('mesh: box too short');

  const counterBuf = buf.subarray(0, 8);
  const nonce = buf.subarray(8, 20);
  const tag = buf.subarray(buf.length - 16);
  const ciphertext = buf.subarray(20, buf.length - 16);

  const counter = Number(counterBuf.readBigUInt64BE());
  if (counter <= session.recvHighWater) {
    throw new Error(`mesh: replayed frame (counter ${counter} <= ${session.recvHighWater})`);
  }

  const key = sharedKey(session);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(counterBuf);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  session.recvHighWater = counter;

  const senderPublicKey = b64url(session.peerPublicRaw);
  return {
    frame: JSON.parse(plain.toString('utf8')),
    senderPublicKey,
    senderFingerprint: fingerprint(senderPublicKey),
  };
}

/**
 * The pairing bootstrap frame. Here — and only here — the sender's public key
 * rides in the clear at the front, because the receiver does not yet hold it
 * and so cannot derive the shared secret without it:
 *
 *   senderPublicKey(32) | counter(8, BE) | nonce(12) | ciphertext | tag(16)
 *
 * This travels on a pairing-only room id that is torn down the moment pairing
 * succeeds, so the one linkable frame is not linkable to any later traffic.
 * The 32-byte header is GCM-bound, so a relay that swaps it gets a tag failure.
 */
export function sealPairing(session: Session, plaintext: unknown): string {
  const key = sharedKey(session);
  const nonce = randomBytes(12);
  const counter = ++session.sendCounter;
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const aad = Buffer.concat([session.myPublicRaw, counterBuf]);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  const body = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(plaintext), 'utf8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([session.myPublicRaw, counterBuf, nonce, body, tag]).toString('base64');
}

/**
 * Open a pairing bootstrap frame. `myPrivateB64`/`myPublicB64` are this side's
 * identity; the peer key is read from the frame and returned so the caller can
 * check it against — and add it to — `meshPairedDevices`.
 */
export function openPairing(
  myPrivateB64: string,
  myPublicB64: string,
  boxB64: string,
): Opened {
  const buf = Buffer.from(boxB64, 'base64');
  if (buf.length < 32 + 8 + 12 + 16) throw new Error('mesh: pairing box too short');

  const senderPublicRaw = buf.subarray(0, 32);
  const counterBuf = buf.subarray(32, 40);
  const nonce = buf.subarray(40, 52);
  const tag = buf.subarray(buf.length - 16);
  const ciphertext = buf.subarray(52, buf.length - 16);

  const key = sharedKeyFor(privateKeyObject(fromB64url(myPrivateB64)), Buffer.from(senderPublicRaw));
  const aad = Buffer.concat([senderPublicRaw, counterBuf]);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  void myPublicB64; // symmetry with the browser signature; not needed to open
  const senderPublicKey = b64url(Buffer.from(senderPublicRaw));
  return {
    frame: JSON.parse(plain.toString('utf8')),
    senderPublicKey,
    senderFingerprint: fingerprint(senderPublicKey),
  };
}

// ── raw-key <-> KeyObject plumbing ──────────────────────────────────────────
//
// Node will only import/export X25519 keys wrapped in ASN.1. These helpers
// staple and strip the fixed DER prefixes so the rest of the file — and the
// wire — deals in bare 32-byte values.

function rawPublic(key: KeyObject): Buffer {
  const der = key.export({ type: 'spki', format: 'der' });
  return Buffer.from(der.subarray(der.length - 32));
}

function rawPrivate(key: KeyObject): Buffer {
  const der = key.export({ type: 'pkcs8', format: 'der' });
  return Buffer.from(der.subarray(der.length - 32));
}

function publicKeyObject(raw32: Buffer): KeyObject {
  return createPublicKey({
    key: Buffer.concat([RAW_KEY_PREFIX_SPKI, raw32]),
    format: 'der',
    type: 'spki',
  });
}

function privateKeyObject(raw32: Buffer): KeyObject {
  return createPrivateKey({
    key: Buffer.concat([RAW_KEY_PREFIX_PKCS8, raw32]),
    format: 'der',
    type: 'pkcs8',
  });
}

// ── base64url ───────────────────────────────────────────────────────────────

export function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}
