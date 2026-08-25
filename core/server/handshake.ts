import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Where the core drops its connection details and where the Flutter UI picks
 * them up. Both sides resolve this independently — no shared working directory.
 */
export function handshakePath(): string {
  const base =
    process.env.LOCALAPPDATA ??
    process.env.XDG_RUNTIME_DIR ??
    path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'DEX', 'ui.json');
}

export interface Handshake {
  port: number;
  token: string;
  pid: number;
  version: string;
  startedAt: number;
}

export function writeHandshake(h: Handshake): string {
  const file = handshakePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(h, null, 2), { encoding: 'utf8', mode: 0o600 });
  return file;
}

export function removeHandshake(): void {
  try {
    fs.unlinkSync(handshakePath());
  } catch {
    /* already gone */
  }
}
