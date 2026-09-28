/**
 * The Firebase project the desktop bridge talks to (the same one the Android
 * app's google-services.json points at). This is the *web app* config from
 * Firebase console → Project settings → Your apps → Web — public by design;
 * access is governed by Firestore security rules (firebase/firestore.rules),
 * which only let a signed-in user touch their own users/{uid} tree.
 *
 * Read from env (DEX_FIREBASE_API_KEY, DEX_FIREBASE_PROJECT_ID,
 * DEX_FIREBASE_APP_ID, DEX_FIREBASE_SENDER_ID) or config/firebase.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mainLogger } from '../logger';

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId?: string;
  storageBucket?: string;
}

function appRoot(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron');
    return app.getAppPath();
  } catch {
    return process.cwd();
  }
}

export function firebaseConfig(): FirebaseWebConfig | null {
  const env = (k: string) => process.env[k]?.trim() || undefined;
  const apiKey = env('DEX_FIREBASE_API_KEY');
  const projectId = env('DEX_FIREBASE_PROJECT_ID');
  const appId = env('DEX_FIREBASE_APP_ID');
  if (apiKey && projectId && appId) {
    return {
      apiKey,
      projectId,
      appId,
      authDomain: env('DEX_FIREBASE_AUTH_DOMAIN') ?? `${projectId}.firebaseapp.com`,
      messagingSenderId: env('DEX_FIREBASE_SENDER_ID'),
    };
  }
  const target = path.join(appRoot(), 'config', 'firebase.json');
  try {
    const file = JSON.parse(fs.readFileSync(target, 'utf-8')) as Partial<FirebaseWebConfig>;
    if (file.apiKey && file.projectId && file.appId) {
      return { authDomain: `${file.projectId}.firebaseapp.com`, ...file } as FirebaseWebConfig;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      mainLogger.warn('firebase.config.readFailed', { error: (err as Error).message });
    }
  }
  return null;
}
