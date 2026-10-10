<#
.SYNOPSIS
  Pulls Ashley's encrypted daily backup packages from her host to this PC.

.DESCRIPTION
  Her host makes one encrypted package a day (backups/pkg/*.ashleybak). This script copies every
  package it does not have yet into <Dest>\daily, checks each copy's SHA-256 against the host, keeps
  the first package of each month in <Dest>\monthly, and prunes to the newest 30 daily and 12 monthly
  copies. A cloud sync client (for example Google Drive for desktop) can sync <Dest> off the house.
  The packages are encrypted on the host; the key never leaves it, so nothing here can open them.

  After a run it writes <Dest>\status.json and reports the result back to the host
  (backups/offsite.json) so her status can show how old the newest off-host copy is.
  A failure, or a newest copy older than -StaleHours, raises a Windows notification and exits non-zero.

.NOTES
  Uses the user's ssh config alias (default "mint"). Run by the "Ashley backup pull" scheduled task.
#>
param(
  [string]$Dest = "E:\AshleyBackups",
  [string]$SshHost = "mint",
  [int]$DailyKeep = 30,
  [int]$MonthlyKeep = 12,
  [int]$StaleHours = 48
)

$ErrorActionPreference = "Stop"
$Ssh = "$env:WINDIR\System32\OpenSSH\ssh.exe"
$Scp = "$env:WINDIR\System32\OpenSSH\scp.exe"
$RemoteDir = ".composer-assistant/backups/pkg"
$Daily = Join-Path $Dest "daily"
$Monthly = Join-Path $Dest "monthly"
$LogPath = Join-Path $Dest "pull.log"

function Write-Log([string]$Line) {
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  Add-Content -Path $LogPath -Value "$stamp $Line" -Encoding utf8
}

function Show-Notice([string]$Title, [string]$Body) {
  try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
    $texts = $template.GetElementsByTagName("text")
    $texts.Item(0).AppendChild($template.CreateTextNode($Title)) | Out-Null
    $texts.Item(1).AppendChild($template.CreateTextNode($Body)) | Out-Null
    $appId = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show([Windows.UI.Notifications.ToastNotification]::new($template))
  } catch {
    Write-Log "notice_failed: $($_.Exception.Message)"
  }
}

function Invoke-Remote([string]$Command) {
  $output = & $Ssh -o BatchMode=yes -o ConnectTimeout=20 $SshHost $Command
  if ($LASTEXITCODE -ne 0) { throw "ssh_failed ($LASTEXITCODE)" }
  return $output
}

function Get-PackageStampUtc([string]$Name) {
  # Package names are <yyyyMMddTHHmmssZ>.ashleybak
  return [datetime]::ParseExact($Name.Substring(0, 16), "yyyyMMdd'T'HHmmss'Z'", $null,
    [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal)
}

function Remove-Oldest([string]$Folder, [int]$Keep) {
  $all = @(Get-ChildItem -Path $Folder -Filter "*.ashleybak" | Sort-Object Name -Descending)
  foreach ($file in ($all | Select-Object -Skip $Keep)) {
    Remove-Item -LiteralPath $file.FullName
    Write-Log "pruned $($Folder | Split-Path -Leaf)/$($file.Name)"
  }
}

New-Item -ItemType Directory -Force -Path $Daily, $Monthly | Out-Null
$status = [ordered]@{ ok = $false; checked_at = (Get-Date).ToUniversalTime().ToString("o"); pulled = @(); newest = $null; error = $null }
$exitCode = 0
try {
  # sha256sum prints "<hash>  <name>"; only whole packages (.ashleybak) are listed, never partial files.
  $listing = Invoke-Remote "cd $RemoteDir && for f in *.ashleybak; do [ -f `"`$f`" ] && sha256sum `"`$f`"; done; true"
  $remote = @{}
  foreach ($line in @($listing)) {
    if ($line -match '^([0-9a-f]{64})\s+\*?(\d{8}T\d{6}Z\.ashleybak)$') { $remote[$Matches[2]] = $Matches[1] }
  }
  if ($remote.Count -eq 0) { throw "no_packages_on_host" }

  foreach ($name in ($remote.Keys | Sort-Object)) {
    $target = Join-Path $Daily $name
    if (Test-Path -LiteralPath $target) { continue }
    $partial = "$target.partial"
    & $Scp -q -B -o ConnectTimeout=20 "${SshHost}:$RemoteDir/$name" $partial
    if ($LASTEXITCODE -ne 0) { Remove-Item -LiteralPath $partial -ErrorAction SilentlyContinue; throw "scp_failed $name" }
    $hash = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $remote[$name]) { Remove-Item -LiteralPath $partial; throw "hash_mismatch $name" }
    Move-Item -LiteralPath $partial -Destination $target
    $status.pulled += $name
    Write-Log "pulled $name"
  }

  # The first package of each UTC month is kept as that month's copy.
  foreach ($file in (Get-ChildItem -Path $Daily -Filter "*.ashleybak" | Sort-Object Name)) {
    $month = $file.Name.Substring(0, 6)
    if (-not (Get-ChildItem -Path $Monthly -Filter "$month*.ashleybak")) {
      Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $Monthly $file.Name)
      Write-Log "monthly $($file.Name)"
    }
  }
  Remove-Oldest $Daily $DailyKeep
  Remove-Oldest $Monthly $MonthlyKeep

  $newest = Get-ChildItem -Path $Daily -Filter "*.ashleybak" | Sort-Object Name -Descending | Select-Object -First 1
  $status.newest = $newest.Name
  $ageHours = ((Get-Date).ToUniversalTime() - (Get-PackageStampUtc $newest.Name)).TotalHours
  if ($ageHours -gt $StaleHours) {
    $status.error = "newest_copy_stale"
    $exitCode = 2
    Show-Notice "Ashley backup is stale" ("The newest copy on this PC is {0:N0} hours old. Her host may not be making backups." -f $ageHours)
  } else {
    $status.ok = $true
  }
} catch {
  $status.error = $_.Exception.Message
  $exitCode = 1
  Write-Log "failed: $($status.error)"
  Show-Notice "Ashley backup pull failed" $status.error
}

$json = $status | ConvertTo-Json -Compress
Set-Content -Path (Join-Path $Dest "status.json") -Value $json -Encoding utf8
try {
  # Reported back so her host can tell how old the newest off-host copy is.
  $json | & $Ssh -o BatchMode=yes -o ConnectTimeout=20 $SshHost "cat > .composer-assistant/backups/offsite.json.tmp && mv .composer-assistant/backups/offsite.json.tmp .composer-assistant/backups/offsite.json"
} catch {
  Write-Log "report_back_failed: $($_.Exception.Message)"
}
Write-Log ("done exit=$exitCode pulled=" + $status.pulled.Count)
exit $exitCode
