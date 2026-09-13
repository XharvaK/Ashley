# Start Ashley agent (+ optional Discord) for development
param(
    [switch]$Discord,
    [switch]$AgentOnly
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent

Write-Host "=== Ashley Dev (nuclear Discord) ==="
& (Join-Path $Root "scripts\install-config.ps1")

Write-Host "Starting agent-service..."
$agentDir = Join-Path $Root "apps\agent-service"
if (-not (Test-Path (Join-Path $agentDir "node_modules"))) {
    Push-Location $agentDir
    npm install
    Pop-Location
}
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$agentDir'; npm run dev"

Start-Sleep -Seconds 2

if ($Discord -and -not $AgentOnly) {
    Write-Host "Starting discord-bot..."
    $discordDir = Join-Path $Root "apps\discord-bot"
    if (-not (Test-Path (Join-Path $discordDir "node_modules"))) {
        Push-Location $discordDir
        npm install
        Pop-Location
    }
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$discordDir'; npm run dev"
}

Write-Host ""
Write-Host "agent: http://127.0.0.1:3710/health"
if ($Discord -and -not $AgentOnly) {
    Write-Host "discord-bot: starting (conflicts with Mint if both run)"
}
