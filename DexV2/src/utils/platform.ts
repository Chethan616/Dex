import path from 'path';
import os from 'os';
import fs from 'fs';

const homeDir = os.homedir();
export function getDexDir(): string {
  return process.env.NODE_ENV === 'test'
    ? (process.env.DEX_TEST_DIR || path.join(process.cwd(), '.temp_test_dex'))
    : path.join(homeDir, '.dex', 'dexv2');
}

export function getStateDbPath(): string {
  return path.join(getDexDir(), 'state.db');
}

export function getTelemetryDbPath(): string {
  return path.join(getDexDir(), 'telemetry.db');
}

export function getCredsDbPath(): string {
  return path.join(getDexDir(), 'creds.db');
}

export function ensureDirs(): void {
  const dir = getDexDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
