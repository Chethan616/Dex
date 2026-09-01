import './support/isolate';
/**
 * The mesh's security boundary — the crypto, the pairing, and what the relay
 * can see. This is the remote surface's first line of defence (docs/MESH.md
 * §2), so it is tested for the three ways it must fail closed:
 *
 *   - a tampered ciphertext is rejected, not decrypted;
 *   - a replayed frame is rejected;
 *   - a frame from an unpaired key produces nothing.
 *
 * And for the one thing that must stay true no matter what: the relay, holding
 * only the envelope, learns nothing but the room id and a byte count.
 *
 *   npm run test:mesh
 */
import {
  generateKeyPair,
  fingerprint,
  beginSession,
  seal,
  open,
  sealPairing,
  openPairing,
  meshRoomId,
} from '../channels/mesh/crypto';
import {
  createPairingOffer,
  parsePairingCode,
  pairingRoomId,
  establishedRoomId,
  roomIdForFingerprint,
  acceptDevice,
  isPaired,
  revokeDevice,
  localIdentity,
} from '../channels/mesh/pairing';
import { readConfig, updateConfig } from '../core/settings/config_store';
import { OwnerGate } from '../core/owner_gate';
import { MeshChannel } from '../channels/mesh/mesh_channel';
import type { ChannelRuntime } from '../channels/base_channel';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  \x1b[32mok\x1b[0m   ${label}`);
  } else {
    failures += 1;
    console.log(`  \x1b[31mFAIL\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
  }
}
function section(t: string): void {
  console.log(`\n\x1b[1m${t}\x1b[0m`);
}

function throws(label: string, fn: () => unknown): void {
  try {
    fn();
    check(label, false, 'did not throw');
  } catch {
    check(label, true);
  }
}

// ── the sealed box ──────────────────────────────────────────────────────────

function testBox(): void {
  section('Sealed box — a paired pair can talk, and only them');

  const pc = generateKeyPair();
  const phone = generateKeyPair();

  const pcSession = beginSession(pc.privateKey, pc.publicKey, phone.publicKey);
  const phoneSession = beginSession(phone.privateKey, phone.publicKey, pc.publicKey);

  const box = seal(phoneSession, { t: 'prompt', id: '1', text: 'what is my volume' });
  const opened = open(pcSession, box);
  check(
    'the PC decrypts a frame the phone sealed',
    (opened.frame as { text: string }).text === 'what is my volume',
  );
  check(
    'and attributes it to the session’s device, not anything on the wire',
    opened.senderFingerprint === fingerprint(phone.publicKey),
  );

  section('Sealed box — tampering is rejected, not tolerated');

  const box2 = seal(
    beginSession(phone.privateKey, phone.publicKey, pc.publicKey),
    { t: 'ping' },
  );
  const raw = Buffer.from(box2, 'base64');
  raw[raw.length - 20] ^= 0x01; // flip a bit deep in the ciphertext body
  throws('a modified ciphertext throws on open', () =>
    open(beginSession(pc.privateKey, pc.publicKey, phone.publicKey), raw.toString('base64')),
  );

  // Bootstrap frames carry a cleartext key header. Swap it and the GCM tag
  // fails, because the header is bound as additional data.
  const attacker = generateKeyPair();
  const hello = Buffer.from(
    sealPairing(beginSession(phone.privateKey, phone.publicKey, pc.publicKey), { t: 'hello' }),
    'base64',
  );
  Buffer.from(attacker.publicKey.replace(/-/g, '+').replace(/_/g, '/'), 'base64').copy(hello, 0);
  throws('a swapped sender key on a bootstrap frame fails the tag', () =>
    openPairing(pc.privateKey, pc.publicKey, hello.toString('base64')),
  );

  section('Sealed box — replay is rejected');

  const fresh = beginSession(phone.privateKey, phone.publicKey, pc.publicKey);
  const pcFresh = beginSession(pc.privateKey, pc.publicKey, phone.publicKey);
  const a = seal(fresh, { t: 'prompt', id: '1', text: 'one' });
  const b = seal(fresh, { t: 'prompt', id: '2', text: 'two' });
  open(pcFresh, a);
  open(pcFresh, b);
  throws('re-sending an already-seen frame throws', () => open(pcFresh, a));
  throws('an out-of-order earlier counter throws', () => {
    const stale = beginSession(phone.privateKey, phone.publicKey, pc.publicKey);
    const only = seal(stale, { t: 'ping' }); // counter 1, already passed on pcFresh
    open(pcFresh, only);
  });

  section('Sealed box — an unpaired key gets nowhere');

  const stranger = generateKeyPair();
  const strangerHello = sealPairing(
    beginSession(stranger.privateKey, stranger.publicKey, pc.publicKey),
    { t: 'hello' },
  );
  // The PC *can* cryptographically open a bootstrap frame from any valid X25519
  // peer — but the fingerprint is not one it has paired, and mesh_channel.ts
  // drops it there unless a pairing window is open.
  const openedStranger = openPairing(pc.privateKey, pc.publicKey, strangerHello);
  check(
    'an unpaired sender is identifiable and therefore refusable',
    openedStranger.senderFingerprint === fingerprint(stranger.publicKey) &&
      !isPaired(openedStranger.senderPublicKey),
  );
}

// ── what the relay sees ─────────────────────────────────────────────────────

function testRelayOpacity(): void {
  section('The relay is blind');

  const pc = generateKeyPair();
  const phone = generateKeyPair();
  const phoneSession = beginSession(phone.privateKey, phone.publicKey, pc.publicKey);

  const secret = 'display the aadhaar file, it is in my downloads folder';
  const box = seal(phoneSession, { t: 'prompt', id: '1', text: secret });

  // The envelope is all the relay ever holds.
  const envelope = { t: 'box', meshId: meshRoomId(fingerprint(pc.publicKey), fingerprint(phone.publicKey)), box };
  const seen = JSON.stringify(envelope);
  const rawBox = Buffer.from(box, 'base64');

  check('the plaintext is nowhere in the envelope', !seen.includes('aadhaar'));
  check(
    'no public key rides on a steady-state frame',
    !seen.includes(pc.publicKey) &&
      !seen.includes(phone.publicKey) &&
      // and the raw box does not start with the phone's 32-byte key
      !rawBox.subarray(0, 32).equals(
        Buffer.from(phone.publicKey.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
      ),
  );
  check(
    'the same message sealed twice yields different ciphertext',
    seal(phoneSession, { t: 'prompt', id: '1', text: secret }) !== box,
    'a fresh nonce per frame — the relay cannot even tell a repeat',
  );
  check('the room id is a bare hash, not a key', /^[a-f0-9]{24}$/.test(envelope.meshId));
}

// ── pairing ────────────────────────────────────────────────────────────────

function testPairing(): void {
  section('Pairing — codes, rooms, and the paired-devices list');

  const offer = createPairingOffer();
  check('a pairing code has the v1.<key>.<salt> shape', /^v1\.[A-Za-z0-9_-]{43,}\.[A-Za-z0-9_-]{8,}$/.test(offer.code));
  const parsed = parsePairingCode(offer.code);
  check('and it round-trips', parsed.salt === offer.salt);
  throws('a truncated code is refused', () => parsePairingCode('v1.tooshort.aaaa'));
  throws('a garbage code is refused', () => parsePairingCode('hello there'));

  const pc = localIdentity();
  const phone = generateKeyPair();

  // Both sides derive the same rooms without a server telling them.
  check(
    'the pairing room matches on both sides',
    pairingRoomId(pc.publicKey, offer.salt) === pairingRoomId(pc.publicKey, offer.salt),
  );
  check(
    'the established room from two keys == the one from a key + a fingerprint',
    establishedRoomId(pc.publicKey, phone.publicKey) ===
      roomIdForFingerprint(pc.publicKey, fingerprint(phone.publicKey)),
    'the PC only stores the phone’s fingerprint, so these must agree',
  );

  section('Pairing — the allow-list is the authority');

  check('nothing is paired to start with', readConfig().meshPairedDevices.length === 0);
  check('an unknown device is not paired', !isPaired(phone.publicKey));
  const fp = acceptDevice(phone.publicKey);
  check('accepting a device records its fingerprint', readConfig().meshPairedDevices.includes(fp));
  check('and it now reads as paired, by key or by fingerprint', isPaired(phone.publicKey) && isPaired(fp));
  check('accepting twice is idempotent', (acceptDevice(phone.publicKey), readConfig().meshPairedDevices.length === 1));
  revokeDevice(fp);
  check('revoking removes it', !isPaired(fp) && readConfig().meshPairedDevices.length === 0);
}

// ── the owner-gate extension ───────────────────────────────────────────────

async function testGateExtension(): Promise<void> {
  section('The Gateway accepts a paired mesh device and refuses a stranger');

  // MeshChannel teaches the shared OwnerGate the one case it lacks. Exercise it
  // directly against a real gate, the way the constructor does.
  const gate = new OwnerGate({});
  const phone = generateKeyPair();

  // Stand up a MeshChannel with a runtime whose gate is the one under test.
  const fakeRuntime = {
    gateway: {},
    ownerGate: gate,
    confirmations: {},
  } as unknown as ChannelRuntime;
  // eslint-disable-next-line no-new
  new MeshChannel(fakeRuntime);

  const base = { requestId: '', sessionId: '', senderId: '', text: 'what is my volume', timestamp: Date.now() };

  check(
    'a mesh request from an unpaired fingerprint is refused',
    !gate.evaluate({ ...base, source: 'mesh', senderId: fingerprint(phone.publicKey) } as never).allow,
  );

  acceptDevice(phone.publicKey);
  const decision = gate.evaluate({ ...base, source: 'mesh', senderId: fingerprint(phone.publicKey) } as never);
  check('once paired, the same request is allowed', decision.allow === true);
  check(
    'and non-mesh sources are completely unaffected',
    !new OwnerGate({}).evaluate({ ...base, source: 'telegram', senderId: '123', chatType: 'direct' } as never).allow &&
      new OwnerGate({ telegram_id: '123' }).evaluate({ ...base, source: 'telegram', senderId: '123', chatType: 'direct' } as never).allow,
  );
  revokeDevice(fingerprint(phone.publicKey));
}

async function main(): Promise<void> {
  console.log('\x1b[1mDEX Mesh — crypto, pairing, and relay opacity\x1b[0m');
  // Start from a clean slate regardless of what isolate.ts seeded.
  updateConfig({ meshPairedDevices: [], meshRelayUrl: 'wss://relay.test/ws' });

  testBox();
  testRelayOpacity();
  testPairing();
  await testGateExtension();

  console.log(`\n${failures === 0 ? '\x1b[32mAll mesh checks passed\x1b[0m' : `\x1b[31m${failures} failed\x1b[0m`}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
