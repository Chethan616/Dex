/**
 * Chrome's extension package, CRX3: read it, check it, unpack it.
 *
 * A .crx is a zip with a signed header in front:
 *   "Cr24" · version (3) · header size · CrxFileHeader (protobuf) · zip
 * The header holds one or more key proofs (public key + signature) and the
 * signed data, which names the extension's id. Each signature covers
 * "CRX3 SignedData\0", the signed data's length and bytes, and the whole zip,
 * so changing one byte of the extension breaks every proof.
 *
 * DEX checks what Chrome checks before installing:
 * - every proof's signature is valid;
 * - one proof's key hashes to the declared id (the developer's key), and
 *   that id is the one we asked the store for;
 * - for a store install, the Chrome Web Store's own publisher key signed it
 *   too, so the package really came through the store's review.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';

/** SHA-256 of the Chrome Web Store's CRX3 publisher key (Chromium's crx_verifier). */
const WEB_STORE_PUBLISHER_KEY_HASH = '61f7f2a6bfcf74cd0bc1fe2497cc9b04254c658f79f2145392867ea8366367cf';

/** Bigger than any real extension; a cap on what a download may fill the disk with. */
export const MAX_CRX_BYTES = 256 * 1024 * 1024;

export interface KeyProof { publicKey: Buffer; signature: Buffer; algorithm: 'rsa' | 'ecdsa' }

export interface Crx {
  id: string;
  /** The developer's key, base64 — goes into the manifest so Electron derives the same id. */
  publicKey: string;
  proofs: KeyProof[];
  signedHeaderData: Buffer;
  zip: Buffer;
}

/** An extension id from a DER public key: SHA-256's first 16 bytes, hex digits 0-f written a-p. */
export function idFromPublicKey(der: Buffer): string {
  const hex = crypto.createHash('sha256').update(der).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16))).join('');
}

export function isExtensionId(id: string): boolean {
  return /^[a-p]{32}$/.test(id);
}

// --- A protobuf reader just big enough for the CRX header -------------------

interface Field { tag: number; wire: number; value: Buffer | number }

function readVarint(buf: Buffer, pos: { at: number }): number {
  let result = 0;
  let shift = 0;
  for (;;) {
    if (pos.at >= buf.length) throw new Error('Truncated CRX header');
    const byte = buf[pos.at++];
    result += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return result;
    shift += 7;
    if (shift > 49) throw new Error('Bad CRX header varint');
  }
}

function readFields(buf: Buffer): Field[] {
  const fields: Field[] = [];
  const pos = { at: 0 };
  while (pos.at < buf.length) {
    const key = readVarint(buf, pos);
    const tag = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) fields.push({ tag, wire, value: readVarint(buf, pos) });
    else if (wire === 2) {
      const len = readVarint(buf, pos);
      if (pos.at + len > buf.length) throw new Error('Truncated CRX header');
      fields.push({ tag, wire, value: buf.subarray(pos.at, pos.at + len) });
      pos.at += len;
    } else if (wire === 1) pos.at += 8;
    else if (wire === 5) pos.at += 4;
    else throw new Error(`Unsupported protobuf wire type ${wire}`);
  }
  return fields;
}

function bytesOf(fields: Field[], tag: number): Buffer[] {
  return fields.filter((f) => f.tag === tag && Buffer.isBuffer(f.value)).map((f) => f.value as Buffer);
}

function readProof(buf: Buffer, algorithm: KeyProof['algorithm']): KeyProof {
  const fields = readFields(buf);
  const [publicKey] = bytesOf(fields, 1);
  const [signature] = bytesOf(fields, 2);
  if (!publicKey || !signature) throw new Error('A CRX key proof is incomplete');
  return { publicKey, signature, algorithm };
}

