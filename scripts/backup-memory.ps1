# Dual consistent snapshot backup for Ashley (nuclear.db + continuity.db).
# Prefer the Node package path for authenticated off-device transfer.
# This script creates local VACUUM snapshots only — never naive WAL/SHM copy.
param(
    [string]$DestRoot = (Join-Path $env:USERPROFILE ".composer-assistant\backups"),
    [switch]$EncryptedPackage
)

$ErrorActionPreference = "Stop"
$DataRoot = Join-Path $env:USERPROFILE ".composer-assistant"
$Nuclear = Join-Path $DataRoot "conversations\nuclear.db"
$Continuity = Join-Path $DataRoot "continuity.db"

if (-not (Test-Path $Nuclear)) {
    Write-Error "Nuclear DB not found: $Nuclear"
    exit 1
}
if (-not (Test-Path $Continuity)) {
    Write-Error "Continuity DB not found: $Continuity"
    exit 1
}

$Stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$Dest = Join-Path $DestRoot $Stamp
New-Item -ItemType Directory -Force -Path $Dest | Out-Null

$Repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
# Fallback: script lives in repo/scripts
if (-not (Test-Path (Join-Path $Repo "apps\agent-service"))) {
    $Repo = Split-Path $PSScriptRoot -Parent
}

Write-Host "Creating consistent VACUUM snapshots into $Dest"
# Use node sqlite VACUUM INTO via a tiny inline script for consistency.
$Node = @"
const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const nuclear = process.argv[1];
const continuity = process.argv[2];
const dest = process.argv[3];
mkdirSync(dest, { recursive: true });
const n = new DatabaseSync(nuclear);
n.exec(`VACUUM INTO '\${dest.replace(/\\/g, '/').replace(/'/g, "''")}/nuclear.db'`);
n.close();
const c = new DatabaseSync(continuity);
c.exec(`VACUUM INTO '\${dest.replace(/\\/g, '/').replace(/'/g, "''")}/continuity.db'`);
c.close();
console.log('ok');
"@

node -e $Node -- $Nuclear $Continuity $Dest
if ($LASTEXITCODE -ne 0) {
    Write-Error "VACUUM snapshot failed"
    exit 1
}

Write-Host "Snapshot complete: $Dest"
Write-Host "For AES-GCM transfer package, use apps/agent-service continuity backup-package module with ASHLEY_BACKUP_TRANSFER_KEY (64 hex)."
if ($EncryptedPackage) {
    Write-Warning "EncryptedPackage switch requires calling the TypeScript backup-package API; snapshots only were written."
}
