param(
    [string]$Version = "1.0.10",
    [string]$PythonPath = "C:\Users\Xharv\AppData\Local\Programs\Python\Python370-AshleyE1\python.exe",
    [string]$ImplementedCommit = "WORKTREE_UNCOMMITTED",
    [string]$BaselineCommit = ""
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sourceRoot = Join-Path $repo "sims-e1\src"
$buildRoot = Join-Path $repo "sims-e1\build"
$stageRoot = Join-Path $buildRoot (".stage_" + $Version)
$artifact = Join-Path $buildRoot ("ashley_e1_" + $Version + ".ts4script")
$sidecar = $artifact + ".sha256"
$manifestPath = Join-Path $buildRoot "manifest.json"

if ($Version -notmatch '^1\.0\.\d+$') { throw "Version must match 1.0.<n>" }
if (-not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) { throw "Pinned Python not found: $PythonPath" }
$initSource = Get-Content -LiteralPath (Join-Path $sourceRoot "ashley_e1\__init__.py") -Raw
if ($initSource -notmatch ('E1_PROBE_VERSION\s*=\s*"' + [regex]::Escape($Version) + '"')) {
    throw "Version argument does not match ashley_e1.__init__.py"
}
New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null
if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $stageRoot "ashley_e1") | Out-Null

$versionCheck = & $PythonPath -c "import sys; print('%d.%d.%d' % sys.version_info[:3]); raise SystemExit(0 if sys.version_info[:2] == (3, 7) and sys.version_info[2] == 0 else 1)"
if ($LASTEXITCODE -ne 0) { throw "Compiler is not exact CPython 3.7.0: $versionCheck" }

