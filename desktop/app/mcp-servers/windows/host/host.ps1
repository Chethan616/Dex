# DEX's Windows host: one JSON request per line on stdin, one response per
# line on stdout (docs/desktop-control/PLAN.md §4.1.4).
#
#   → {"id":7,"op":"tree","args":{"window":{"process":"Spotify"}}}
#   ← {"id":7,"ok":true,"result":{…},"focus":{"incident":null}}
#
# UI work is DexDesk.cs (compiled once, cached by hash). This script adds the
# parts PowerShell does best: the media controls (WinRT) and read-only
# system diagnostics. It never changes the system.
param(
  [string]$DeskHome = (Join-Path $env:APPDATA 'DEX\desktop'),
  [string]$DexExe = '',
  # The elevated helper (docs/desktop-control/PLAN.md §6): started as
  # administrator by the DEX\Elevated scheduled task, it serves admin changes
  # on a loopback port to DEX only (the per-install secret), then exits idle.
  [switch]$Elevated
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
New-Item -ItemType Directory -Force $DeskHome | Out-Null

function Write-Line([string]$json) { [Console]::Out.WriteLine($json); [Console]::Out.Flush() }

# ── Changes to the PC (mcp-servers/windows/actions.mjs is the allowlist) ──
# Each returns what it did, what was there before, and how to undo it.
$script:AdminActions = @('ip_renew', 'adapter_restart', 'dns_set', 'device_restart', 'device_enable', 'device_disable', 'service_restart', 'winsock_reset', 'ip_stack_reset', 'restore_point', 'device_scan', 'search_reindex')
$script:GestureKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PrecisionTouchPad'

# Windows Search's own catalog API (searchapi.h): the item count and state that
# Indexing Options shows, and its Rebuild. Compiled only when first used.
function Initialize-SearchIndex {
  if ('DexSearchIndex' -as [type]) { return }
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DexSearchIndex {
  [ComImport, Guid("AB310581-AC80-11D1-8DF3-00C04FB6EF69"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISearchManager {
    void GetIndexerVersionStr([MarshalAs(UnmanagedType.LPWStr)] out string version);
    void GetIndexerVersion(out uint major, out uint minor);
    void GetParameter([MarshalAs(UnmanagedType.LPWStr)] string name, IntPtr value);
    void SetParameter([MarshalAs(UnmanagedType.LPWStr)] string name, IntPtr value);
    void get_ProxyName(IntPtr name);
    void get_BypassList(IntPtr list);
    void SetProxy(int usage, int local, uint port, [MarshalAs(UnmanagedType.LPWStr)] string proxy, [MarshalAs(UnmanagedType.LPWStr)] string bypass);
    ISearchCatalogManager GetCatalog([MarshalAs(UnmanagedType.LPWStr)] string catalog);
  }
  // Declared up to the last method used: COM calls by slot, so the order is the header's.
  [ComImport, Guid("AB310581-AC80-11D1-8DF3-00C04FB6EF50"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISearchCatalogManager {
    void get_Name(IntPtr name);
    void GetParameter([MarshalAs(UnmanagedType.LPWStr)] string name, IntPtr value);
    void SetParameter([MarshalAs(UnmanagedType.LPWStr)] string name, IntPtr value);
    void GetCatalogStatus(out int status, out int pausedReason);
    void Reset();
    void Reindex();
    void ReindexMatchingURLs([MarshalAs(UnmanagedType.LPWStr)] string pattern);
    void ReindexSearchRoot([MarshalAs(UnmanagedType.LPWStr)] string root);
    void put_ConnectTimeout(uint seconds);
    void get_ConnectTimeout(out uint seconds);
    void put_DataTimeout(uint seconds);
    void get_DataTimeout(out uint seconds);
    void NumberOfItems(out int count);
    void NumberOfItemsToIndex(out int incremental, out int notifications, out int highPriority);
  }
  static ISearchCatalogManager Catalog() {
    var t = Type.GetTypeFromCLSID(new Guid("7D096C5F-AC08-4F1F-BEB7-5C22C517CE39"));
    return ((ISearchManager)Activator.CreateInstance(t)).GetCatalog("SystemIndex");
  }
  public static int[] Status() {
    var c = Catalog();
    int status, reason, items, inc, ntf, hi;
    c.GetCatalogStatus(out status, out reason);
    c.NumberOfItems(out items);
    c.NumberOfItemsToIndex(out inc, out ntf, out hi);
    return new int[] { status, reason, items, inc + ntf + hi };
  }
  public static void Reset() { Catalog().Reset(); }
}
'@
}
$script:SearchData = Join-Path $env:ProgramData 'Microsoft\Search\Data\Applications\Windows'
$script:SearchIndexFile = '^Windows(-\w+)?\.(edb|db)$'
$script:ExplorerCacheFile = '^(thumbcache|iconcache)_.*\.db$'

# Startup apps, as Task Manager and Settings › Apps › Startup list them. The
# on/off switch is StartupApproved: an entry's first byte is even when on, odd when off.
$script:RunKeys = @(
  @{ scope = 'user'; key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'; approved = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' }
  @{ scope = 'machine'; key = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run'; approved = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' }
  @{ scope = 'machine'; key = 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'; approved = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32' }
)
$script:UserStartupApproved = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder'
function Test-StartupOn($approvedKey, [string]$name) {
  $v = (Get-ItemProperty -Path $approvedKey -Name $name -ErrorAction SilentlyContinue).$name
  if ($v -is [byte[]] -and $v.Length -gt 0) { return (($v[0] -band 1) -eq 0) }
  return $true
}

function Invoke-Change($a) {
  $p = $a.args
  switch ("$($a.action)") {
    'dns_flush' { Clear-DnsClientCache; return @{ done = $true } }
    'wifi_reconnect' {
      $profileName = if ($p.profile) { "$($p.profile)" } else {
        $line = (& netsh.exe wlan show interfaces) | Where-Object { $_ -match '^\s+Profile\s+:' } | Select-Object -First 1
        if ($line) { ($line -split ':', 2)[1].Trim() } else { $null }
      }
      if (-not $profileName) { throw [System.Exception]::new('no_profile|Not connected to Wi-Fi, so there is nothing to reconnect.|Give a profile name from system_info wifi.') }
      & netsh.exe wlan disconnect | Out-Null
      Start-Sleep -Seconds 2
      $out = (& netsh.exe wlan connect name="$profileName") | Out-String
      return @{ done = $true; profile = $profileName; said = $out.Trim() }
    }
    'explorer_restart' {
      Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 1200
      if (-not (Get-Process explorer -ErrorAction SilentlyContinue)) { Start-Process explorer.exe }
      return @{ done = $true }
    }
    'gesture_set' {
      $before = (Get-ItemProperty -Path $script:GestureKey -Name $p.key -ErrorAction SilentlyContinue).($p.key)
      Set-ItemProperty -Path $script:GestureKey -Name $p.key -Value ([uint32]$p.value) -Type DWord
      return @{ done = $true; before = $before; after = [uint32]$p.value
        undo = if ($null -ne $before) { @{ action = 'gesture_set'; args = @{ key = $p.key; value = [uint32]$before } } } else { $null }
        note = 'Windows applies gesture changes after you sign out, or after Explorer restarts (explorer_restart).' }
    }
    'touchpad_set' {
      $before = [DexDesk]::SetTouchpad("$($p.field)", "$($p.value)".ToLower())
      $undoValue = if ($before -eq 'true' -or $before -eq 'false') { $before -eq 'true' } else { [int]$before }
      return @{ done = $true; before = $before; after = $p.value; undo = @{ action = 'touchpad_set'; args = @{ field = $p.field; value = $undoValue } } }
    }
    'explorer_cache_clear' {
      # Explorer holds these files open, so it stops first and always comes back.
      $files = @(Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Explorer') -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $script:ExplorerCacheFile })
      $files += @(Get-Item -LiteralPath (Join-Path $env:LOCALAPPDATA 'IconCache.db') -Force -ErrorAction SilentlyContinue)
      $freed = 0; $removed = 0; $left = @()
      Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
      try {
        Start-Sleep -Milliseconds 800
        foreach ($pass in 1, 2) {
          $left = @()
          foreach ($f in $files) {
            if (-not (Test-Path -LiteralPath $f.FullName)) { continue }
            try { $len = $f.Length; Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop; $freed += $len; $removed += 1 } catch { $left += $f }
          }
          if (-not $left.Count) { break }
          Start-Sleep -Milliseconds 500
        }
      } finally {
        Start-Sleep -Milliseconds 400
        if (-not (Get-Process explorer -ErrorAction SilentlyContinue)) { Start-Process explorer.exe }
      }
      return @{ done = $true; filesRemoved = $removed; freedMB = [math]::Round($freed / 1MB, 1); stillInUse = $left.Count
        note = 'Windows makes the thumbnails and icons again as folders are opened, so the first visit to a big folder is a little slower.' }
    }
    'temp_clean' {
      # The user's own temp folder: files older than a day that nothing holds open.
      $cutoff = (Get-Date).AddDays(-1)
      $freed = 0; $removed = 0; $inUse = 0
      foreach ($f in @(Get-ChildItem -LiteralPath $env:TEMP -Recurse -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $cutoff })) {
        try { $len = $f.Length; Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop; $freed += $len; $removed += 1 } catch { $inUse += 1 }
      }
      # Folders left empty, deepest first.
      foreach ($d in @(Get-ChildItem -LiteralPath $env:TEMP -Recurse -Directory -Force -ErrorAction SilentlyContinue | Sort-Object { $_.FullName.Length } -Descending)) {
        if (-not (Get-ChildItem -LiteralPath $d.FullName -Force -ErrorAction SilentlyContinue)) { Remove-Item -LiteralPath $d.FullName -Force -ErrorAction SilentlyContinue }
      }
      return @{ done = $true; filesRemoved = $removed; freedMB = [math]::Round($freed / 1MB, 1); inUse = $inUse
        note = 'Apps make temporary files again as they need them.' }
    }
    'recycle_bin_empty' {
      $items = 0
      try { $items = @((New-Object -ComObject Shell.Application).Namespace(10).Items()).Count } catch {}
      Clear-RecycleBin -Force -ErrorAction SilentlyContinue
      return @{ done = $true; itemsRemoved = $items }
    }
    'app_close' {
      $name = "$($p.name)" -replace '\.exe$', ''
      $mine = (Get-Process -Id $PID).SessionId
      $procs = @(Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $mine })
      if (-not $procs.Count) { throw [System.Exception]::new("not_running|$name is not running.|Look up the exact name with system_info processes.") }
      # Asked nicely first (its window closes as if you had), then made to.
      foreach ($pr in $procs) { try { if ($pr.MainWindowHandle -ne [IntPtr]::Zero) { [void]$pr.CloseMainWindow() } } catch {} }
      Start-Sleep -Milliseconds 1500
      $closed = 0
      foreach ($pr in $procs) { try { $pr.Refresh(); if (-not $pr.HasExited) { Stop-Process -Id $pr.Id -Force -ErrorAction Stop }; $closed += 1 } catch {} }
      return @{ done = $true; name = $name; closed = $closed
        note = 'It can be opened again any time. If it starts with Windows, startup_disable stops that.' }
    }
    { $_ -in 'startup_disable', 'startup_enable' } {
      $on = "$($a.action)" -eq 'startup_enable'
      $name = "$($p.name)"
      # Only the user's own entries: their Run value, or a file in their Startup folder.
      $approved = $null
      if ($null -ne (Get-ItemProperty -Path $script:RunKeys[0].key -Name $name -ErrorAction SilentlyContinue)) { $approved = $script:RunKeys[0].approved }
      elseif (Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('Startup')) $name) -PathType Leaf) { $approved = $script:UserStartupApproved }
      else { throw [System.Exception]::new("not_found|`"$name`" isn't one of your own startup apps.|Use a name from system_info startup with canToggle:true; the others are switched in Settings > Apps > Startup (open_settings startupapps).") }
      $before = Test-StartupOn $approved $name
      if (-not (Test-Path $approved)) { New-Item -Path $approved -Force | Out-Null }
      # Task Manager's format: 02 = on; 03 = off, then when it was turned off.
      $bytes = New-Object byte[] 12
      $bytes[0] = if ($on) { 2 } else { 3 }
      if (-not $on) { [BitConverter]::GetBytes([DateTime]::UtcNow.ToFileTimeUtc()).CopyTo($bytes, 4) }
      Set-ItemProperty -Path $approved -Name $name -Value $bytes -Type Binary
      return @{ done = $true; name = $name; before = $before; after = $on
        undo = if ($before -ne $on) { @{ action = $(if ($before) { 'startup_enable' } else { 'startup_disable' }); args = @{ name = $name } } } else { $null }
        note = 'It takes effect the next time you sign in; an app already running stays open.' }
    }
    'app_reset' {
      $pkgs = @(Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object { -not $_.IsFramework -and ($_.Name -eq "$($p.package)" -or $_.PackageFamilyName -eq "$($p.package)") })
      if ($pkgs.Count -ne 1) { throw [System.Exception]::new("not_found|No single Store app is called `"$($p.package)`".|Use the package or family name from system_info app.") }
      if (-not (Get-Command Reset-AppxPackage -ErrorAction SilentlyContinue)) { throw [System.Exception]::new('unsupported|This version of Windows can''t reset apps from a script.|Tell the user: Settings > Apps > Installed apps > the app > Advanced options > Reset.') }
      Reset-AppxPackage -Package $pkgs[0].PackageFullName
      return @{ done = $true; package = $pkgs[0].Name; version = "$($pkgs[0].Version)"
        note = 'The app starts as if newly installed: the user signs in again (WhatsApp: link the phone again with the QR code).' }
    }
    'app_uninstall' {
      $out = (& winget.exe uninstall --id "$($p.wingetId)" --exact --silent --accept-source-agreements --disable-interactivity 2>&1) | Out-String
      return @{ done = ($LASTEXITCODE -eq 0); said = $out.Trim().Substring(0, [math]::Min(1500, $out.Trim().Length)); reinstall = "winget install --id $($p.wingetId) --exact" }
    }
    'ip_renew' {
      if ($p.adapter) { & ipconfig.exe /release "$($p.adapter)" | Out-Null; & ipconfig.exe /renew "$($p.adapter)" | Out-Null } else { & ipconfig.exe /release | Out-Null; & ipconfig.exe /renew | Out-Null }
      return @{ done = $true }
    }
    'adapter_restart' { Restart-NetAdapter -Name "$($p.name)" -Confirm:$false; return @{ done = $true } }
    'dns_set' {
      $before = @((Get-DnsClientServerAddress -InterfaceAlias "$($p.adapter)" -AddressFamily IPv4).ServerAddresses)
      $wasAuto = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\$((Get-NetAdapter -Name "$($p.adapter)").InterfaceGuid)" -Name NameServer -ErrorAction SilentlyContinue).NameServer -eq ''
      if ("$($p.servers)" -eq 'dhcp') { Set-DnsClientServerAddress -InterfaceAlias "$($p.adapter)" -ResetServerAddresses }
      else { Set-DnsClientServerAddress -InterfaceAlias "$($p.adapter)" -ServerAddresses @($p.servers) }
      return @{ done = $true; before = $before; undo = @{ action = 'dns_set'; args = @{ adapter = $p.adapter; servers = $(if ($wasAuto -or $before.Count -eq 0) { 'dhcp' } else { $before }) } } }
    }
    'device_restart' { & pnputil.exe /restart-device "$($p.instanceId)" | Out-Null; return @{ done = ($LASTEXITCODE -eq 0) } }
    'device_enable' { Enable-PnpDevice -InstanceId "$($p.instanceId)" -Confirm:$false; return @{ done = $true; undo = @{ action = 'device_disable'; args = @{ instanceId = $p.instanceId } } } }
    'device_disable' { Disable-PnpDevice -InstanceId "$($p.instanceId)" -Confirm:$false; return @{ done = $true; undo = @{ action = 'device_enable'; args = @{ instanceId = $p.instanceId } } } }
    'service_restart' { Restart-Service -Name "$($p.name)" -Force; return @{ done = $true } }
    'device_scan' {
      $out = (& pnputil.exe /scan-devices) | Out-String
      Start-Sleep -Seconds 3
      $problems = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.Status -ne 'OK' })
      return @{ done = ($LASTEXITCODE -eq 0); said = $out.Trim(); problemDevicesNow = $problems.Count }
    }
    'search_reindex' {
      # Indexing Options' own Rebuild. If the indexer is too stuck to answer,
      # the documented fix: stop it, remove the index files, start it again.
      $how = 'rebuild'
      try { Initialize-SearchIndex; [DexSearchIndex]::Reset() }
      catch {
        $how = 'fresh_files'
        Stop-Service -Name WSearch -Force
        Get-ChildItem -LiteralPath $script:SearchData -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $script:SearchIndexFile } | Remove-Item -Force
        Start-Service -Name WSearch
      }
      return @{ done = $true; how = $how; note = 'Windows rebuilds the index in the background: search finds fewer files until it finishes (minutes to a few hours, depending on how many files there are).' }
    }
    'winsock_reset' { $out = (& netsh.exe winsock reset) | Out-String; return @{ done = $true; restartNeeded = $true; said = $out.Trim() } }
    'ip_stack_reset' { $out = (& netsh.exe int ip reset) | Out-String; return @{ done = $true; restartNeeded = $true; said = $out.Trim() } }
    'restore_point' {
      Checkpoint-Computer -Description $(if ($p.description) { "$($p.description)" } else { 'DEX' }) -RestorePointType MODIFY_SETTINGS -WarningVariable warned -WarningAction SilentlyContinue
      return @{ done = $true; note = if ($warned) { "$warned" } else { $null } }
    }
    default { throw [System.Exception]::new("bad_args|Unknown change: $($a.action).|") }
  }
}

if ($Elevated) {
  # Only admin changes, only for DEX: a loopback port, the per-install secret
  # (in this user's profile, written by DEX), and an exit after 15 idle minutes.
  $secretFile = Join-Path $DeskHome 'elevated.secret'
  $portFile = Join-Path $DeskHome 'elevated.port'
  $secret = (Get-Content $secretFile -Raw -ErrorAction Stop).Trim()
  $listener = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback), 0
  $listener.Start()
  Set-Content -Path $portFile -Value $listener.LocalEndpoint.Port -Encoding ascii
  $idle = [Diagnostics.Stopwatch]::StartNew()
  try {
    while ($idle.Elapsed.TotalMinutes -lt 15) {
      if (-not $listener.Pending()) { Start-Sleep -Milliseconds 200; continue }
      $client = $listener.AcceptTcpClient()
      $idle.Restart()
      try {
        $stream = $client.GetStream()
        $reader = New-Object System.IO.StreamReader($stream, $utf8)
        $writer = New-Object System.IO.StreamWriter($stream, $utf8)
        $writer.AutoFlush = $true
        $req = $reader.ReadLine() | ConvertFrom-Json
        $reply = if ("$($req.secret)" -ne $secret) { @{ ok = $false; error = 'denied'; message = 'Not DEX.' } }
          elseif ($script:AdminActions -notcontains "$($req.action)") { @{ ok = $false; error = 'refused'; message = 'Not an admin change.' } }
          else {
            try { @{ ok = $true; result = (Invoke-Change $req) } }
            catch { $parts = "$($_.Exception.Message)" -split '\|', 3; @{ ok = $false; error = $(if ($parts.Count -ge 2) { $parts[0] } else { 'change_failed' }); message = $(if ($parts.Count -ge 2) { $parts[1] } else { "$($_.Exception.Message)" }) } }
          }
        $writer.WriteLine(($reply | ConvertTo-Json -Depth 8 -Compress))
      } catch { } finally { $client.Close() }
    }
  } finally {
    $listener.Stop()
    Remove-Item $portFile -Force -ErrorAction SilentlyContinue
  }
  exit 0
}

