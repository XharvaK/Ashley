# Prepare a USB/scp transfer pack for the Mint laptop (secrets stay out of git).
# Does NOT print secret values.
param(
  [string]$OutDir = "",
  [switch]$StopAshley
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$HomeData = Join-Path $env:USERPROFILE ".composer-assistant"
$EnvSrc = Join-Path $HomeData ".env"

if (-not $OutDir) {
  $OutDir = Join-Path ([Environment]::GetFolderPath("Desktop")) "ashley-mint-transfer"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$UsbDeploy = Join-Path $OutDir "deploy-linux-mint"
New-Item -ItemType Directory -Force -Path (Join-Path $UsbDeploy "systemd") | Out-Null

if (-not (Test-Path $EnvSrc)) {
  throw "Missing $EnvSrc - copy from config/env.example and fill secrets first."
}

$raw = Get-Content -LiteralPath $EnvSrc -Raw
$need = @("MISTRAL_API_KEY", "DISCORD_BOT_TOKEN", "DISCORD_OWNER_ID")
$missing = @()
foreach ($k in $need) {
  if ($raw -notmatch "(?m)^${k}=.+" -or $raw -match "(?m)^${k}=\s*$") {
    $missing += $k
  }
}
if ($missing.Count -gt 0) {
  Write-Warning ("Env missing/empty: " + ($missing -join ", "))
}

$destEnv = Join-Path $OutDir ".env"
Copy-Item -LiteralPath $EnvSrc -Destination $destEnv -Force
try {
  icacls $destEnv /inheritance:r | Out-Null
  icacls $destEnv /grant:r "${env:USERNAME}:R" | Out-Null
} catch {}

$mintSrc = Join-Path $RepoRoot "deploy\linux-mint"
Copy-Item (Join-Path $mintSrc "first-boot-from-usb.sh") (Join-Path $OutDir "first-boot-from-usb.sh") -Force
Copy-Item (Join-Path $mintSrc "bootstrap.sh") (Join-Path $UsbDeploy "bootstrap.sh") -Force
Copy-Item (Join-Path $mintSrc "install.sh") (Join-Path $UsbDeploy "install.sh") -Force
Copy-Item (Join-Path $mintSrc "update.sh") (Join-Path $UsbDeploy "update.sh") -Force
Copy-Item (Join-Path $mintSrc "status.sh") (Join-Path $UsbDeploy "status.sh") -Force
Copy-Item (Join-Path $mintSrc "README.md") (Join-Path $UsbDeploy "README.md") -Force
Copy-Item (Join-Path $mintSrc "systemd\*") (Join-Path $UsbDeploy "systemd") -Force

$setup = @"
Ashley Mint transfer pack
Generated: $(Get-Date -Format o)
Repo (private): https://github.com/XharvaK/project-ashley

ON MINT
=======
1) Sign into GitHub. Prefer:
     gh auth login

2) Open a terminal IN THIS FOLDER (USB):
     bash first-boot-from-usb.sh

3) Verify:
     bash ~/project-ashley/deploy/linux-mint/status.sh
     curl -s http://127.0.0.1:3710/health

4) Only ONE Discord bot. Windows should already be stopped if you used -StopAshley.

UPDATES LATER
=============
Windows: commit + push
Mint:    bash ~/project-ashley/deploy/linux-mint/update.sh

Delete this folder after a successful install. NEVER commit .env.
"@

Set-Content -LiteralPath (Join-Path $OutDir "MINT-SETUP.txt") -Value $setup -Encoding UTF8

if ($StopAshley) {
  Write-Host "Stopping Windows Ashley..."
  $stopScript = Join-Path $RepoRoot "scripts\start-production.ps1"
  powershell -ExecutionPolicy Bypass -File $stopScript -Stop
}

Write-Host ""
Write-Host "Transfer pack ready: $OutDir"
Write-Host "Contains: .env, first-boot-from-usb.sh, deploy-linux-mint/*, MINT-SETUP.txt"
Write-Host ""
Write-Host "BLOCKER until git push: Mint clone needs deploy/linux-mint on origin"
Write-Host "  Ask Cursor: commit and push (Mint deploy + Ashley slice)"
Write-Host "Then on Mint: bash first-boot-from-usb.sh"
