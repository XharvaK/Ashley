# Full persona eval: n seeds per probe on an isolated agent, then a blind
# pairwise judge against a baseline run.
#
#   powershell -File scripts\persona-eval\run-full.ps1 -Baseline wave0-baseline -Label wave5
#   powershell -File scripts\persona-eval\run-full.ps1 -Baseline wave0-baseline -Label wave5 -Offline
param(
    [Parameter(Mandatory = $true)]
    [string]$Baseline,

    [string]$Label = "",

    [int]$Seeds = 3,

    [string]$Tags = "",

    # Gates only, no judge calls. Useful when the API budget matters.
    [switch]$Offline,

    [switch]$Fresh,

    [int]$Port = 3712
)

$ErrorActionPreference = "Stop"
if (-not $Label) { $Label = "cand-" + (Get-Date -Format "yyyyMMdd_HHmm") }

# Hashtable, not array: an array splat binds positionally, so "-Seeds" lands in
# run-isolated's third parameter as a string and the run dies on arg binding.
$replayArgs = @{ Label = $Label; Seeds = $Seeds; Port = $Port }
if ($Tags) { $replayArgs.Tags = $Tags }
if ($Fresh) { $replayArgs.Fresh = $true }

Write-Host "=== replay $Label ($Seeds seeds) ==="
& (Join-Path $PSScriptRoot "run-isolated.ps1") @replayArgs
if ($LASTEXITCODE -ne 0) { throw "replay failed ($LASTEXITCODE)" }

Write-Host "=== judge $Label vs $Baseline ==="
$judgeArgs = @(
    (Join-Path $PSScriptRoot "judge.mjs"),
    "--a", $Baseline,
    "--b", $Label,
    "--out", "judge-$Label"
)
if ($Offline) { $judgeArgs += "--offline" }

node @judgeArgs
$judgeExit = $LASTEXITCODE

$outDir = Join-Path $env:USERPROFILE ".composer-assistant\persona-eval\judge-$Label"
Write-Host "Report: $(Join-Path $outDir 'judge.md')"
if ($judgeExit -ne 0) {
    Write-Host "Hard failures present. Do not deploy this wave."
}
exit $judgeExit
