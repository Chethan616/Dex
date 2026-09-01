import { readConfig, updateConfig } from '../../core/settings/config_store';
import {
  KeyPair,
  b64url,
  fromB64url,
  fingerprint,
  generateKeyPair,
  meshRoomId,
} from './crypto';
import { randomBytes, createHash } from 'node:crypto';

/**
 * Turning "these two devices have never met" into "these two devices share a
 * key and a room id".
 *
 * The flow (docs/MESH.md §6.3):
 *
 *   1. The PC generates its keypair once, on first run, and stores the identity
 *      in settings (`meshDeviceId` = the public fingerprint). The private key
 *      lives in the OS credential store's neighbour — here, for simplicity and
 *      because it never leaves the machine, in the settings file's sibling
 *      `mesh_identity.json`, mode 600. It is not an API key; it is this
 *      machine's door key, and losing it just means re-pairing.
 *   2. The PC shows a **pairing code**: its public key plus a short random
 *      salt, base64url, chunked for reading aloud, and the same string encoded
 *      as a QR by the caller.
 *   3. The phone generates its own keypair in the browser, enters the code,
 *      and sends its public key back *through the freshly derived box* — so the
 *      first sealed frame doubles as proof it holds the matching private key.
 *   4. The PC, on receiving a valid first frame from an unknown key while
 *      pairing is open, adds that fingerprint to `meshPairedDevices`. From then
 *      on it is a normal paired device and the pairing window can close.
 *
 * There is no server in this. The relay only ever sees the room id.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { configDir } from '../../core/settings/config_store';

const IDENTITY_FILE = 'mesh_identity.json';

interface StoredIdentity {
  publicKey: string;
  privateKey: string;
}

function identityPath(): string {
  // Beside settings.json, per the appendix in docs/MESH.md: "%LOCALAPPDATA%\DEX".
  return path.join(configDir(), IDENTITY_FILE);
}

/**
 * This PC's mesh keypair, created once and reused. Also backfills
 * `meshDeviceId` in settings the first time, so the rest of the system has the
 * public fingerprint without needing to read this file.
 */
export function localIdentity(): KeyPair {
  const file = identityPath();
  try {
    if (fs.existsSync(file)) {
      const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as StoredIdentity;
      if (stored.publicKey && stored.privateKey) {
        ensureDeviceId(stored.publicKey);
        return stored;
      }
    }
  } catch {
    // A corrupt identity file is not fatal — regenerate. The only cost is that
    // existing paired phones must pair again, which is a visible, recoverable
    // state, unlike a crash on boot.
  }

  const pair = generateKeyPair();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(pair, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  ensureDeviceId(pair.publicKey);
  return pair;
}

function ensureDeviceId(publicKey: string): void {
  const fp = fingerprint(publicKey);
  if (readConfig().meshDeviceId !== fp) updateConfig({ meshDeviceId: fp });
}

// ── the pairing code ────────────────────────────────────────────────────────

/**
 * A pairing code is `v1.<publicKeyB64url>.<saltB64url>`. The salt is not a
 * secret either; it only makes each code visually distinct and lets the PC
 * recognise the specific pairing attempt it just opened.
 */
export interface PairingOffer {
  code: string;
  /** For a QR: the same code, plus the relay URL so the phone needs nothing else. */
  qrPayload: string;
  /** What the PC watches for: the fingerprint of the code it just issued. */
  salt: string;
  expiresAt: number;
}

const PAIRING_TTL_MS = 5 * 60_000;

export function createPairingOffer(): PairingOffer {
  const { publicKey } = localIdentity();
  const salt = b64url(randomBytes(9));
  const code = `v1.${publicKey}.${salt}`;
  const relay = readConfig().meshRelayUrl;
  return {
    code,
    qrPayload: JSON.stringify({ code, relay }),
    salt,
    expiresAt: Date.now() + PAIRING_TTL_MS,
  };
}

export interface ParsedCode {
  publicKey: string;
  salt: string;
}

/** Parse a code the phone typed/scanned. Throws on anything malformed. */
export function parsePairingCode(code: string): ParsedCode {
  const m = code.trim().match(/^v1\.([A-Za-z0-9_-]{43,})\.([A-Za-z0-9_-]{8,})$/);
  if (!m) throw new Error('mesh: not a valid pairing code');
  // Round-trip the key to reject a truncated or padded copy-paste.
  const publicKey = m[1];
  if (fromB64url(publicKey).length !== 32) throw new Error('mesh: pairing code key is not 32 bytes');
  return { publicKey, salt: m[2] };
}

/**
 * The room id for a pairing in progress: the PC's fingerprint plus the
 * phone's, once the phone's key is known. Before that, during the QR display,
 * the PC listens on a *pairing room* keyed only by its own fingerprint and the
 * salt, which the code carries so the phone can compute the same value.
 */
export function pairingRoomId(pcPublicKey: string, salt: string): string {
  return createHash('sha256')
    .update(`pair|${fingerprint(pcPublicKey)}|${salt}`)
    .digest('hex')
    .slice(0, 24);
}

/** The stable room id for an established pair, from the two public keys. */
export function establishedRoomId(pcPublicKey: string, phonePublicKey: string): string {
  return meshRoomId(fingerprint(pcPublicKey), fingerprint(phonePublicKey));
}

/**
 * The same room id when the PC only holds the phone's *fingerprint* (which is
 * all `meshPairedDevices` stores). `meshRoomId` is defined over fingerprints,
 * so this and `establishedRoomId` land on the same value for a given pair.
 */
export function roomIdForFingerprint(pcPublicKey: string, phoneFingerprint: string): string {
  return meshRoomId(fingerprint(pcPublicKey), phoneFingerprint);
}

// ── accepting a device ──────────────────────────────────────────────────────

/**
 * Record a phone as paired. Idempotent. Persisted via `updateConfig` so it
 * survives a restart and so `mesh_channel.ts` reads it from the same place on
 * the next inbound frame.
 */
export function acceptDevice(phonePublicKey: string): string {
  const fp = fingerprint(phonePublicKey);
  const current = readConfig().meshPairedDevices;
  if (!current.includes(fp)) {
    updateConfig({ meshPairedDevices: [...current, fp] });
  }
  return fp;
}

export function isPaired(publicKeyOrFingerprint: string): boolean {
  const list = readConfig().meshPairedDevices;
  if (list.includes(publicKeyOrFingerprint)) return true;
  try {
    return list.includes(fingerprint(publicKeyOrFingerprint));
  } catch {
    return false;
  }
}

/** Forget a device. Used from settings; the phone then has to pair again. */
export function revokeDevice(fingerprintValue: string): void {
  const current = readConfig().meshPairedDevices;
  updateConfig({ meshPairedDevices: current.filter((f) => f !== fingerprintValue) });
}
