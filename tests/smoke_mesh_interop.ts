import './support/isolate';
/**
 * The PC crypto (channels/mesh/crypto.ts, node:crypto) and the web crypto
 * (web/js/crypto.js, WebCrypto) must produce the *same bytes*, or a phone and a
 * PC can never open each other's frames. This test loads the browser module
 * under Node's WebCrypto and checks both directions.
 *
 *   npm run test:mesh-interop
 */
import { webcrypto } from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  generateKeyPair as nodeGenerate,
  beginSession as nodeBeginSession,
  seal as nodeSeal,
  open as nodeOpen,
  sealPairing as nodeSealPairing,
  openPairing as nodeOpenPairing,
} from '../channels/mesh/crypto';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`  \x1b[32mok\x1b[0m   ${label}`);
  else { failures += 1; console.log(`  \x1b[31mFAIL\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`); }
}

// ── load web/js/crypto.js in a Node-hosted browser-ish global ──────────────
function loadWebCrypto(): {
  generateKeyPair(): Promise<{ publicKey: string; privateKeyPkcs8: string }>;
  importPrivate(b64: string): Promise<webcrypto.CryptoKey>;
  beginSession(priv: webcrypto.CryptoKey, myPub: string, peerPub: string): unknown;
  seal(session: unknown, obj: unknown): Promise<string>;
  sealHello(session: unknown, obj: unknown): Promise<string>;
  open(session: unknown, box: string): Promise<{ frame: unknown; senderPublicKey: string }>;
} {
  const sandbox: Record<string, unknown> = {};
  const shims = {
    crypto: webcrypto,
    btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
    TextEncoder,
    TextDecoder,
  };

  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'js', 'crypto.js'), 'utf8');
  // Run the module body with `self`, and the browser globals it touches,
  // provided as function parameters — no writing to Node's read-only globals.
  // eslint-disable-next-line no-new-func
  new Function('self', 'crypto', 'btoa', 'atob', 'TextEncoder', 'TextDecoder', src)(
    sandbox,
    shims.crypto,
    shims.btoa,
    shims.atob,
    shims.TextEncoder,
    shims.TextDecoder,
  );
  return sandbox.MeshCrypto as never;
}

async function main(): Promise<void> {
  console.log('\x1b[1mDEX Mesh — PC ↔ web crypto interoperability\x1b[0m');

  const Web = loadWebCrypto();

  // PC identity via node:crypto; phone identity via WebCrypto.
  const pc = nodeGenerate();
  const phoneWeb = await Web.generateKeyPair();
  const phonePriv = await Web.importPrivate(phoneWeb.privateKeyPkcs8);

  console.log('\n\x1b[1mphone (web) → PC (node)\x1b[0m');

  // Bootstrap hello: web seals with key header, node opens with openPairing.
  const phoneSessionWeb = Web.beginSession(phonePriv, phoneWeb.publicKey, pc.publicKey);
  const helloBox = await Web.sealHello(phoneSessionWeb, { t: 'hello' });
  const helloOpened = nodeOpenPairing(pc.privateKey, pc.publicKey, helloBox);
  check('node opens the web bootstrap frame', (helloOpened.frame as { t: string }).t === 'hello');
  check(
    'and recovers the phone’s public key',
    helloOpened.senderPublicKey === phoneWeb.publicKey,
  );

  // Steady state: web seal → node open.
  const pcSession = nodeBeginSession(pc.privateKey, pc.publicKey, phoneWeb.publicKey);
  const promptBox = await Web.seal(phoneSessionWeb, { t: 'prompt', id: '1', text: 'what is my volume' });
  const prompt = nodeOpen(pcSession, promptBox).frame as { text: string };
  check('node decrypts a web-sealed steady-state frame', prompt.text === 'what is my volume');

  console.log('\n\x1b[1mPC (node) → phone (web)\x1b[0m');

  // node seal → web open.
  const pcToPhone = nodeSeal(pcSession, { t: 'event', requestId: 'r1', type: 'done', message: 'Volume is 30%.' });
  const webSession = Web.beginSession(phonePriv, phoneWeb.publicKey, pc.publicKey);
  const ev = (await Web.open(webSession, pcToPhone)).frame as { message: string };
  check('web decrypts a node-sealed frame', ev.message === 'Volume is 30%.');

  // node bootstrap → web is not needed (PC never bootstraps), but check the
  // reverse pairing helper agrees on room-independent key derivation via a
  // second round-trip.
  const ev2 = nodeSeal(pcSession, { t: 'pong' });
  const ev2Web = (await Web.open(webSession, ev2)).frame as { t: string };
  check('a second node→web frame also opens (counter advances in step)', ev2Web.t === 'pong');

  void nodeSealPairing; // referenced for symmetry; PC-side pairing seal unused here

  console.log(`\n${failures === 0 ? '\x1b[32mAll interop checks passed\x1b[0m' : `\x1b[31m${failures} failed\x1b[0m`}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
