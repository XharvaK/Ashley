param(
    [Parameter(Mandatory = $true)][string]$SimsRoot,
    [string]$Version = "1.0.0"
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$artifact = Join-Path $repo ("sims-e1\build\ashley_e1_" + $Version + ".ts4script")
$sidecar = $artifact + ".sha256"
if (Get-Process -Name "TS4_x64" -ErrorAction SilentlyContinue) { throw "The Sims 4 must be closed" }
if (-not (Test-Path -LiteralPath $SimsRoot -PathType Container)) { throw "SimsRoot does not exist" }
if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) { throw "Build artifact missing" }
if (-not (Test-Path -LiteralPath $sidecar -PathType Leaf)) { throw "Artifact sidecar missing" }
$root = [IO.Path]::GetFullPath($SimsRoot).TrimEnd('\')
$mods = Join-Path $root "Mods"
$destination = Join-Path $mods "AshleyE1"
$expectedDestination = [IO.Path]::GetFullPath((Join-Path $root "Mods\AshleyE1")).TrimEnd('\')
if ([IO.Path]::GetFullPath($destination).TrimEnd('\') -ne $expectedDestination) {
    throw "Destination structure is not root\Mods\AshleyE1"
}
$artifactHash = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToUpperInvariant()
$sidecarHash = (Get-Content -LiteralPath $sidecar -Raw -Encoding ASCII).Trim().ToUpperInvariant()
if ($sidecarHash -ne $artifactHash -or $sidecarHash -notmatch '^[0-9A-F]{64}$') {
    throw "Artifact sidecar hash mismatch"
}
New-Item -ItemType Directory -Force -Path $mods, $destination | Out-Null
$backupRoot = Join-Path $root ("AshleyE1E1Backup_" + (Get-Date -Format "yyyyMMddHHmmss"))
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
foreach ($name in @("Mods", "saves", "Tray")) {
    $source = Join-Path $root $name
    if (Test-Path -LiteralPath $source) {
        Copy-Item -LiteralPath $source -Destination (Join-Path $backupRoot $name) -Recurse -Force
    }
}
$duplicates = Get-ChildItem -LiteralPath $mods -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '(?i)ashley_e1.*\.(ts4script|zip)$' }
if ($duplicates.Count -gt 0) { throw "Duplicate Ashley E1 packages found under Mods" }
Copy-Item -LiteralPath $artifact -Destination (Join-Path $destination (Split-Path -Leaf $artifact)) -Force
$installed = Join-Path $destination (Split-Path -Leaf $artifact)
if (-not (Test-Path -LiteralPath $installed -PathType Leaf)) { throw "Installed artifact is missing" }
if ((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash.ToUpperInvariant() -ne $artifactHash) {
    throw "Installed artifact hash mismatch"
}
$installManifest = [ordered]@{
    schema = "sims-e1.install/v1"
    installed_at_utc = (Get-Date).ToUniversalTime().ToString("o")
    sims_root = $root
    mods_root = [IO.Path]::GetFullPath($mods)
    destination = [IO.Path]::GetFullPath($destination)
    destination_structure = "root\\Mods\\AshleyE1"
    artifact = [IO.Path]::GetFullPath($installed)
    artifact_sha256 = $artifactHash
    sidecar_sha256 = $sidecarHash
}
$installManifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $destination "install_manifest.json") -Encoding UTF8
$cache = Join-Path $root "localthumbcache.package"
if (Test-Path -LiteralPath $cache -PathType Leaf) { Remove-Item -LiteralPath $cache -Force }
Write-Output ("INSTALL_PASS destination=" + (Join-Path $destination (Split-Path -Leaf $artifact)))
Write-Output "Owner must enable Script Mods and CC in game options, restart, and verify the load_disabled witness."
