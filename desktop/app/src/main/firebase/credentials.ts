/**
 * The email/password the desktop signs in to Firebase with — the same pair
 * the user types into DEX for Android, which is what pairs the two.
 *
 * Kept in the OS credential store (keytar), like every other secret DEX holds:
 * Firebase's JS SDK has no persistent session in Node, so the desktop signs in
 * again on each launch.
 */
import { mainLogger } from '../logger';

const SERVICE = 'com.chethan616.dex.phone';
const ACCOUNT = 'firebase-email';

interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

function keytar(): KeytarLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('keytar') as KeytarLike;
  } catch {
    return null;
  }
}

export interface PhoneCredentials {
  email: string;
  password: string;
}

export async function loadCredentials(): Promise<PhoneCredentials | null> {
  try {
    const raw = await keytar()?.getPassword(SERVICE, ACCOUNT);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PhoneCredentials>;
    return parsed.email && parsed.password ? { email: parsed.email, password: parsed.password } : null;
  } catch (err) {
    mainLogger.warn('firebase.credentials.load.failed', { error: (err as Error).message });
    return null;
  }
}

export async function saveCredentials(creds: PhoneCredentials): Promise<void> {
  await keytar()?.setPassword(SERVICE, ACCOUNT, JSON.stringify(creds));
}

export async function clearCredentials(): Promise<void> {
  await keytar()?.deletePassword(SERVICE, ACCOUNT).catch(() => false);
}
