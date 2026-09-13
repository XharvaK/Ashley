# Run persona probes against a throwaway agent on port 3712.
# Isolated on purpose: explicit isolated DataPlaneContext, proactive off so it never DMs anyone.
param(
    [string]$Label = "",
    [string]$Tags = "",
    [int]$Seeds = 1,
    [switch]$Fresh,
    [switch]$WithRetrieval,
    [int]$Port = 3712
)

$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
# Must sit outside reserved production ~/.composer-assistant.
$EvalData = Join-Path $env:USERPROFILE ".composer-assistant-persona-eval"

# A leftover eval agent keeps a handle on the DB and would make -Fresh fail
# halfway through, leaving a half-deleted data dir behind.
$stale = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
foreach ($conn in $stale) {
    Write-Host "Stopping stale listener on $Port (pid $($conn.OwningProcess))"
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

if ($Fresh -and (Test-Path $EvalData)) {
    Remove-Item $EvalData -Recurse -Force -ErrorAction Stop
}
New-Item -ItemType Directory -Force -Path (Join-Path $EvalData "conversations") | Out-Null

Write-Host "Building agent-service..."
npm run build --prefix (Join-Path $Root "apps\agent-service") | Out-Null
if ($LASTEXITCODE -ne 0) { throw "agent-service build failed" }

$env:AGENT_PORT = "$Port"
$env:ASHLEY_NUCLEAR = "true"
$env:PERSONA_EVAL_MODE = "true"
$env:PROACTIVE_ENABLED = "false"
# Her inner life is live infrastructure: in a probe run it would spend search
# credits and make the same probe answer differently on Tuesday.
$env:CURIOSITY_ENABLED = "false"
# Isolated eval data already isolates memory; -WithRetrieval is reserved
# for future retrieval harnesses (no-op under nuclear today).
if (-not $WithRetrieval) { $env:MEMORY_RETRIEVAL_TOP_K = "0" }

$logDir = Join-Path $EvalData "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stdout = Join-Path $logDir "agent-eval.out.log"
$stderr = Join-Path $logDir "agent-eval.err.log"

$isolatedEntry = Join-Path $Root "apps\agent-service\dist\isolated-index.js"
Write-Host "Starting isolated agent on 127.0.0.1:$Port (data: $EvalData)"
$agent = Start-Process node `
    -ArgumentList @($isolatedEntry, $EvalData) `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru -WindowStyle Hidden

try {
    $replayArgs = @(
        (Join-Path $PSScriptRoot "replay.mjs"),
        "--url", "http://127.0.0.1:$Port",
        "--seeds", "$Seeds"
    )
    if ($Label) { $replayArgs += @("--label", $Label) }
    if ($Tags) { $replayArgs += @("--tags", $Tags) }

    node @replayArgs
    $replayExit = $LASTEXITCODE
} finally {
    if ($agent -and -not $agent.HasExited) {
        Stop-Process -Id $agent.Id -Force
        Write-Host "Stopped isolated agent (pid $($agent.Id))"
    }
    Remove-Item Env:\AGENT_PORT, Env:\ASHLEY_NUCLEAR, `
        Env:\PERSONA_EVAL_MODE, Env:\PROACTIVE_ENABLED, Env:\MEMORY_RETRIEVAL_TOP_K, `
        Env:\CURIOSITY_ENABLED `
        -ErrorAction SilentlyContinue
}

if ($replayExit -ne 0) {
    Write-Host "Replay exited with $replayExit (agent log: $stderr)"
    exit $replayExit
}
