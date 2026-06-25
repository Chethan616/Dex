import { DeterministicAction } from './types.js';

const DETERMINISTIC_MAP: Record<string, DeterministicAction> = {
  'open notepad': { tool: 'shell', cmd: 'Start-Process notepad' },
  'open calc': { tool: 'shell', cmd: 'Start-Process calc' },
  'open mspaint': { tool: 'shell', cmd: 'Start-Process mspaint' },
  'open winword': { tool: 'shell', cmd: 'Start-Process winword' },
  'open excel': { tool: 'shell', cmd: 'Start-Process excel' },
  'open cmd': { tool: 'shell', cmd: 'Start-Process cmd' },
  'open wt': { tool: 'shell', cmd: 'Start-Process wt' },
  'open chrome': { tool: 'shell', cmd: 'Start-Process chrome' },
  'open msedge': { tool: 'shell', cmd: 'Start-Process msedge' },
  'open firefox': { tool: 'shell', cmd: 'Start-Process firefox' },
  'open taskmgr': { tool: 'shell', cmd: 'Start-Process taskmgr' },
  'open regedit': { tool: 'shell', cmd: 'Start-Process regedit' },
  'open control': { tool: 'shell', cmd: 'Start-Process control' },
  'open explorer': { tool: 'shell', cmd: 'Start-Process explorer' },
  'lock computer': { tool: 'shell', cmd: 'rundll32.exe user32.dll,LockWorkStation' },
  'lock pc': { tool: 'shell', cmd: 'rundll32.exe user32.dll,LockWorkStation' },
  'screen snip': { tool: 'shell', cmd: 'Start-Process ms-screenclip:' },
  'screenshot': { tool: 'shell', cmd: 'Start-Process ms-screenclip:' },
  'mute': { tool: 'shell', cmd: '(New-Object -ComObject WScript.Shell).SendKeys([char]173)' },
  'unmute': { tool: 'shell', cmd: '(New-Object -ComObject WScript.Shell).SendKeys([char]173)' },
  'wifi off': { tool: 'shell', cmd: 'Disable-NetAdapter -Name * -Confirm:$false' },
  'wifi on': { tool: 'shell', cmd: 'Enable-NetAdapter -Name * -Confirm:$false' },
  'reboot': { tool: 'shell', cmd: 'Restart-Computer -Force' },
  'restart computer': { tool: 'shell', cmd: 'Restart-Computer -Force' },
  'shutdown': { tool: 'shell', cmd: 'Stop-Computer -Force' },
  'empty recycle bin': { tool: 'shell', cmd: 'Clear-RecycleBin -Force -ErrorAction SilentlyContinue' },
  'empty trash': { tool: 'shell', cmd: 'Clear-RecycleBin -Force -ErrorAction SilentlyContinue' },
  'wifi list': { tool: 'shell', cmd: 'netsh wlan show profiles' },
  'ip address': { tool: 'shell', cmd: 'ipconfig' },
  'system info': { tool: 'shell', cmd: 'Get-ComputerInfo' },
  'active processes': { tool: 'shell', cmd: 'Get-Process | Select-Object -Property Id, ProcessName, CPU, WorkingSet | Sort-Object CPU -Descending | Select-Object -First 20' },
  'flush dns': { tool: 'shell', cmd: 'Clear-DnsClientCache' },
  'disk space': { tool: 'shell', cmd: 'Get-Volume' },
  'bluetooth off': { tool: 'shell', cmd: 'Get-Service bthserv -ErrorAction SilentlyContinue | Stop-Service -Force -ErrorAction SilentlyContinue' },
  'bluetooth on': { tool: 'shell', cmd: 'Get-Service bthserv -ErrorAction SilentlyContinue | Start-Service -ErrorAction SilentlyContinue' },
  'sound options': { tool: 'shell', cmd: 'Start-Process ms-settings:sound' },
  'display options': { tool: 'shell', cmd: 'Start-Process ms-settings:display' },
  'network options': { tool: 'shell', cmd: 'Start-Process ms-settings:network' },
  'wifi options': { tool: 'shell', cmd: 'Start-Process ms-settings:network-wifi' },
  'date': { tool: 'shell', cmd: 'Get-Date' },
  'uptime': { tool: 'shell', cmd: '(Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime' },
  'device manager': { tool: 'shell', cmd: 'Start-Process devmgmt.msc' },
  'services': { tool: 'shell', cmd: 'Start-Process services.msc' },
  'event viewer': { tool: 'shell', cmd: 'Start-Process eventvwr.msc' },
  'disk management': { tool: 'shell', cmd: 'Start-Process diskmgmt.msc' },
  'environment variables': { tool: 'shell', cmd: 'Start-Process rundll32.exe sysdm.cpl,EditEnvironmentVariables' },
  'open camera': { tool: 'shell', cmd: 'Start-Process microsoft.windows.camera:' },
  'open settings': { tool: 'shell', cmd: 'Start-Process ms-settings:' },
  'wifi status': { tool: 'shell', cmd: 'netsh wlan show interfaces' },
  'battery status': { tool: 'shell', cmd: 'Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue' },
  'turn off screen': { tool: 'shell', cmd: '(Add-Type \'[DllImport("user32.dll")] public static extern int SendMessage(int hWnd, int hMsg, int wParam, int lParam);\' -Name a -PassThru)::SendMessage(-1, 0x0112, 0xF170, 2)' },
  'turn off monitor': { tool: 'shell', cmd: '(Add-Type \'[DllImport("user32.dll")] public static extern int SendMessage(int hWnd, int hMsg, int wParam, int lParam);\' -Name a -PassThru)::SendMessage(-1, 0x0112, 0xF170, 2)' },
  'turn on screen': { tool: 'shell', cmd: '(New-Object -ComObject WScript.Shell).SendKeys([char]0)' },
};

import { getAppShortcuts } from './shortcuts.js';

export function tryDeterministic(normalized: string): DeterministicAction | null {
  const norm = normalized.toLowerCase().trim();
  const directMatch = DETERMINISTIC_MAP[norm];
  if (directMatch) return directMatch;

  const openMatch = norm.match(/^(?:open|launch|start)\s+(.+)$/i);
  if (openMatch) {
    const appName = openMatch[1].trim();
    const shortcuts = getAppShortcuts();
    const shortcutPath = shortcuts.get(appName);
    if (shortcutPath) {
      return { tool: 'shell', cmd: `Start-Process "${shortcutPath}"` };
    }
  }

  return null;
}
