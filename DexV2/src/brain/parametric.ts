import { DeterministicAction } from './types.js';

export interface ParametricAction {
  pattern: RegExp;
  extract: (m: RegExpMatchArray) => Record<string, string>;
  template: (params: Record<string, string>) => DeterministicAction;
}

const PARAMETRIC_ACTIONS: ParametricAction[] = [
  // 1-2. Volume controls
  {
    pattern: /^(?:set\s+)?volume\s+(?:to\s+)?(\d+)%?$/i,
    extract: m => ({ n: m[1] }),
    template: p => ({ tool: 'shell', cmd: `(New-Object -ComObject WScript.Shell).SendKeys([char]174); [System.Threading.Thread]::Sleep(100); $vol=${p.n}` }),
  },
  // 3-4. Brightness controls
  {
    pattern: /^(?:set\s+)?brightness\s+(?:to\s+)?(\d+)%?$/i,
    extract: m => ({ n: m[1] }),
    template: p => ({ tool: 'shell', cmd: `(Get-WmiObject -Namespace root/wmi -Class WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue).WmiSetBrightness(1,${p.n})` }),
  },
  // 5-6. Kill process
  {
    pattern: /^(?:kill|close|stop)\s+(?:process\s+)?(.+)$/i,
    extract: m => ({ proc: m[1].trim() }),
    template: p => ({ tool: 'shell', cmd: `Stop-Process -Name "${p.proc}" -Force -ErrorAction SilentlyContinue` }),
  },
  // 7-8. Ping host
  {
    pattern: /^ping\s+(\S+)(?:\s+(\d+)\s+times?)?$/i,
    extract: m => ({ host: m[1], n: m[2] ?? '4' }),
    template: p => ({ tool: 'shell', cmd: `ping -n ${p.n} ${p.host}` }),
  },
  // 9-10. DNS configuration
  {
    pattern: /^(?:set\s+)?(?:dns|DNS)\s+(?:to\s+)?(\d[\d.]+)(?:\s+(\d[\d.]+))?$/i,
    extract: m => ({ p: m[1], s: m[2] ?? '8.8.4.4' }),
    template: p => ({ tool: 'shell', cmd: `Set-DnsClientServerAddress -InterfaceAlias (Get-NetAdapter | Where-Object Status -eq 'Up').Name -ServerAddresses ('${p.p}','${p.s}')` }),
  },
  // 11-13. Delete files & folders
  {
    pattern: /^(?:delete|remove)\s+file\s+(.+)$/i,
    extract: m => ({ path: m[1].trim() }),
    template: p => ({ tool: 'shell', cmd: `Remove-Item -Path "${p.path}" -Force` }),
  },
  {
    pattern: /^(?:delete|remove)\s+(?:folder|directory)\s+(.+)$/i,
    extract: m => ({ path: m[1].trim() }),
    template: p => ({ tool: 'shell', cmd: `Remove-Item -Path "${p.path}" -Recurse -Force` }),
  },
  {
    pattern: /^(?:delete|remove)\s+(.+)$/i,
    extract: m => ({ path: m[1].trim() }),
    template: p => ({ tool: 'shell', cmd: `Remove-Item -Path "${p.path}" -Recurse -Force` }),
  },
  // 14. Rename
  {
    pattern: /^(?:rename)\s+(.+?)\s+to\s+(.+)$/i,
    extract: m => ({ src: m[1].trim(), dst: m[2].trim() }),
    template: p => ({ tool: 'shell', cmd: `Rename-Item -Path "${p.src}" -NewName "${p.dst}"` }),
  },
  // 15. Copy
  {
    pattern: /^(?:copy|cp)\s+(.+?)\s+(?:to\s+)?(.+)$/i,
    extract: m => ({ src: m[1].trim(), dst: m[2].trim() }),
    template: p => ({ tool: 'shell', cmd: `Copy-Item -Path "${p.src}" -Destination "${p.dst}" -Recurse -Force` }),
  },
  // 16. Move
  {
    pattern: /^(?:move|mv)\s+(.+?)\s+(?:to\s+)?(.+)$/i,
    extract: m => ({ src: m[1].trim(), dst: m[2].trim() }),
    template: p => ({ tool: 'shell', cmd: `Move-Item -Path "${p.src}" -Destination "${p.dst}" -Force` }),
  },
  // 17-19. Create folder/directory
  {
    pattern: /^(?:mkdir|create\s+(?:folder|directory|dir))\s+(.+)$/i,
    extract: m => ({ path: m[1].trim() }),
    template: p => ({ tool: 'shell', cmd: `New-Item -ItemType Directory -Path "${p.path}" -Force` }),
  },
  // 20. Open window states
  {
    pattern: /^open\s+(.+?)\s+(maximized?|fullscreen|minimized?)$/i,
    extract: m => ({ app: m[1].trim(), mode: m[2] }),
    template: p => ({
      tool: 'shell',
      cmd: `$p=Start-Process "${p.app}" -PassThru; Start-Sleep -Milliseconds 500; $wsh=New-Object -ComObject WScript.Shell; $wsh.AppActivate($p.Id); ${p.mode.startsWith('min') ? '$wsh.SendKeys(\'%{ }\')' : '$wsh.SendKeys(\'%{F10}\')'}`,
    }),
  },
  // 21-23. Timers and alarms
  {
    pattern: /^(?:set\s+)?(?:timer|alarm)\s+(?:for\s+)?(\d+)\s*(s(?:ec(?:ond)?s?)?|m(?:in(?:ute)?s?)?|h(?:our)?s?)$/i,
    extract: m => {
      const n = parseInt(m[1]);
      const unit = m[2][0].toLowerCase();
      const secs = unit === 'h' ? n * 3600 : unit === 'm' ? n * 60 : n;
      return { secs: String(secs) };
    },
    template: p => ({ tool: 'shell', cmd: `Start-Sleep -Seconds ${p.secs}; [System.Media.SystemSounds]::Beep.Play()` }),
  },
  // 24-25. Disk cleanup
  {
    pattern: /^disk\s+cleanup\s+drive\s+([a-zA-Z])$/i,
    extract: m => ({ drive: m[1] }),
    template: p => ({ tool: 'shell', cmd: `cleanmgr /d ${p.drive}` }),
  },
  {
    pattern: /^disk\s+cleanup$/i,
    extract: () => ({}),
    template: () => ({ tool: 'shell', cmd: 'cleanmgr /sagerun:1' }),
  },
  // 26-27. File searching
  {
    pattern: /^search\s+files\s+for\s+(.+)$/i,
    extract: m => ({ query: m[1].trim() }),
    template: p => ({ tool: 'shell', cmd: `Get-ChildItem -Path . -Filter "*${p.query}*" -Recurse -ErrorAction SilentlyContinue` }),
  },
  {
    pattern: /^search\s+directory\s+(.+?)\s+for\s+(.+)$/i,
    extract: m => ({ dir: m[1].trim(), query: m[2].trim() }),
    template: p => ({ tool: 'shell', cmd: `Get-ChildItem -Path "${p.dir}" -Filter "*${p.query}*" -Recurse -ErrorAction SilentlyContinue` }),
  },
  // 28-29. App uninstallation
  {
    pattern: /^uninstall\s+(?:app|program)\s+(.+)$/i,
    extract: m => ({ name: m[1].trim() }),
    template: p => ({ tool: 'shell', cmd: `Get-WmiObject -Class Win32_Product -ErrorAction SilentlyContinue | Where-Object Name -like "*${p.name}*" | ForEach-Object { $_.Uninstall() }` }),
  },
  // 30-31. Status checks
  {
    pattern: /^process\s+status\s+(.+)$/i,
    extract: m => ({ name: m[1].trim() }),
    template: p => ({ tool: 'shell', cmd: `Get-Process -Name "${p.name}" -ErrorAction SilentlyContinue` }),
  },
  {
    pattern: /^service\s+status\s+(.+)$/i,
    extract: m => ({ name: m[1].trim() }),
    template: p => ({ tool: 'shell', cmd: `Get-Service -Name "${p.name}" -ErrorAction SilentlyContinue` }),
  },
  // 32-34. Service controls
  {
    pattern: /^start\s+service\s+(.+)$/i,
    extract: m => ({ name: m[1].trim() }),
    template: p => ({ tool: 'shell', cmd: `Start-Service -Name "${p.name}"` }),
  },
  {
    pattern: /^stop\s+service\s+(.+)$/i,
    extract: m => ({ name: m[1].trim() }),
    template: p => ({ tool: 'shell', cmd: `Stop-Service -Name "${p.name}" -Force` }),
  },
  {
    pattern: /^restart\s+service\s+(.+)$/i,
    extract: m => ({ name: m[1].trim() }),
    template: p => ({ tool: 'shell', cmd: `Restart-Service -Name "${p.name}" -Force` }),
  },
  // 35. Test net connection
  {
    pattern: /^net\s+connection\s+(.+)$/i,
    extract: m => ({ host: m[1].trim() }),
    template: p => ({ tool: 'shell', cmd: `Test-Connection -ComputerName "${p.host}" -Count 2` }),
  },
  // 36-37. Download operations
  {
    pattern: /^download\s+file\s+(.+?)\s+to\s+(.+)$/i,
    extract: m => ({ url: m[1].trim(), path: m[2].trim() }),
    template: p => ({ tool: 'shell', cmd: `Invoke-WebRequest -Uri "${p.url}" -OutFile "${p.path}"` }),
  },
  {
    pattern: /^download\s+url\s+(.+)$/i,
    extract: m => ({ url: m[1].trim() }),
    template: p => ({ tool: 'shell', cmd: `$filename = [System.IO.Path]::GetFileName("${p.url}"); Invoke-WebRequest -Uri "${p.url}" -OutFile $filename` }),
  },
  // 38-39. Text files creation/appending
  {
    pattern: /^write\s+text\s+(.+?)\s+to\s+file\s+(.+)$/i,
    extract: m => ({ text: m[1].trim(), path: m[2].trim() }),
    template: p => ({ tool: 'shell', cmd: `Set-Content -Path "${p.path}" -Value "${p.text}"` }),
  },
  {
    pattern: /^append\s+text\s+(.+?)\s+to\s+file\s+(.+)$/i,
    extract: m => ({ text: m[1].trim(), path: m[2].trim() }),
    template: p => ({ tool: 'shell', cmd: `Add-Content -Path "${p.path}" -Value "${p.text}"` }),
  },
  // 40. Read file content
  {
    pattern: /^read\s+file\s+(.+)$/i,
    extract: m => ({ path: m[1].trim() }),
    template: p => ({ tool: 'shell', cmd: `Get-Content -Path "${p.path}" -Raw -ErrorAction SilentlyContinue` }),
  },
  // 41. File size
  {
    pattern: /^file\s+size\s+(.+)$/i,
    extract: m => ({ path: m[1].trim() }),
    template: p => ({ tool: 'shell', cmd: `(Get-Item "${p.path}").Length` }),
  },
  // 42. List directory contents
  {
    pattern: /^(?:directory\s+list|dir)\s+(.+)$/i,
    extract: m => ({ path: m[1].trim() }),
    template: p => ({ tool: 'shell', cmd: `Get-ChildItem -Path "${p.path}"` }),
  },
  // 43. Hash file
  {
    pattern: /^hash\s+file\s+(.+)$/i,
    extract: m => ({ path: m[1].trim() }),
    template: p => ({ tool: 'shell', cmd: `Get-FileHash -Path "${p.path}"` }),
  },
  // 44. Create symlink
  {
    pattern: /^make\s+link\s+(.+?)\s+target\s+(.+)$/i,
    extract: m => ({ path: m[1].trim(), target: m[2].trim() }),
    template: p => ({ tool: 'shell', cmd: `New-Item -ItemType SymbolicLink -Path "${p.path}" -Target "${p.target}"` }),
  },
  // 45. Archive compress
  {
    pattern: /^compress\s+(.+?)\s+to\s+(.+)$/i,
    extract: m => ({ src: m[1].trim(), dst: m[2].trim() }),
    template: p => ({ tool: 'shell', cmd: `Compress-Archive -Path "${p.src}" -DestinationPath "${p.dst}" -Force` }),
  },
  // 46. Archive expand
  {
    pattern: /^decompress\s+(.+?)\s+to\s+(.+)$/i,
    extract: m => ({ src: m[1].trim(), dst: m[2].trim() }),
    template: p => ({ tool: 'shell', cmd: `Expand-Archive -Path "${p.src}" -DestinationPath "${p.dst}" -Force` }),
  },
  // 47. Find IP address of domain
  {
    pattern: /^find\s+ip\s+(.+)$/i,
    extract: m => ({ host: m[1].trim() }),
    template: p => ({ tool: 'shell', cmd: `[System.Net.Dns]::GetHostAddresses("${p.host}") | Select-Object -ExpandProperty IPAddressToString` }),
  },
  // 48-49. Web page navigating
  {
    pattern: /^open\s+url\s+(.+)$/i,
    extract: m => ({ url: m[1].trim() }),
    template: p => ({ tool: 'shell', cmd: `Start-Process "${p.url}"` }),
  },
  {
    pattern: /^go\s+to\s+(.+)$/i,
    extract: m => ({ url: m[1].trim() }),
    template: p => ({ tool: 'shell', cmd: `Start-Process "${p.url}"` }),
  },
];

export function tryParametric(normalized: string): DeterministicAction | null {
  const text = normalized.trim();
  for (const pa of PARAMETRIC_ACTIONS) {
    const m = text.match(pa.pattern);
    if (m) {
      return pa.template(pa.extract(m));
    }
  }
  return null;
}
