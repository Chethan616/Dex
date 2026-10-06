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
$script:AdminActions = @('ip_renew', 'adapter_restart', 'dns_set', 'device_restart', 'device_enable', 'device_disable', 'service_restart', 'winsock_reset', 'ip_stack_reset', 'restore_point')
$script:GestureKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PrecisionTouchPad'

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
  Add-Type -Path $source -ReferencedAssemblies $interop, 'System.Drawing', 'System.Web.Extensions' -OutputAssembly $tmpDll -OutputType Library
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
    return [ordered]@{ locationBlocked = $true; note = 'Windows hides Wi-Fi details until location is allowed: Settings › Privacy & security › Location.' }
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
    default { throw [System.Exception]::new('bad_args|topic is one of: network, wifi, wlan_events, devices, driver, touchpad, apps, events.|') }
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
