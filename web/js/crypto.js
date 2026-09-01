/**
 * Browser mirror of channels/mesh/crypto.ts. Interoperates byte-for-byte:
 * change one and change the other.
 *
 *   key agreement : X25519 (WebCrypto)
 *   KDF           : HKDF-SHA256, salt = 32 zero bytes, info = "dex-mesh/v1 aes-256-gcm"
 *   cipher        : AES-256-GCM
 *
 * Sealed box layout (base64 of):
 *   senderPublicKey(32) | counter(8, BE) | nonce(12) | ciphertext | tag(16)
 * with senderPublicKey||counter bound as GCM additional data.
 *
 * The private key is generated here, kept in IndexedDB, and never sent —
 * pairing sends only the public key, inside the first sealed frame, which
 * doubles as proof this device holds the match.
 */
(function (global) {
  'use strict';

  const HKDF_INFO = new TextEncoder().encode('dex-mesh/v1 aes-256-gcm');
  const ZERO_SALT = new Uint8Array(32);

  // ── base64url ────────────────────────────────────────────────────────────
  function b64urlEncode(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(str) {
    const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function b64Encode(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64Decode(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function concat() {
    let len = 0;
    for (const a of arguments) len += a.length;
    const out = new Uint8Array(len);
    let o = 0;
    for (const a of arguments) { out.set(a, o); o += a.length; }
    return out;
  }

  // ── keypair ──────────────────────────────────────────────────────────────
  async function generateKeyPair() {
    const kp = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
    const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
    return {
      publicKey: b64urlEncode(rawPub),
      // Store the full PKCS8 — WebCrypto will not export X25519 private keys as
      // raw, and re-importing needs the wrapper anyway.
      privateKeyPkcs8: b64urlEncode(pkcs8),
    };
  }

  async function importPrivate(privateKeyPkcs8B64) {
    return crypto.subtle.importKey(
      'pkcs8',
      b64urlDecode(privateKeyPkcs8B64),
      { name: 'X25519' },
      false,
      ['deriveBits'],
    );
  }

  async function importPublicRaw(raw32) {
    return crypto.subtle.importKey('raw', raw32, { name: 'X25519' }, false, []);
  }

  // ── fingerprint / room id ────────────────────────────────────────────────
  async function fingerprint(publicKeyB64) {
    const raw = b64urlDecode(publicKeyB64);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
    let hex = '';
    for (let i = 0; i < 8; i++) hex += hash[i].toString(16).padStart(2, '0');
    return hex.replace(/(.{4})(?=.)/g, '$1-');
  }

  async function sha256Hex(str, take) {
    const data = new TextEncoder().encode(str);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    let hex = '';
    for (let i = 0; i < hash.length; i++) hex += hash[i].toString(16).padStart(2, '0');
    return take ? hex.slice(0, take) : hex;
  }

  /** meshRoomId(fpA, fpB) — order-independent, matches crypto.ts. */
  async function meshRoomId(fpA, fpB) {
    const [x, y] = [fpA, fpB].sort();
    return sha256Hex(x + '|' + y, 24);
  }

  /** Pairing room the PC listens on before it knows our key. Matches pairing.ts. */
  async function pairingRoomId(pcPublicKeyB64, salt) {
    const fp = await fingerprint(pcPublicKeyB64);
    return sha256Hex('pair|' + fp + '|' + salt, 24);
  }

  /** Established room once both keys are known. Matches pairing.ts. */
  async function establishedRoomId(pcPublicKeyB64, myPublicKeyB64) {
    const a = await fingerprint(pcPublicKeyB64);
    const b = await fingerprint(myPublicKeyB64);
    return meshRoomId(a, b);
  }

  // ── HKDF → AES key ───────────────────────────────────────────────────────
  async function deriveAesKey(myPrivateKey, peerPublicRaw) {
    const peerKey = await importPublicRaw(peerPublicRaw);
    const sharedBits = new Uint8Array(
      await crypto.subtle.deriveBits({ name: 'X25519', public: peerKey }, myPrivateKey, 256),
    );
    const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: ZERO_SALT, info: HKDF_INFO },
      hkdfKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  // ── session ──────────────────────────────────────────────────────────────
  function beginSession(myPrivateKey, myPublicKeyB64, peerPublicKeyB64) {
    return {
      myPrivateKey: myPrivateKey,
      myPublicRaw: b64urlDecode(myPublicKeyB64),
      peerPublicRaw: b64urlDecode(peerPublicKeyB64),
      sendCounter: 0,
      recvHighWater: -1,
    };
  }

  function counterBytes(n) {
    const b = new Uint8Array(8);
    const view = new DataView(b.buffer);
    view.setBigUint64(0, BigInt(n), false); // big-endian
    return b;
  }

  /**
   * Steady-state seal — no key on the wire. Layout:
   *   counter(8, BE) | nonce(12) | ciphertext | tag(16)
   * The PC identifies us by which session opens it. Mirrors `seal` in crypto.ts.
   */
  async function seal(session, plaintextObj) {
    const key = await deriveAesKey(session.myPrivateKey, session.peerPublicRaw);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const counter = ++session.sendCounter;
    const cb = counterBytes(counter);
    const pt = new TextEncoder().encode(JSON.stringify(plaintextObj));
    const ctWithTag = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: cb }, key, pt),
    );
    return b64Encode(concat(cb, nonce, ctWithTag));
  }

  async function open(session, boxB64) {
    const buf = b64Decode(boxB64);
    if (buf.length < 8 + 12 + 16) throw new Error('mesh: box too short');
    const cb = buf.subarray(0, 8);
    const nonce = buf.subarray(8, 20);
    const ctWithTag = buf.subarray(20);

    const view = new DataView(cb.buffer, cb.byteOffset, 8);
    const counter = Number(view.getBigUint64(0, false));
    if (counter <= session.recvHighWater) throw new Error('mesh: replayed frame');

    const key = await deriveAesKey(session.myPrivateKey, session.peerPublicRaw);
    const pt = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: cb }, key, ctWithTag),
    );

    session.recvHighWater = counter;
    return {
      frame: JSON.parse(new TextDecoder().decode(pt)),
      senderPublicKey: b64urlEncode(session.peerPublicRaw),
    };
  }

  /**
   * Bootstrap seal — carries our public key in the clear at the front, because
   * the PC does not hold it yet. Sent as the first frame of every connection
   * (pairing or reconnect); the PC reads the key and finds or creates our
   * session. Layout:
   *   senderPublicKey(32) | counter(8, BE) | nonce(12) | ciphertext | tag(16)
   * Mirrors `sealPairing` in crypto.ts.
   */
  async function sealHello(session, plaintextObj) {
    const key = await deriveAesKey(session.myPrivateKey, session.peerPublicRaw);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const counter = ++session.sendCounter;
    const cb = counterBytes(counter);
    const aad = concat(session.myPublicRaw, cb);
    const pt = new TextEncoder().encode(JSON.stringify(plaintextObj));
    const ctWithTag = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad }, key, pt),
    );
    return b64Encode(concat(session.myPublicRaw, cb, nonce, ctWithTag));
  }

  global.MeshCrypto = {
    generateKeyPair: generateKeyPair,
    importPrivate: importPrivate,
    fingerprint: fingerprint,
    meshRoomId: meshRoomId,
    pairingRoomId: pairingRoomId,
    establishedRoomId: establishedRoomId,
    beginSession: beginSession,
    seal: seal,
    sealHello: sealHello,
    open: open,
    b64urlDecode: b64urlDecode,
    b64urlEncode: b64urlEncode,
  };
})(self);
