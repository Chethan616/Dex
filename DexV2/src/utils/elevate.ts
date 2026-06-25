import { execSync } from 'child_process';
import path from 'path';

export function ensureAdmin(wait = true): void {
  if (process.platform !== 'win32') return;
  try {
    execSync('net session', { stdio: 'ignore' });
    return;
  } catch {
    const scriptPath = path.resolve(process.argv[1]);
    const remainingArgs = process.argv.slice(2).map(a => `"${a}"`).join(' ');
    const argList = `"${scriptPath}" ${remainingArgs}`.trim();
    // Use single quotes for paths and escape quotes appropriately to ensure safe execution
    const waitArg = wait ? ' -Wait' : '';
    const cmd = `Start-Process -FilePath '${process.execPath}' -ArgumentList '${argList.replace(/'/g, "''")}' -WorkingDirectory '${process.cwd()}' -Verb RunAs -WindowStyle Hidden${waitArg}`;
    execSync(`powershell -NoProfile -Command "${cmd.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
    process.exit(0);
  }
}
