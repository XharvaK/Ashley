param(
    [Parameter(Mandatory = $true)][string]$SimsRoot,
    [string]$Version = "1.0.0"
)

$ErrorActionPreference = "Stop"
if (Get-Process -Name "TS4_x64" -ErrorAction SilentlyContinue) { throw "The Sims 4 must be closed" }
if (-not (Test-Path -LiteralPath $SimsRoot -PathType Container)) { throw "SimsRoot does not exist" }
$root = [IO.Path]::GetFullPath($SimsRoot).TrimEnd('\')
$artifact = Join-Path (Join-Path $root "Mods\AshleyE1") ("ashley_e1_" + $Version + ".ts4script")
if (Test-Path -LiteralPath $artifact -PathType Leaf) { Remove-Item -LiteralPath $artifact -Force }
$cache = Join-Path $root "localthumbcache.package"
if (Test-Path -LiteralPath $cache -PathType Leaf) { Remove-Item -LiteralPath $cache -Force }
if (Test-Path -LiteralPath $artifact) { throw "Exact artifact remains after removal" }
$mods = Join-Path $root "Mods"
$remaining = @()
if (Test-Path -LiteralPath $mods -PathType Container) {
    $remaining = @(Get-ChildItem -LiteralPath $mods -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '(?i)^ashley_e1.*\.(ts4script|zip)$' })
}
if ($remaining.Count -gt 0) {
    throw ("Ashley E1 package remains under Mods: " + (($remaining | Select-Object -ExpandProperty FullName) -join "; "))
}
Write-Output "REMOVE_PASS exact artifact absent; saves untouched"