# ── The UI Automation interop, built from Windows' own type library ──────
# What tlbimp would make, generated here once per UIAutomationCore version:
# nothing downloaded, no binary in DEX's repo.
$core = Join-Path $env:SystemRoot 'System32\UIAutomationCore.dll'
$coreVersion = (Get-Item $core).VersionInfo.FileVersion -replace '[^0-9.]', ''
$interop = Join-Path $DeskHome "interop-$coreVersion\Interop.UIAutomationClient.dll"
if (-not (Test-Path $interop)) {
  Add-Type -TypeDefinition @'
using System;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
public static class DexInteropGen {
  [DllImport("oleaut32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void LoadTypeLibEx(string file, int regKind, out ITypeLib lib);
  class Sink : ITypeLibImporterNotifySink {
    public void ReportEvent(ImporterEventKind kind, int code, string msg) { }
    public Assembly ResolveRef(object typeLib) { return null; }
  }
  public static void Build(string core, string dir) {
    ITypeLib lib;
    LoadTypeLibEx(core, 2, out lib);
    var asm = new TypeLibConverter().ConvertTypeLibToAssembly(lib, System.IO.Path.Combine(dir, "Interop.UIAutomationClient.dll"), TypeLibImporterFlags.None, new Sink(), null, null, "Interop.UIAutomationClient", null);
    var prev = Environment.CurrentDirectory;
    Environment.CurrentDirectory = dir;
    try { asm.Save("Interop.UIAutomationClient.dll"); } finally { Environment.CurrentDirectory = prev; }
  }
}
'@
  # Built in a temp folder, then moved in: two tasks starting at once mustn't
  # half-write the same file.
  $tmp = Join-Path $DeskHome ("tmp-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force $tmp | Out-Null
  [DexInteropGen]::Build($core, $tmp)
  try { Move-Item $tmp (Split-Path $interop) -ErrorAction Stop } catch { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
[void][Reflection.Assembly]::LoadFrom($interop)

# ── DexDesk.cs, compiled once per source + interop ───────────────────────
$source = Join-Path $PSScriptRoot 'DexDesk.cs'
$sha = (Get-FileHash $source -Algorithm SHA256).Hash.Substring(0, 12).ToLower()
$dll = Join-Path $DeskHome "DexDesk-$sha-$coreVersion.dll"
if (-not (Test-Path $dll)) {
  $tmpDll = Join-Path $DeskHome ("DexDesk-" + [Guid]::NewGuid().ToString('N') + ".dll")
  Add-Type -Path $source -ReferencedAssemblies $interop, 'System.Drawing', 'System.Windows.Forms', 'System.Web.Extensions' -OutputAssembly $tmpDll -OutputType Library
  try { Move-Item $tmpDll $dll -ErrorAction Stop } catch { Remove-Item $tmpDll -Force -ErrorAction SilentlyContinue }
}
Add-Type -Path $dll
[DexDesk]::Init($DexExe, $DeskHome)

# ── Media: Windows' media controls (SMTC), no window needed ──────────────
$script:mediaReady = $false
function Initialize-Media {
  if ($script:mediaReady) { return }
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
  [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
  $script:mediaReady = $true
}
function Wait-Async($op, [Type]$type) {
  $task = $script:asTask.MakeGenericMethod($type).Invoke($null, @($op))
  [void]$task.Wait(8000)
  return $task.Result
}
function Get-MediaSessions {
  Initialize-Media
  $mgr = Wait-Async ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  return @{ Manager = $mgr; Sessions = @($mgr.GetSessions()) }
}
function Format-MediaSession($s) {
  $props = $null
  try { $props = Wait-Async ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]) } catch { }
  $info = $s.GetPlaybackInfo()
  $c = $info.Controls
  return [ordered]@{
    app      = $s.SourceAppUserModelId
    title    = if ($props) { $props.Title } else { $null }
    artist   = if ($props) { $props.Artist } else { $null }
    album    = if ($props) { $props.AlbumTitle } else { $null }
    playback = "$($info.PlaybackStatus)".ToLower()
    shuffle  = $info.IsShuffleActive
    repeat   = if ($null -ne $info.AutoRepeatMode) { "$($info.AutoRepeatMode)".ToLower() } else { $null }
    can      = [ordered]@{ play = $c.IsPlayEnabled; pause = $c.IsPauseEnabled; next = $c.IsNextEnabled; previous = $c.IsPreviousEnabled; shuffle = $c.IsShuffleEnabled; repeat = $c.IsRepeatEnabled }
  }
}
function Invoke-Media($a) {
  $all = Get-MediaSessions
  $action = "$($a.action)"
  if ($action -eq 'status' -or -not $action) {
    return @{ sessions = @($all.Sessions | ForEach-Object { Format-MediaSession $_ }) }
  }
  $s = $null
  if ($a.app) { $s = $all.Sessions | Where-Object { $_.SourceAppUserModelId -like "*$($a.app)*" } | Select-Object -First 1 }
  if (-not $s) { $s = $all.Manager.GetCurrentSession() }
  if (-not $s) { throw [System.Exception]::new('no_session|Nothing is playing or paused right now.|Start the app first (app_launch), then play something.') }
  $before = Format-MediaSession $s
  $op = switch ($action) {
    'play' { $s.TryPlayAsync() }
    'pause' { $s.TryPauseAsync() }
    'toggle' { $s.TryTogglePlayPauseAsync() }
    'next' { $s.TrySkipNextAsync() }
    'previous' { $s.TrySkipPreviousAsync() }
    'shuffle' { $s.TryChangeShuffleActiveAsync([bool]($a.value -ne $false)) }
    'repeat' {
      $mode = switch ("$($a.value)") { 'track' { 1 } 'list' { 2 } default { 0 } }
      $s.TryChangeAutoRepeatModeAsync([Windows.Media.MediaPlaybackAutoRepeatMode]$mode)
    }
    default { throw [System.Exception]::new("bad_args|Unknown media action: $action.|") }
  }
  $accepted = Wait-Async $op ([bool])
  Start-Sleep -Milliseconds 300
  $after = Format-MediaSession $s
  return [ordered]@{ accepted = $accepted; before = $before; after = $after }
}

# ── System: read-only diagnostics ────────────────────────────────────────
function Test-Tcp([string]$hostName, [int]$port, [int]$ms = 2500) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $ok = $c.ConnectAsync($hostName, $port).Wait($ms); return ($ok -and $c.Connected) } catch { return $false } finally { $c.Dispose() }
}
function Get-NetworkInfo {
  $adapters = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.HardwareInterface } | ForEach-Object {
    $cfg = Get-NetIPConfiguration -InterfaceIndex $_.ifIndex -ErrorAction SilentlyContinue
    $ip4 = @($cfg.IPv4Address | ForEach-Object { $_.IPAddress })
    $dhcp = (Get-NetIPInterface -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).Dhcp
    [ordered]@{
      name = $_.Name; description = $_.InterfaceDescription; status = "$($_.Status)"; linkSpeed = "$($_.LinkSpeed)"
      driver = "$($_.DriverVersion)"; driverDate = "$($_.DriverDate)"
      ipv4 = $ip4; apipa = [bool]($ip4 | Where-Object { $_ -like '169.254.*' }); dhcp = "$dhcp"
      gateway = @($cfg.IPv4DefaultGateway | ForEach-Object { $_.NextHop })
      dns = @((Get-DnsClientServerAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).ServerAddresses)
    }
  })
  $gw = ($adapters | Where-Object { $_.status -eq 'Up' } | ForEach-Object { $_.gateway } | Select-Object -First 1)
  $dnsOk = $false; try { $dnsOk = @([System.Net.Dns]::GetHostAddresses('www.msftconnecttest.com')).Count -gt 0 } catch { }
  $proxy = $null; try { $p = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction Stop; $proxy = [ordered]@{ enabled = [bool]$p.ProxyEnable; server = $p.ProxyServer; autoConfig = $p.AutoConfigURL } } catch { }
  return [ordered]@{
    adapters = $adapters
    gatewayReachable = if ($gw) { Test-Connection -ComputerName $gw -Count 1 -Quiet -ErrorAction SilentlyContinue } else { $false }
    dnsResolves = $dnsOk
    internetReachable = (Test-Tcp '1.1.1.1' 443)
    proxy = $proxy
  }
}
function Get-WifiInfo {
  $raw = (& netsh.exe wlan show interfaces) 2>&1 | Out-String
  if ($raw -match 'location permission|Location services') {
    return [ordered]@{ locationBlocked = $true; note = 'Windows hides Wi-Fi details until location is allowed: Settings > Privacy & security > Location.' }
  }
  $fields = [ordered]@{}
  foreach ($line in ($raw -split "`r?`n")) {
    if ($line -match '^\s{4}([^:]+?)\s*:\s(.*)$') { $fields[$Matches[1].Trim()] = $Matches[2].Trim() }
  }
  # Hardware identifiers aren't diagnostics: keep them out of what the model sees.
  foreach ($k in @($fields.Keys)) { if ($k -match 'BSSID|GUID|Physical address') { $fields.Remove($k) } }
  return [ordered]@{ locationBlocked = $false; interface = $fields }
}
function Get-WlanEvents([int]$hours = 24) {
  $since = (Get-Date).AddHours(-$hours)
  $ev = @(Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-WLAN-AutoConfig/Operational'; StartTime = $since } -ErrorAction SilentlyContinue)
  $byId = [ordered]@{}; foreach ($g in ($ev | Group-Object Id)) { $byId["$($g.Name)"] = $g.Count }
  $drops = @($ev | Where-Object { $_.Id -eq 8003 })
  return [ordered]@{
    hours = $hours; total = $ev.Count; countsById = $byId
    disconnects = $drops.Count; disconnectsPerHour = [math]::Round($drops.Count / [math]::Max(1, $hours), 2)
    lastDisconnects = @($drops | Select-Object -First 10 | ForEach-Object { [ordered]@{ at = $_.TimeCreated.ToString('o'); message = (($_.Message -split "`r?`n") | Select-Object -First 4) -join ' ' } })
  }
}
function Get-DeviceList([string]$class) {
  $list = if ($class) { Get-PnpDevice -Class $class -ErrorAction SilentlyContinue } else { Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.Status -ne 'OK' } }
  return @{ devices = @($list | Select-Object -First 80 | ForEach-Object { [ordered]@{ name = $_.FriendlyName; class = $_.Class; status = "$($_.Status)"; problem = "$($_.Problem)"; instanceId = $_.InstanceId } }) }
}
function Get-DriverInfo([string]$instanceId) {
  if (-not $instanceId) { throw [System.Exception]::new('bad_args|driver needs an instanceId (from system_info devices).|') }
  $p = @{}
  foreach ($k in 'DEVPKEY_Device_DriverProvider', 'DEVPKEY_Device_DriverVersion', 'DEVPKEY_Device_DriverDate', 'DEVPKEY_Device_DriverInfPath', 'DEVPKEY_Device_DriverDesc') {
    $v = (Get-PnpDeviceProperty -InstanceId $instanceId -KeyName $k -ErrorAction SilentlyContinue).Data
    $p[$k -replace 'DEVPKEY_Device_Driver', ''] = if ($v -is [datetime]) { $v.ToString('yyyy-MM-dd') } else { "$v" }
  }
  return $p
}
function Get-TouchpadInfo {
  $params = [DexDesk]::Call('touchpad', '{}') | ConvertFrom-Json
  $gest = [ordered]@{}
  $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PrecisionTouchPad'
  if (Test-Path $key) { (Get-ItemProperty $key).PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object { $gest[$_.Name] = $_.Value } }
  $status = $null; if (Test-Path "$key\Status") { $status = (Get-ItemProperty "$key\Status").Enabled }
  $devices = @(Get-PnpDevice -Class HIDClass, Mouse -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match 'touch ?pad|precision|I2C HID|mouse' } | ForEach-Object { [ordered]@{ name = $_.FriendlyName; status = "$($_.Status)"; instanceId = $_.InstanceId } })
  $utilities = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'synaptics|syntp|elan|etd|alps|apoint|asus.*touch|lenovo.*touch|dell.*touch' } | ForEach-Object { $_.ProcessName } | Select-Object -Unique)
  return [ordered]@{ parameters = $params.result; gestureSettings = $gest; precisionEnabled = $status; devices = $devices; vendorUtilities = $utilities }
}
function Get-AppList([string]$filter) {
  $keys = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
  $apps = @(Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and (-not $filter -or $_.DisplayName -like "*$filter*") } | ForEach-Object {
    [ordered]@{ name = $_.DisplayName; version = $_.DisplayVersion; publisher = $_.Publisher; scope = if ($_.PSPath -like '*HKEY_CURRENT_USER*') { 'user' } else { 'machine' } }
  })
  $store = @(Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object { -not $_.IsFramework -and (-not $filter -or $_.Name -like "*$filter*") } | Select-Object -First 200 | ForEach-Object { [ordered]@{ name = $_.Name; version = "$($_.Version)"; publisher = $_.PublisherId; scope = 'store' } })
  $start = @(); try { $start = @(Get-StartApps | Where-Object { -not $filter -or $_.Name -like "*$filter*" } | Select-Object -First 100 | ForEach-Object { [ordered]@{ name = $_.Name; appId = $_.AppID } }) } catch { }
  return [ordered]@{ installed = @($apps | Select-Object -First 300); store = $store; startMenu = $start }
}
$allowedLogs = @{
  system = @{ LogName = 'System' }
  wlan = @{ LogName = 'Microsoft-Windows-WLAN-AutoConfig/Operational' }
  ncsi = @{ LogName = 'Microsoft-Windows-NCSI/Operational' }
  dhcp = @{ LogName = 'Microsoft-Windows-Dhcp-Client/Admin' }
  pnp = @{ LogName = 'Microsoft-Windows-Kernel-PnP/Configuration' }
  apperrors = @{ LogName = 'Application'; Level = 2 }
}
function Get-EventInfo($a) {
  $which = "$($a.log)"; if (-not $allowedLogs.ContainsKey($which)) { throw [System.Exception]::new("bad_args|log is one of: $($allowedLogs.Keys -join ', ').|") }
  $f = $allowedLogs[$which].Clone(); $f['StartTime'] = (Get-Date).AddHours(-[math]::Min(168, [math]::Max(1, [int]($a.hours | ForEach-Object { if ($_) { $_ } else { 24 } }))))
  $ev = @(Get-WinEvent -FilterHashtable $f -MaxEvents 400 -ErrorAction SilentlyContinue)
  if ($a.provider) { $ev = @($ev | Where-Object { $_.ProviderName -like "*$($a.provider)*" }) }
  return [ordered]@{
    total = $ev.Count
    latest = @($ev | Select-Object -First ([math]::Min(30, [int]($a.limit | ForEach-Object { if ($_) { $_ } else { 15 } }))) | ForEach-Object {
      [ordered]@{ at = $_.TimeCreated.ToString('o'); id = $_.Id; level = "$($_.LevelDisplayName)"; provider = $_.ProviderName; message = (($_.Message -split "`r?`n") | Select-Object -First 3) -join ' ' }
    })
  }
}
function Get-ProcessInfo {
  # CPU now, not since boot: two samples a second apart.
  $first = @{}; foreach ($p in Get-Process -ErrorAction SilentlyContinue) { try { $first[$p.Id] = $p.TotalProcessorTime.TotalMilliseconds } catch { } }
  $clock = [Diagnostics.Stopwatch]::StartNew()
  Start-Sleep -Milliseconds 1000
  $elapsed = $clock.Elapsed.TotalMilliseconds * [Environment]::ProcessorCount
  # One row per app: Chrome's thirty processes are one Chrome. No window
  # titles: what the user has open isn't a diagnosis.
  $rows = @{}
  foreach ($p in Get-Process -ErrorAction SilentlyContinue) {
    if ($p.Id -eq 0) { continue }
    $cpu = 0.0; try { if ($first.ContainsKey($p.Id)) { $cpu = ($p.TotalProcessorTime.TotalMilliseconds - $first[$p.Id]) / $elapsed * 100 } } catch { }
    $name = $p.ProcessName
    if (-not $rows.ContainsKey($name)) { $rows[$name] = @{ processes = 0; cpu = 0.0; memory = 0.0 } }
    $r = $rows[$name]; $r.processes += 1; $r.cpu += $cpu; $r.memory += $p.WorkingSet64 / 1MB
  }
  $all = @($rows.GetEnumerator() | ForEach-Object { [pscustomobject][ordered]@{ name = $_.Key; processes = $_.Value.processes; cpuPercent = [math]::Round($_.Value.cpu, 1); memoryMB = [math]::Round($_.Value.memory) } })
  $os = Get-CimInstance Win32_OperatingSystem
  $totalMB = [math]::Round($os.TotalVisibleMemorySize / 1KB); $freeMB = [math]::Round($os.FreePhysicalMemory / 1KB)
  return [ordered]@{
    cpuPercent = [math]::Round(($all | Measure-Object cpuPercent -Sum).Sum, 1)
    memory = [ordered]@{ totalMB = $totalMB; usedMB = $totalMB - $freeMB; usedPercent = [math]::Round(($totalMB - $freeMB) / [math]::Max(1, $totalMB) * 100) }
    uptimeHours = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1)
    byCpu = @($all | Sort-Object cpuPercent -Descending | Select-Object -First 15)
    byMemory = @($all | Sort-Object memoryMB -Descending | Select-Object -First 15)
  }
}
function Get-StartupInfo {
  $items = New-Object System.Collections.ArrayList
  foreach ($k in $script:RunKeys) {
    $props = Get-ItemProperty -Path $k.key -ErrorAction SilentlyContinue
    if (-not $props) { continue }
    foreach ($p in $props.PSObject.Properties) {
      if ($p.Name -like 'PS*') { continue }
      $cmd = "$($p.Value)"
      [void]$items.Add([ordered]@{ name = $p.Name; enabled = (Test-StartupOn $k.approved $p.Name); scope = $k.scope; command = $cmd.Substring(0, [math]::Min(200, $cmd.Length)); canToggle = ($k.scope -eq 'user') })
    }
  }
  $folders = @(
    @{ scope = 'user'; dir = [Environment]::GetFolderPath('Startup'); approved = $script:UserStartupApproved }
    @{ scope = 'machine'; dir = [Environment]::GetFolderPath('CommonStartup'); approved = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder' }
  )
  foreach ($f in $folders) {
    foreach ($file in @(Get-ChildItem -LiteralPath $f.dir -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'desktop.ini' })) {
      [void]$items.Add([ordered]@{ name = $file.Name; enabled = (Test-StartupOn $f.approved $file.Name); scope = $f.scope; command = $file.FullName; canToggle = ($f.scope -eq 'user') })
    }
  }
  # Store apps (WhatsApp, Teams, Spotify from the Store) have startup tasks of
  # their own, switched in Settings › Apps › Startup.
  $root = 'HKCU:\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\SystemAppData'
  foreach ($pkg in @(Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)) {
    foreach ($task in @(Get-ChildItem -LiteralPath $pkg.PSPath -ErrorAction SilentlyContinue)) {
      $state = (Get-ItemProperty -LiteralPath $task.PSPath -Name State -ErrorAction SilentlyContinue).State
      if ($null -eq $state) { continue }
      # 2 on, 4 on by policy; 0, 1 and 3 are off (by the user, the app, or policy).
      [void]$items.Add([ordered]@{ name = $pkg.PSChildName; task = $task.PSChildName; enabled = ($state -eq 2 -or $state -eq 4); scope = 'store'; canToggle = $false })
    }
  }
  return [ordered]@{ items = @($items); note = 'Entries with canToggle:false are switched by the user in Settings > Apps > Startup (open_settings "startupapps").' }
}
function Get-DiskInfo {
  $drives = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
    [ordered]@{ drive = $_.DeviceID; label = $_.VolumeName; fileSystem = $_.FileSystem
      sizeGB = [math]::Round($_.Size / 1GB, 1); freeGB = [math]::Round($_.FreeSpace / 1GB, 1)
      freePercent = if ($_.Size) { [math]::Round($_.FreeSpace / $_.Size * 100) } else { $null } }
  })
  $physical = @(); try { $physical = @(Get-PhysicalDisk -ErrorAction Stop | ForEach-Object { [ordered]@{ name = $_.FriendlyName; media = "$($_.MediaType)"; bus = "$($_.BusType)"; health = "$($_.HealthStatus)"; sizeGB = [math]::Round($_.Size / 1GB) } }) } catch { }
  return [ordered]@{ drives = $drives; physical = $physical }
}
$script:CatalogStatus = @('idle', 'paused', 'recovering', 'full_crawl', 'incremental_crawl', 'processing_notifications', 'shutting_down')
$script:PausedReason = @('none', 'high_io', 'high_cpu', 'high_notification_rate', 'low_battery', 'low_memory', 'low_disk', 'delayed_recovery', 'user_active', 'external', 'upgrading')
function Get-SearchInfo {
  $svc = Get-Service -Name WSearch -ErrorAction SilentlyContinue
  $index = $null
  if ($svc -and "$($svc.Status)" -eq 'Running') {
    try {
      Initialize-SearchIndex
      $s = [DexSearchIndex]::Status()
      $index = [ordered]@{ items = $s[2]; waiting = $s[3]; state = $script:CatalogStatus[$s[0]]; pausedBecause = if ($s[0] -eq 1) { $script:PausedReason[$s[1]] } else { $null } }
    } catch { $index = @{ error = "The indexer didn't answer: $($_.Exception.Message)" } }
  }
  # Readable only as administrator on most PCs; empty otherwise.
  $files = @(Get-ChildItem -LiteralPath $script:SearchData -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $script:SearchIndexFile } | ForEach-Object { [ordered]@{ name = $_.Name; sizeMB = [math]::Round($_.Length / 1MB) } })
  $indexer = Get-Process -Name SearchIndexer -ErrorAction SilentlyContinue | Select-Object -First 1
  $cache = @(Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Explorer') -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $script:ExplorerCacheFile })
  return [ordered]@{
    service = if ($svc) { [ordered]@{ status = "$($svc.Status)".ToLower(); startType = "$($svc.StartType)".ToLower() } } else { $null }
    index = $index
    indexFiles = $files
    indexerMemoryMB = if ($indexer) { [math]::Round($indexer.WorkingSet64 / 1MB) } else { $null }
    explorerCache = [ordered]@{ files = $cache.Count; sizeMB = [math]::Round(($cache | Measure-Object Length -Sum).Sum / 1MB, 1) }
  }
}
function Get-AppInfo([string]$name) {
  if (-not $name) { throw [System.Exception]::new('bad_args|app needs a name, e.g. "WhatsApp".|') }
  $keys = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
  $desktop = @(Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "*$name*" } | Select-Object -First 5 | ForEach-Object {
    [ordered]@{ name = $_.DisplayName; version = $_.DisplayVersion; publisher = $_.Publisher; location = $_.InstallLocation; installed = $_.InstallDate; scope = if ($_.PSPath -like '*HKEY_CURRENT_USER*') { 'user' } else { 'machine' } }
  })
  $store = @(Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object { -not $_.IsFramework -and ($_.Name -like "*$name*" -or $_.PackageFamilyName -like "*$name*") } | Select-Object -First 5 | ForEach-Object {
    $dataMB = $null; try { $dataMB = [math]::Round((Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA "Packages\$($_.PackageFamilyName)") -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB) } catch { }
    [ordered]@{ package = $_.Name; family = $_.PackageFamilyName; version = "$($_.Version)"; location = $_.InstallLocation; status = "$($_.Status)"; dataMB = $dataMB }
  })
  $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like "*$name*" } | Group-Object ProcessName | ForEach-Object {
    $oldest = $null; try { $oldest = ($_.Group | Sort-Object StartTime | Select-Object -First 1).StartTime } catch { }
    [ordered]@{ process = $_.Name; count = $_.Count; memoryMB = [math]::Round(($_.Group | Measure-Object WorkingSet64 -Sum).Sum / 1MB); runningMinutes = if ($oldest) { [math]::Round(((Get-Date) - $oldest).TotalMinutes) } else { $null } }
  })
  if (-not $desktop.Count -and -not $store.Count) { throw [System.Exception]::new("not_found|No installed app matches `"$name`".|Try a shorter name, or system_info apps with a filter.") }
  return [ordered]@{ desktop = $desktop; store = $store; running = $running }
}
function Invoke-Sys($a) {
  switch ("$($a.topic)") {
    'network' { return Get-NetworkInfo }
    'wifi' { return Get-WifiInfo }
    'wlan_events' { return Get-WlanEvents ([int]($(if ($a.hours) { $a.hours } else { 24 }))) }
    'devices' { return Get-DeviceList "$($a.class)" }
    'driver' { return Get-DriverInfo "$($a.instanceId)" }
    'touchpad' { return Get-TouchpadInfo }
    'apps' { return Get-AppList "$($a.filter)" }
    'events' { return Get-EventInfo $a }
    'processes' { return Get-ProcessInfo }
    'startup' { return Get-StartupInfo }
    'disk' { return Get-DiskInfo }
    'search' { return Get-SearchInfo }
    'app' { return Get-AppInfo "$($a.name)" }
    default { throw [System.Exception]::new('bad_args|topic is one of: network, wifi, wlan_events, devices, driver, touchpad, apps, events, processes, startup, disk, search, app.|') }
  }
}

function Send-Result($id, $result) {
  $body = [ordered]@{ id = $id; ok = $true; result = $result }
  [DexDesk]::Emit(($body | ConvertTo-Json -Depth 10 -Compress))
}
function Send-Error($id, [string]$text) {
  # Errors thrown here are "code|message|hint".
  $parts = $text -split '\|', 3
  $body = if ($parts.Count -ge 2) { [ordered]@{ id = $id; ok = $false; error = $parts[0]; message = $parts[1]; hint = if ($parts.Count -ge 3 -and $parts[2]) { $parts[2] } else { $null } } }
          else { [ordered]@{ id = $id; ok = $false; error = 'host_error'; message = $text } }
  [DexDesk]::Emit(($body | ConvertTo-Json -Depth 4 -Compress))
}

[DexDesk]::Emit('{"event":"ready","version":"' + [DexDesk]::Version + '"}')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  $answer = [DexDesk]::Handle($line)
  if ($null -ne $answer) { [DexDesk]::Emit($answer); continue }
  $req = $line | ConvertFrom-Json
  try {
    switch ("$($req.op)") {
      'media' { Send-Result $req.id (Invoke-Media $req.args) }
      'sys' { Send-Result $req.id (Invoke-Sys $req.args) }
      'change' {
        if ($script:AdminActions -contains "$($req.args.action)") { Send-Error $req.id 'needs_admin|That change needs the elevated helper.|' }
        else { Send-Result $req.id (Invoke-Change $req.args) }
      }
      'shutdown' { Send-Result $req.id @{ bye = $true }; exit 0 }
      default { Send-Error $req.id "unknown_op|Unknown op: $($req.op)|" }
    }
  } catch {
    Send-Error $req.id $_.Exception.Message
  }
}
