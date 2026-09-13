# Register Composer Assistant desktop app at Windows logon
param(
    [string]$ExePath = ""
)

$ErrorActionPreference = "Stop"
if (-not $ExePath) {
    $ExePath = Read-Host "Path to composer-assistant.exe (after tauri build)"
}

$regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
Set-ItemProperty -Path $regPath -Name "ComposerAssistant" -Value "`"$ExePath`""
Write-Host "Startup entry added: ComposerAssistant -> $ExePath"
