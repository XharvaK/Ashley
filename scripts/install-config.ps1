$dir = Join-Path $env:USERPROFILE ".composer-assistant"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $dir "conversations") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $dir "logs") | Out-Null

Write-Host "Config ready at $dir"
