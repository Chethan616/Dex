<#
  DEX ⇄ phone: one-time Firebase setup.

  Creates (or reuses) a Firebase project, registers the Android app and the
  desktop's web app, writes their configs where the builds read them, adds
  your debug signing key, enables Email/Password sign-in, and
  deploys the Firestore rules. Everything runs on the free Spark plan: no
  billing account, no Cloud Functions, no Cloud Storage.

  Run from the repo root:   powershell -ExecutionPolicy Bypass -File firebase\setup.ps1
  Re-running is safe; existing apps are reused.
#>
param(
  [string]$ProjectId = "dexv3-chethan616",
  [string]$Location = "asia-south1"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $PSScriptRoot

function Step($t) { Write-Host "`n▸ $t" -ForegroundColor Cyan }
function Fb { & firebase @args; if ($LASTEXITCODE -ne 0) { throw "firebase $($args -join ' ') failed" } }

Step "Signing in to Firebase (a browser window opens if needed)"
& firebase login

if (-not $ProjectId) {
  $ProjectId = Read-Host "Firebase project id to create or reuse (e.g. dex-$($env:USERNAME.ToLower())-app)"
}
$existing = (& firebase projects:list --json | ConvertFrom-Json).result | Where-Object { $_.projectId -eq $ProjectId }
if (-not $existing) {
  Step "Creating project $ProjectId"
  Fb projects:create $ProjectId --display-name "DEX"
}
Fb use $ProjectId
(Get-Content .firebaserc -Raw) -replace '"default": "[^"]*"', "`"default`": `"$ProjectId`"" | Set-Content .firebaserc -Encoding utf8

Step "Registering the Android app (com.chethan616.dex)"
$apps = (& firebase apps:list --json | ConvertFrom-Json).result
$android = $apps | Where-Object { $_.platform -eq "ANDROID" -and $_.namespace -eq "com.chethan616.dex" } | Select-Object -First 1
if (-not $android) {
  $android = (& firebase apps:create ANDROID "DEX Android" --package-name com.chethan616.dex --json | ConvertFrom-Json).result
}
& firebase apps:sdkconfig ANDROID $android.appId --out (Join-Path $root "android\app\google-services.json")

Step "Adding your debug signing key"
$keystore = Join-Path $env:USERPROFILE ".android\debug.keystore"
if (Test-Path $keystore) {
  $sha1 = (& keytool -list -v -keystore $keystore -alias androiddebugkey -storepass android -keypass android |
    Select-String "SHA1:").ToString().Split(" ", [StringSplitOptions]::RemoveEmptyEntries)[-1]
  & firebase apps:android:sha:create $android.appId $sha1 2>$null
  Write-Host "  SHA-1 $sha1"
  # Re-download: the config now includes the Android OAuth client.
  & firebase apps:sdkconfig ANDROID $android.appId --out (Join-Path $root "android\app\google-services.json")
} else {
  Write-Host "  No debug keystore yet — build the app once, then re-run this script." -ForegroundColor Yellow
}

Step "Registering the desktop (web) app"
$web = $apps | Where-Object { $_.platform -eq "WEB" -and $_.displayName -eq "DEX Desktop" } | Select-Object -First 1
if (-not $web) {
  $web = (& firebase apps:create WEB "DEX Desktop" --json | ConvertFrom-Json).result
}
$cfg = (& firebase apps:sdkconfig WEB $web.appId --json | ConvertFrom-Json).result.sdkConfig
$desktopCfg = [ordered]@{
  apiKey = $cfg.apiKey; authDomain = $cfg.authDomain; projectId = $cfg.projectId
  appId = $cfg.appId; messagingSenderId = $cfg.messagingSenderId; storageBucket = $cfg.storageBucket
}
$desktopCfg | ConvertTo-Json | Set-Content (Join-Path $root "desktop\app\config\firebase.json") -Encoding utf8

Step "Creating Firestore and deploying security rules"
& firebase firestore:databases:create "(default)" --location $Location 2>$null
Fb deploy --only "firestore:rules,firestore:indexes"

Step "Enabling Email/Password sign-in"
$cfgPath = Join-Path $env:USERPROFILE ".config\configstore\firebase-tools.json"
$token = (Get-Content $cfgPath -Raw | ConvertFrom-Json).tokens.access_token
$body = '{"signIn":{"email":{"enabled":true,"passwordRequired":true}}}'
try {
  Invoke-RestMethod -Method Patch -ContentType "application/json" -Body $body `
    -Uri "https://identitytoolkit.googleapis.com/admin/v2/projects/$ProjectId/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired" `
    -Headers @{ Authorization = "Bearer $token"; "x-goog-user-project" = $ProjectId } | Out-Null
  Write-Host "  Email/Password is on."
} catch {
  Write-Host "  Couldn't enable it automatically: Firebase console → Authentication → Sign-in method → Email/Password → Enable." -ForegroundColor Yellow
}

Write-Host "`nDone. Restart DEX → Settings → Accounts → DEX on your phone → sign in; use the same email and password in the Android app." -ForegroundColor Green
