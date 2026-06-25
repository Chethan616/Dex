import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import WebSocket from 'ws';
import { getDexDir } from '../utils/platform.js';
import { ensureAdmin } from '../utils/elevate.js';

function isServerRunning(port = 18789): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => {
      ws.close();
      resolve(true);
    });
    ws.on('error', () => {
      resolve(false);
    });
  });
}

export async function startCommand() {
  ensureAdmin(false);
  const port = 18789;
  const running = await isServerRunning(port);

  if (running) {
    console.log(`Dex is already running on ws://127.0.0.1:${port}`);
    return;
  }

  console.log('Starting Dex gateway daemon in the background...');
  
  const dexDir = getDexDir();
  // Ensure the directory exists
  if (!fs.existsSync(dexDir)) {
    fs.mkdirSync(dexDir, { recursive: true });
  }

  const logFile = path.join(dexDir, 'dex-daemon.log');
  const out = fs.openSync(logFile, 'a');
  const err = fs.openSync(logFile, 'a');

  // Resolve launcher path relative to current working directory
  const launcherPath = path.resolve(process.cwd(), 'dist', 'gateway', 'launcher.js');

  if (!fs.existsSync(launcherPath)) {
    console.error(`Error: Launcher binary not found at ${launcherPath}. Run 'npm run build' first.`);
    process.exit(1);
  }

  const child = spawn('node', [launcherPath], {
    detached: true,
    stdio: ['ignore', out, err],
    windowsHide: true,
    env: {
      ...process.env
    }
  });

  child.unref();

  console.log(`Dex daemon successfully launched (PID: ${child.pid}).`);
  console.log(`Logs are streaming to: ${logFile}`);
}
