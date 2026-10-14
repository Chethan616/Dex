// A stand-in for host.ps1: answers ops for three windows (tests only).
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
const WINDOWS = {
  1: { hwnd: 1, title: 'Untitled - Notepad', process: 'notepad.exe', className: 'Notepad', openedByDex: false, takenOver: false },
  2: { hwnd: 2, title: '1Password', process: '1Password.exe', className: 'Chrome_WidgetWin_1', openedByDex: false, takenOver: false },
  3: { hwnd: 3, title: 'Windows PowerShell', process: 'powershell.exe', className: 'ConsoleWindowClass', openedByDex: false, takenOver: false },
  4: { hwnd: 4, title: 'Spotify', process: 'Spotify.exe', className: 'Chrome_WidgetWin_0', openedByDex: true, takenOver: true },
};
const say = (m) => process.stdout.write(JSON.stringify(m) + '\n');
say({ event: 'ready', version: 'fake' });
createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, op, args } = JSON.parse(line);
  if (op === 'resolve') {
    const w = WINDOWS[args.window?.hwnd];
    return say(w ? { id, ok: true, result: w } : { id, ok: false, error: 'no_window', message: 'No such window is open.' });
  }
  if (op === 'windows') return say({ id, ok: true, result: { windows: Object.values(WINDOWS) } });
  if (op === 'invoke') {
    const element = args.target === 'e5' ? { element: { name: 'Save', role: 'Button' } } : {};
    return say({ id, ok: true, result: { method: 'invoke', ...element }, ...(args.target === 'e9' ? { focus: { incident: { kind: 'foreground', to: { process: 'notepad.exe' } } } } : {}) });
  }
  if (op === 'change') {
    // A touchpad gesture, with the undo the real host records.
    const undo = args.action === 'gesture_set' ? { action: 'gesture_set', args: { key: args.args.key, value: 0 } } : undefined;
    return say({ id, ok: true, result: { done: true, ...(undo && args.args.value !== 0 ? { undo } : {}) } });
  }
  if (op === 'capture') {
    fs.mkdirSync(path.dirname(args.path), { recursive: true });
    fs.writeFileSync(args.path, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
    return say({ id, ok: true, result: { path: args.path, width: 1, height: 1 } });
  }
  say({ id, ok: true, result: { op, args } });
});
