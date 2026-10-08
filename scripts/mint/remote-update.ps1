# Push Ashley updates to the Mint laptop over SSH (no lid open needed after SSH works).
# Prereq on Mint (once): bash ~/project-ashley/deploy/linux-mint/enable-ssh.sh
#
# Checkout happens here; activation is exec of that checkout's update.sh.
#
# Usage:
#   powershell -File scripts\mint\remote-update.ps1
#   powershell -File scripts\mint\remote-update.ps1 -PushFirst
#   powershell -File scripts\mint\remote-update.ps1 -HostName 192.168.x.x -User <mint-user>
param(
  # Defaults match ~/.ssh/config Host mint (production Discord host).
  [string]$HostName = "mint",

  # Empty: ~/.ssh/config supplies the user for the host.
  [string]$User = "",

  [int]$Port = 22,

  [switch]$PushFirst,

  # Run the per-wave live check after coherent activation ("4", "5", or "all").
  [string]$LiveCheck = "",

  [string]$RepoDir = "~/project-ashley",

  # Tests pass their stub here, so a test run can never reach the real host.
  [string]$SshPath = "ssh"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

function Invoke-MintBash {
  param([string[]]$Lines)
  $remote = ($Lines -join "`n") + "`n"
  $tmp = Join-Path $env:TEMP ("ashley-mint-" + [guid]::NewGuid().ToString() + ".sh")
  [IO.File]::WriteAllText($tmp, $remote, [Text.UTF8Encoding]::new($false))
  try {
    Get-Content -LiteralPath $tmp -Raw | & $SshPath -p $Port -o BatchMode=yes -o StrictHostKeyChecking=accept-new $target "tr -d '\r' | bash -s" | Out-Host
    return [int]$LASTEXITCODE
  } finally {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  }
}

if ($PushFirst) {
  Write-Host "=== git push from Windows ==="
  Push-Location $RepoRoot
  $branch = (git rev-parse --abbrev-ref HEAD).Trim()
  git push -u origin $branch
  Pop-Location
}

$target = if ($User) { "${User}@${HostName}" } else { $HostName }

# Exact-candidate truth: pin the intended Windows HEAD (SHA + tree) and require
# Mint to activate exactly that commit. PowerShell single quotes pass the
# revision through to git literally (unquoted HEAD^{tree} is a quoting hazard).
Push-Location $RepoRoot
$localSha = (git rev-parse HEAD).Trim()
$localTree = (git rev-parse 'HEAD^{tree}').Trim()
Pop-Location
if ([string]::IsNullOrWhiteSpace($localSha) -or [string]::IsNullOrWhiteSpace($localTree)) {
  Write-Host "Cannot determine local candidate SHA/tree."
  exit 1
}
Write-Host "LOCAL_EXPECTED_SHA=$localSha"
Write-Host "LOCAL_EXPECTED_TREE=$localTree"

# LF-only remote script (CRLF breaks bash on Mint). Pull, then exec the
# checked-out activator so the first Slice C deploy cannot keep running
# old update.sh semantics after the files change on disk.
$activate = @(
  'set -euo pipefail',
  'export PATH="$HOME/.local/bin:$PATH"',
  '. "$HOME/.nvm/nvm.sh" 2>/dev/null || true',
  "cd $RepoDir",
  'git pull --ff-only',
  'CANDIDATE_SHA=$(git rev-parse HEAD)',
  'if [ -z "$CANDIDATE_SHA" ]; then echo empty candidate SHA >&2; exit 1; fi',
  'echo "CANDIDATE_SHA=$CANDIDATE_SHA"',
  "export ASHLEY_EXPECTED_SHA=$localSha",
  "export ASHLEY_EXPECTED_TREE=$localTree",
  '# Break-glass package replaces ad-hoc ~/ashley-backup-* copies. Do not copy live databases there.',
  '# Run only the backup source closure. Candidate-wide compilation belongs to the ordered activator.',
  'cd apps/agent-service',
  'node --import tsx src/scripts/backup-daily.ts',
  "cd $RepoDir",
  '# Slash commands are registered with Discord from the checkout (idempotent; ids are not printed).',
  '(cd apps/discord-bot && npx tsx scripts/deploy-commands.ts 2>&1 | sed -E "s/[0-9]{15,}/<id>/g") || echo "slash command registration failed; the deploy continues"',
  'exec bash deploy/linux-mint/update.sh'
)

Write-Host "=== remote checkout + activate on $target ==="
$code = Invoke-MintBash -Lines $activate
if ($code -ne 0) {
  Write-Host "SSH/remote update failed (exit $code)."
  exit $code
}

if ($LiveCheck) {
  Write-Host "=== remote live-check $LiveCheck ==="
  $live = @(
    'set -euo pipefail',
    'export PATH="$HOME/.local/bin:$PATH"',
    '. "$HOME/.nvm/nvm.sh" 2>/dev/null || true',
    "cd $RepoDir",
    "bash deploy/linux-mint/live-check.sh $LiveCheck"
  )
  $liveCode = Invoke-MintBash -Lines $live
  if ($liveCode -ne 0) {
    Write-Host "SSH/live-check failed (exit $liveCode)."
    exit $liveCode
  }
}

Write-Host "Remote update finished."
