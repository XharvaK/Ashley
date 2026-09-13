# Windows local Ashley stack. Production Discord bot runs on Mint only.
# Prefer: npm run start:ashley  →  scripts/mint/remote-update.ps1 (checkout + exec update.sh)
param(
    [switch]$Stop,
    # Explicit override for rare local smoke. Never use while Mint owns the token.
    [switch]$AllowWindows
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$LogDir = Join-Path $env:USERPROFILE ".composer-assistant\logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$agentLog = Join-Path $LogDir "agent-service.log"
$agentErrLog = Join-Path $LogDir "agent-service.err.log"
$botLog = Join-Path $LogDir "discord-bot.log"
$botErrLog = Join-Path $LogDir "discord-bot.err.log"
$pidFile = Join-Path $LogDir "ashley-pids.json"

function Stop-Ashley {
    if (-not (Test-Path $pidFile)) {
        Write-Host "No pid file - nothing to stop."
        return
    }
    $pids = Get-Content $pidFile -Raw | ConvertFrom-Json
    foreach ($name in @("agent", "discord")) {
        $id = $pids.$name
        if ($id -and (Get-Process -Id $id -ErrorAction SilentlyContinue)) {
            Stop-Process -Id $id -Force
            Write-Host "Stopped $name (PID $id)"
        }
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

if ($Stop) {
    Stop-Ashley
    exit 0
}

if (-not $AllowWindows) {
    Write-Host @"
Ashley production runs on Mint only (SSH host 'mint').

  npm run start:ashley
  # → powershell -File scripts\mint\remote-update.ps1

Windows local start is blocked so the Discord token is not stolen.
Rare smoke only:  powershell -File scripts\start-production.ps1 -AllowWindows
(Stop Mint first: ssh mint 'systemctl --user stop ashley-discord ashley-agent')
"@
    exit 1
}

Stop-Ashley

$agentDir = Join-Path $Root "apps\agent-service"
$botDir = Join-Path $Root "apps\discord-bot"

foreach ($dir in @($agentDir, $botDir)) {
    if (-not (Test-Path (Join-Path $dir "node_modules"))) {
        Push-Location $dir
        npm install
        Pop-Location
    }
    Push-Location $dir
    npm run build
    Pop-Location
}

$agentProc = Start-Process -FilePath "node" `
    -ArgumentList "dist/index.js" `
    -WorkingDirectory $agentDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $agentLog `
    -RedirectStandardError $agentErrLog `
    -PassThru

Start-Sleep -Seconds 3

$botProc = Start-Process -FilePath "node" `
    -ArgumentList "dist/index.js" `
    -WorkingDirectory $botDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $botLog `
    -RedirectStandardError $botErrLog `
    -PassThru

@{ agent = $agentProc.Id; discord = $botProc.Id } | ConvertTo-Json | Set-Content $pidFile

Write-Host "Ashley running in background on WINDOWS (override)."
Write-Host "  agent log:  $agentLog"
Write-Host "  bot log:    $botLog"
Write-Host "  health:     http://127.0.0.1:3710/health"
Write-Host "  stop:       .\scripts\start-production.ps1 -Stop"
