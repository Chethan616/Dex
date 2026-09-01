/**
 * Mesh CLI — set up and inspect the device mesh without a UI.
 *
 *   npm run mesh -- enable wss://dex-mesh-relay.example.workers.dev
 *   npm run mesh -- pair            # print a code + QR, wait for a phone
 *   npm run mesh -- list            # paired devices
 *   npm run mesh -- revoke <fingerprint>
 *   npm run mesh -- disable
 *
 * `pair` runs a MeshChannel with a pairing window open, prints the code, and
 * exits once a phone completes the exchange. Everything it changes goes through
 * `updateConfig`, so the running core picks it up on its next start; while the
 * core is running, prefer pairing from the Dex Bar.
 */
import { readConfig, updateConfig } from '../core/settings/config_store';
import { ChannelRuntime } from '../channels/base_channel';
import { OwnerGate } from '../core/owner_gate';
import { ConfirmationManager } from '../core/confirmation/confirmation_manager';
import { MeshChannel } from '../channels/mesh/mesh_channel';
import { createPairingOffer } from '../channels/mesh/pairing';
import { revokeDevice } from '../channels/mesh/pairing';

function qrToTerminal(text: string): void {
  // A dependency-free QR would be a lot of code; instead, print a URL the owner
  // can turn into a QR with their phone's camera app pointed at the screen is
  // not possible — so we print the payload and a hint. A real QR renderer can
  // be dropped in here later without changing anything else.
  console.log('\nPairing payload (encode as QR if you like):\n');
  console.log('  ' + text + '\n');
}

async function pair(): Promise<void> {
  const cfg = readConfig();
  if (!cfg.meshEnabled || !cfg.meshRelayUrl) {
    console.error('Mesh is not enabled. Run:  npm run mesh -- enable <relay-url>');
    process.exit(1);
  }

  const offer = createPairingOffer();
  console.log('\n\x1b[1mPair a phone\x1b[0m');
  console.log('On the phone, open the Mesh web client and enter:\n');
  console.log('  Relay URL:     ' + cfg.meshRelayUrl);
  console.log('  Pairing code:  \x1b[36m' + offer.code + '\x1b[0m');
  qrToTerminal(offer.qrPayload);
  console.log('Waiting for the phone…  (Ctrl-C to cancel)\n');

  const before = new Set(readConfig().meshPairedDevices);

  // A minimal runtime — pairing needs no Gateway.
  const runtime = new ChannelRuntime(
    {} as never,
    new OwnerGate({}),
    new ConfirmationManager(),
  );
  const channel = new MeshChannel(runtime);
  await channel.start();
  channel.openPairing(offer.salt);

  const done = await new Promise<string | null>((resolve) => {
    const timer = setInterval(() => {
      const now = readConfig().meshPairedDevices;
      const added = now.find((d) => !before.has(d));
      if (added) { clearInterval(timer); resolve(added); }
    }, 500);
    setTimeout(() => { clearInterval(timer); resolve(null); }, offer.expiresAt - Date.now());
  });

  await channel.stop();

  if (done) {
    console.log('\x1b[32m✓ paired\x1b[0m  ' + done);
    process.exit(0);
  }
  console.log('\x1b[33mPairing window expired.\x1b[0m No device paired.');
  process.exit(1);
}

function list(): void {
  const cfg = readConfig();
  console.log('\nMesh: ' + (cfg.meshEnabled ? 'enabled' : 'disabled'));
  console.log('Relay: ' + (cfg.meshRelayUrl || '(none)'));
  console.log('This PC: ' + (cfg.meshDeviceId || '(no identity yet — run pair)'));
  console.log('\nPaired devices:');
  if (cfg.meshPairedDevices.length === 0) console.log('  (none)');
  else cfg.meshPairedDevices.forEach((d) => console.log('  ' + d));
  console.log();
}

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  switch (cmd) {
    case 'enable':
      if (!arg || !/^wss?:\/\//.test(arg)) {
        console.error('Usage: npm run mesh -- enable wss://<relay-host>');
        process.exit(1);
      }
      updateConfig({ meshEnabled: true, meshRelayUrl: arg });
      console.log('Mesh enabled. Relay: ' + arg);
      break;
    case 'disable':
      updateConfig({ meshEnabled: false });
      console.log('Mesh disabled. Paired devices are kept; re-enable to use them.');
      break;
    case 'pair':
      await pair();
      break;
    case 'list':
      list();
      break;
    case 'revoke':
      if (!arg) { console.error('Usage: npm run mesh -- revoke <fingerprint>'); process.exit(1); }
      revokeDevice(arg);
      console.log('Revoked ' + arg);
      break;
    default:
      console.log('Commands: enable <url> | disable | pair | list | revoke <fp>');
  }
}

void main();
