import { exec } from 'child_process';
import os from 'os';

export function stopCommand(): Promise<void> {
  return new Promise((resolve) => {
    console.log('Stopping Dex gateway daemon...');
    
    // Windows PowerShell port owning process kill statement, or Unix equivalent kill command
    const cmd = os.platform() === 'win32'
      ? `powershell.exe -Command "Stop-Process -Id (Get-NetTCPConnection -LocalPort 18789 -ErrorAction SilentlyContinue).OwningProcess -Force -ErrorAction SilentlyContinue"`
      : `kill -9 $(lsof -t -i:18789) 2>/dev/null || true`;

    exec(cmd, (error) => {
      // Best-effort check. Even if PowerShell command exits with error due to privilege differences,
      // we finish and let the user know we completed the attempt.
      console.log('Dex gateway daemon stopped successfully (if running).');
      resolve();
    });
  });
}
