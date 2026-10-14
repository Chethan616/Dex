# DEX's Desk tab: "Show me" and "Hand back" (docs/desktop-control/PLAN.md
# §Phase 3). One window, one move, then it exits.
#
# DEX starts this the moment you click, so it's a process the foreground app
# just started — the one kind Windows lets bring a window to the front
# (Electron has no way to hand that right to another process).
#
#   show: put the window on the screen DEX is on and bring it to the front.
#   park: put a window DEX opened back off-screen, without activating it.
#
# Prints one line of JSON: {"ok":true,...} or {"ok":false,"error":"..."}.
param(
  [ValidateSet('show', 'park')][string]$Op,
  [long]$Hwnd,
  [string]$DexExe = '',
  [string]$DeskHome = (Join-Path $env:APPDATA 'DEX\desktop'),
  # Where "show" puts it: "x,y,width,height" in physical pixels — the work
  # area of the screen DEX is on. Empty: the primary screen.
  [string]$Area = ''
)
$ErrorActionPreference = 'Stop'

$source = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class DexWindow {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct WINDOWPLACEMENT { public int length; public int flags; public int showCmd; public POINT ptMinPosition; public POINT ptMaxPosition; public RECT rcNormalPosition; }

  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowPlacement(IntPtr h, ref WINDOWPLACEMENT p);
  [DllImport("user32.dll")] static extern bool SetWindowPlacement(IntPtr h, ref WINDOWPLACEMENT p);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint action, uint param, ref RECT r, uint winIni);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int value, int size);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder s, ref int size);

  const int SW_SHOWNORMAL = 1, SW_SHOWNOACTIVATE = 4, SW_MINIMIZE = 6;
  const uint SPI_GETWORKAREA = 0x0030;

  static string ImagePath(IntPtr h) {
    uint pid; GetWindowThreadProcessId(h, out pid);
    IntPtr p = OpenProcess(0x1000 /* QUERY_LIMITED_INFORMATION */, false, pid);
    if (p == IntPtr.Zero) return null;
    try { var sb = new StringBuilder(1024); int size = sb.Capacity; return QueryFullProcessImageName(p, 0, sb, ref size) ? sb.ToString() : null; }
    finally { CloseHandle(p); }
  }

  static string Fail(string why) { return "{\"ok\":false,\"error\":\"" + why + "\"}"; }

  public static string Run(string op, long hwnd, string dexExe, string area) {
    SetThreadDpiAwarenessContext(new IntPtr(-4));   // physical pixels, like the rest of DEX's helper
    var h = new IntPtr(hwnd);
    if (hwnd == 0 || !IsWindow(h)) return Fail("closed");
    string path = ImagePath(h);
    if (path == null) return Fail("unreachable");   // runs as administrator: out of reach anyway
    if (!string.IsNullOrEmpty(dexExe) && string.Equals(path, dexExe, StringComparison.OrdinalIgnoreCase)) return Fail("refused");

    var wp = new WINDOWPLACEMENT { length = Marshal.SizeOf(typeof(WINDOWPLACEMENT)) };
    if (!GetWindowPlacement(h, ref wp)) return Fail("unreachable");
    int w = wp.rcNormalPosition.Right - wp.rcNormalPosition.Left, ht = wp.rcNormalPosition.Bottom - wp.rcNormalPosition.Top;
    // Placement rects are in workspace coordinates: the primary work area's corner is 0,0.
    var work = new RECT(); SystemParametersInfo(SPI_GETWORKAREA, 0, ref work, 0);

    if (op == "park") {
      // As DEX's helper parks (DexDesk.cs Park): SetWindowPos, because Windows
      // pulls a placement that's wholly off-screen back onto the screen's edge.
      int noAnim = 1;
      DwmSetWindowAttribute(h, 3 /* TRANSITIONS_FORCEDISABLED */, ref noAnim, 4);
      if (IsIconic(h)) ShowWindow(h, SW_SHOWNOACTIVATE);
      int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78);
      SetWindowPos(h, IntPtr.Zero, vx + vw + 200, vy, 0, 0, 0x0001 | 0x0004 | 0x0010 /* NOSIZE | NOZORDER | NOACTIVATE */);
      if (GetForegroundWindow() == h) {
        // Hands the front back: minimizing activates the window the user was in (on its own thread, a moment later).
        ShowWindow(h, SW_MINIMIZE);
        for (int i = 0; i < 15 && GetForegroundWindow() == h; i++) System.Threading.Thread.Sleep(20);
        System.Threading.Thread.Sleep(120);   // restored any sooner, some apps (WinForms) take the front straight back
        ShowWindow(h, SW_SHOWNOACTIVATE);
      }
      noAnim = 0;
      DwmSetWindowAttribute(h, 3, ref noAnim, 4);
      return "{\"ok\":true,\"parked\":true}";
    }

    int ax = 0, ay = 0, aw = GetSystemMetrics(0), ah = GetSystemMetrics(1);
    var parts = (area ?? "").Split(',');
    if (parts.Length == 4) {
      int x, y, ww, hh;
      if (int.TryParse(parts[0], out x) && int.TryParse(parts[1], out y) && int.TryParse(parts[2], out ww) && int.TryParse(parts[3], out hh) && ww > 100 && hh > 100) { ax = x; ay = y; aw = ww; ah = hh; }
    }
    if (w <= 200 || w > aw) w = Math.Min(aw, Math.Max(w, 900));
    if (ht <= 150 || ht > ah) ht = Math.Min(ah, Math.Max(ht, 600));
    int left = ax + (aw - w) / 2 - work.Left, top = ay + (ah - ht) / 2 - work.Top;
    wp.rcNormalPosition = new RECT { Left = left, Top = top, Right = left + w, Bottom = top + ht };
    wp.showCmd = SW_SHOWNORMAL; wp.flags = 0;
    SetWindowPlacement(h, ref wp);
    SetForegroundWindow(h);
    // Activation lands on the window's own thread a moment later.
    for (int i = 0; i < 10 && GetForegroundWindow() != h; i++) System.Threading.Thread.Sleep(30);
    return "{\"ok\":true,\"foreground\":" + (GetForegroundWindow() == h ? "true" : "false") + "}";
  }
}
'@

try {
  # Compiled once per version of this file, like DexDesk.cs.
  $sha = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($source))).Replace('-', '').Substring(0, 12).ToLower()
  New-Item -ItemType Directory -Force $DeskHome | Out-Null
  $dll = Join-Path $DeskHome "DexWindow-$sha.dll"
  if (-not (Test-Path $dll)) {
    $tmp = Join-Path $DeskHome ("DexWindow-" + [Guid]::NewGuid().ToString('N') + ".dll")
    Add-Type -TypeDefinition $source -OutputAssembly $tmp -OutputType Library
    try { Move-Item $tmp $dll -ErrorAction Stop } catch { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
  }
  Add-Type -Path $dll
  [Console]::Out.WriteLine([DexWindow]::Run($Op, $Hwnd, $DexExe, $Area))
} catch {
  [Console]::Out.WriteLine('{"ok":false,"error":"helper_failed"}')
  exit 1
}