/** Split a CRX3 into its parts. Throws on anything that isn't a well-formed CRX3. */
export function parseCrx(buffer: Buffer): Crx {
  if (buffer.length < 12 || buffer.toString('latin1', 0, 4) !== 'Cr24') throw new Error("That isn't a Chrome extension package");
  const version = buffer.readUInt32LE(4);
  if (version !== 3) throw new Error(`Unsupported CRX version ${version} (only CRX3 is accepted)`);
  const headerSize = buffer.readUInt32LE(8);
  if (12 + headerSize > buffer.length) throw new Error('Truncated CRX header');
  const header = readFields(buffer.subarray(12, 12 + headerSize));
  const proofs = [
    ...bytesOf(header, 2).map((b) => readProof(b, 'rsa')),
    ...bytesOf(header, 3).map((b) => readProof(b, 'ecdsa')),
  ];
  const [signedHeaderData] = bytesOf(header, 10000);
  if (!signedHeaderData) throw new Error('The CRX has no signed data');
  const [crxId] = bytesOf(readFields(signedHeaderData), 1);
  if (!crxId || crxId.length !== 16) throw new Error('The CRX names no extension id');
  const id = [...crxId.toString('hex')].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
  const developer = proofs.find((p) => idFromPublicKey(p.publicKey) === id);
  if (!developer) throw new Error("No key in the CRX matches its extension id");
  return {
    id,
    publicKey: developer.publicKey.toString('base64'),
    proofs,
    signedHeaderData,
    zip: buffer.subarray(12 + headerSize),
  };
}

/** The bytes every proof signs. */
function signedPayload(crx: Crx): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(crx.signedHeaderData.length, 0);
  return Buffer.concat([Buffer.from('CRX3 SignedData\x00', 'latin1'), len, crx.signedHeaderData, crx.zip]);
}

/**
 * Throws unless every signature checks out, the id is `expectedId`, and —
 * for store packages — the Web Store signed it.
 */
export function verifyCrx(crx: Crx, opts: { expectedId?: string; requireWebStore: boolean }): void {
  if (opts.expectedId && crx.id !== opts.expectedId) {
    throw new Error(`The package is for a different extension (${crx.id}, not ${opts.expectedId})`);
  }
  const payload = signedPayload(crx);
  for (const proof of crx.proofs) {
    let ok: boolean;
    try {
      const key = crypto.createPublicKey({ key: proof.publicKey, format: 'der', type: 'spki' });
      ok = crypto.verify('sha256', payload, key, proof.signature);
    } catch {
      ok = false;
    }
    if (!ok) throw new Error('The extension package has a bad signature');
  }
  if (opts.requireWebStore) {
    const fromStore = crx.proofs.some((p) => crypto.createHash('sha256').update(p.publicKey).digest('hex') === WEB_STORE_PUBLISHER_KEY_HASH);
    if (!fromStore) throw new Error("The package wasn't signed by the Chrome Web Store");
  }
}

/** A zip entry's path if it stays inside the folder, else null (zip-slip). */
export function safeEntryPath(root: string, name: string): string | null {
  if (!name || name.includes('\0') || path.isAbsolute(name) || /^[a-zA-Z]:/.test(name)) return null;
  const parts = name.split(/[\\/]+/);
  if (parts.some((p) => p === '..')) return null;
  const target = path.resolve(root, ...parts);
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}

/**
 * Unpack the zip into `dest` (which must not exist yet) and stamp the
 * manifest with the developer key. Returns the manifest.
 */
export function unpackCrx(crx: Crx, dest: string): Record<string, unknown> {
  const files = unzipSync(new Uint8Array(crx.zip.buffer, crx.zip.byteOffset, crx.zip.byteLength));
  fs.mkdirSync(dest, { recursive: true });
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/')) continue;
    const target = safeEntryPath(dest, name);
    if (!target) throw new Error(`The package has an unsafe file path: ${name}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
  const manifestPath = path.join(dest, 'manifest.json');
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>;
  } catch {
    throw new Error('The package has no readable manifest.json');
  }
  // Electron derives an unpacked extension's id from `key` when there is one
  // (from its folder otherwise): the store id keeps its storage and messaging.
  manifest.key = crx.publicKey;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}