$compileCode = @'
import py_compile
import sys
py_compile.compile(sys.argv[1], cfile=sys.argv[2], dfile=sys.argv[3], doraise=True, optimize=0)
'@
$moduleNames = @("__init__", "probe", "observers", "snapshot", "schema", "writer")
foreach ($moduleName in $moduleNames) {
    $source = Join-Path $sourceRoot ("ashley_e1\" + $moduleName + ".py")
    $destination = Join-Path $stageRoot ("ashley_e1\" + $moduleName + ".pyc")
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing source: $source" }
    & $PythonPath -c $compileCode $source $destination ("ashley_e1/" + $moduleName + ".py")
    if ($LASTEXITCODE -ne 0) { throw "Compile failed: $source" }
}

$zipCode = @'
import os
import sys
import zipfile
archive_path, stage = sys.argv[1:]
package = os.path.join(stage, 'ashley_e1')
with zipfile.ZipFile(archive_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name in sorted(os.listdir(package)):
        path = os.path.join(package, name)
        with open(path, 'rb') as handle:
            data = handle.read()
        info = zipfile.ZipInfo('ashley_e1/' + name, (1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.create_system = 0
        info.external_attr = 0
        archive.writestr(info, data)
'@
if (Test-Path -LiteralPath $artifact) { Remove-Item -LiteralPath $artifact -Force }
& $PythonPath -c $zipCode $artifact $stageRoot
if ($LASTEXITCODE -ne 0) { throw "Archive creation failed" }

$artifactHash = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToUpperInvariant()
Set-Content -LiteralPath $sidecar -Value $artifactHash -NoNewline -Encoding ASCII

$metadataCode = @'
import hashlib
import json
import os
import sys
root = sys.argv[1]
items = []
material = bytearray()
for name in sorted(os.listdir(os.path.join(root, 'ashley_e1'))):
    if not name.endswith('.py'):
        continue
    path = os.path.join(root, 'ashley_e1', name)
    with open(path, 'rb') as handle:
        data = handle.read()
    digest = hashlib.sha256(data).hexdigest().upper()
    rel = 'ashley_e1/' + name
    items.append({'path': rel, 'bytes': len(data), 'sha256': digest})
    material.extend(rel.encode('utf-8'))
    material.append(0)
    material.extend(data)
print(json.dumps({'files': items, 'source_content_sha256': hashlib.sha256(material).hexdigest().upper()}))
'@
$metadataJson = (& $PythonPath -c $metadataCode $sourceRoot | Out-String).Trim() | ConvertFrom-Json
$baselineCommit = if ([string]::IsNullOrWhiteSpace($BaselineCommit)) {
    (& git -C $repo rev-parse HEAD).Trim()
} else {
    $BaselineCommit.Trim()
}
$compilerHash = (Get-FileHash -LiteralPath $PythonPath -Algorithm SHA256).Hash.ToUpperInvariant()
$simsPythonDll = "E:\SteamLibrary\steamapps\common\The Sims 4\Game\Bin\python37_x64.dll"
$manifest = [ordered]@{
    manifest_version = 1
    probe_version = $Version
    target_sims_build = "1.128.90.1030"
    baseline_commit = $baselineCommit
    implemented_commit = $ImplementedCommit
    governing_documents = [ordered]@{
        master_sha256 = "A06C24544F23F3520FD0C1FDA78E375C8A24D12581BFB8D2E7D98EE0E4E178F3"
        plan_v1_2a_sha256 = "CBF47BF6803FE909F02C0BF2B0B0F21EBB78E139BDEB3595984F8E313130F683"
    }
    compiler = [ordered]@{
        implementation = "CPython"
        version = "3.7.0"
        architecture = "x64"
        source_url = "https://www.python.org/downloads/release/python-370/"
        installer_url = "https://www.python.org/ftp/python/3.7.0/python-3.7.0-amd64.exe"
        installer_md5 = "531C3FC821CE0A4107B6D2C6A129BE3E"
        installer_sha256 = "9D6AFA39538AADE3A2BACB099EF1C9F78E8D4AFAEFFF99057B902118845C5DDA"
        executable_path = $PythonPath
        executable_sha256 = $compilerHash
        embedded_package_url = "https://www.python.org/ftp/python/3.7.0/python-3.7.0-embed-amd64.zip"
        embedded_package_md5 = "CB8B4F0D979A36258F73ED541DEF10A5"
        embedded_package_sha256 = "0CC08F3C74C0112ABC2ADAFD16A534CDE12FE7C7AAFB42E936D59FD3AB08FCDB"
        optimize = 0
        pyc_placement = "legacy_adjacent"
    }
    pyc = [ordered]@{ magic_hex = "420d0d0a"; magic_decimal = 3394 }
    p1_game_dll = [ordered]@{
        path = $simsPythonDll
        filename = "python37_x64.dll"
        file_version = "3.7.150.1013"
        file_version_display = "3.7.0"
        file_version_raw = "3.7.150.1013"
        product_version = "3.7.0"
        description = "Python Core"
        sha256 = "3BD2257D1A7C3D405D25F989CC0E3C847213700397C3F86D7B64AFB910069AEC"
        verdict = "COMPATIBLE"
    }
    s4cl_source_consulted = "db1ca99"
    game_imports = @(
        [ordered]@{ name = "services"; evidence = "PRIOR_ART" },
        [ordered]@{ name = "sims.sim_info.SimInfo"; evidence = "PRIOR_ART" },
        [ordered]@{ name = "alarms.add_alarm_real_time"; evidence = "PRIOR_ART" },
        [ordered]@{ name = "alarms.cancel_alarm"; evidence = "PRIOR_ART" },
        [ordered]@{ name = "clock.interval_in_real_seconds"; evidence = "PRIOR_ART" },
        [ordered]@{ name = "sims4.commands.register"; evidence = "PRIOR_ART" }
    )
    source_content_sha256 = $metadataJson.source_content_sha256
    files = $metadataJson.files
    artifact = [ordered]@{
        filename = (Split-Path -Leaf $artifact)
        sha256 = $artifactHash
        bytes = (Get-Item -LiteralPath $artifact).Length
    }
}
$manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
Remove-Item -LiteralPath $stageRoot -Recurse -Force
Write-Output ("BUILD_PASS artifact=" + $artifact)
Write-Output ("BUILD_SHA256=" + $artifactHash)
