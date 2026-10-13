/** A real, signed CRX3 built in the test, for the installer's tests. */
import crypto from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { idFromPublicKey } from '../../../src/main/extensions/crx';

function varint(n: number): Buffer {
  const out: number[] = [];
  let v = n;
  while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
  out.push(v);
  return Buffer.from(out);
}

function field(tag: number, bytes: Buffer): Buffer {
  return Buffer.concat([varint(tag * 8 + 2), varint(bytes.length), bytes]);
}

export interface Built { crx: Buffer; id: string; publicKey: Buffer }

/** Files → a CRX3 signed with a fresh RSA key (and optionally a second "store" key). */
export function buildCrx(files: Record<string, string>, opts: { extraKey?: crypto.KeyObject; key?: crypto.KeyObject } = {}): Built {
  const privateKey = opts.key ?? crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const publicKey = crypto.createPublicKey(privateKey);
  const der = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const id = idFromPublicKey(der);
  const crxId = Buffer.from([...id].map((c) => (c.charCodeAt(0) - 97).toString(16)).join(''), 'hex');
  const signedHeaderData = field(1, crxId);
  const zip = Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));
  const len = Buffer.alloc(4);
  len.writeUInt32LE(signedHeaderData.length, 0);
  const payload = Buffer.concat([Buffer.from('CRX3 SignedData\x00', 'latin1'), len, signedHeaderData, zip]);
  const proofs = [field(2, Buffer.concat([field(1, der), field(2, crypto.sign('sha256', payload, privateKey))]))];
  if (opts.extraKey) {
    const pub = crypto.createPublicKey(opts.extraKey).export({ type: 'spki', format: 'der' }) as Buffer;
    proofs.push(field(2, Buffer.concat([field(1, pub), field(2, crypto.sign('sha256', payload, opts.extraKey))])));
  }
  const header = Buffer.concat([...proofs, Buffer.concat([varint(10000 * 8 + 2), varint(signedHeaderData.length), signedHeaderData])]);
  const head = Buffer.alloc(12);
  head.write('Cr24', 0, 'latin1');
  head.writeUInt32LE(3, 4);
  head.writeUInt32LE(header.length, 8);
  return { crx: Buffer.concat([head, header, zip]), id, publicKey: der };
}
