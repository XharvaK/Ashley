# Phase 0 test runner - offline | agent | full
param(
  [ValidateSet("offline", "agent", "full")]
  [string]$Tier = "offline"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent | Split-Path -Parent

function Run-Node($script) {
  node (Join-Path $Root $script)
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "=== Tier: $Tier ==="

Write-Host ""
Write-Host "=== Build agent ==="
npm run build --prefix (Join-Path $Root "apps/agent-service")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "=== Vitest (nuclear unit) ==="
if ($Tier -eq "offline") {
  # Qualification-only context. Normal Ashley startup keeps its existing
  # environment precedence and does not receive these variables.
  $env:ASHLEY_PHASE0_OFFLINE = "true"
  $env:COMPOSER_ENV_FILE = Join-Path $Root "config\env.example"
  npm run test:offline --prefix (Join-Path $Root "apps/agent-service")
} else {
  npm test --prefix (Join-Path $Root "apps/agent-service")
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($Tier -eq "offline") {
  Write-Host ""
  Write-Host "OK offline tier"
  exit 0
}

Write-Host ""
Write-Host "=== Nuclear HTTP smokes (agent-service required) ==="
Run-Node "scripts\phase0\test-memory-recall.mjs"
Run-Node "scripts\phase0\test-recall-diversity.mjs"
Run-Node "scripts\phase0\verify-dm-recall.mjs"
Run-Node "scripts\phase0\test-correction-guard.mjs"
Run-Node "scripts\phase0\test-initiative.mjs"
Run-Node "scripts\phase0\test-auto-remember.mjs"

if ($Tier -eq "agent") {
  Write-Host ""
  Write-Host "OK agent tier"
  exit 0
}

Write-Host ""
Write-Host "=== Mistral ==="
node (Join-Path $Root "scripts\phase0\test-mistral.mjs")
if ($LASTEXITCODE -ne 0) {
  Write-Warning "Mistral test failed - set MISTRAL_API_KEY"
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "OK full tier"
