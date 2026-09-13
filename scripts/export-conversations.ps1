param(
    [string]$OutDir = (Join-Path $env:USERPROFILE "Desktop\composer-export")
)

$sessions = Join-Path $env:USERPROFILE ".composer-assistant\conversations\sessions"
if (-not (Test-Path $sessions)) {
    Write-Error "No conversations found at $sessions"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Copy-Item -Path (Join-Path $sessions "*") -Destination $OutDir -Recurse -Force
Write-Host "Exported to $OutDir"
