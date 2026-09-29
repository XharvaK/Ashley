param(
    [string]$Version = "1.0.6",
    [string]$PythonPath = "C:\Users\Xharv\AppData\Local\Programs\Python\Python370-AshleyE1\python.exe"
)

$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$buildRoot = Join-Path $repo "sims-e1\build"
$artifact = Join-Path $buildRoot ("ashley_e1_" + $Version + ".ts4script")
$sidecar = $artifact + ".sha256"
$manifestPath = Join-Path $buildRoot "manifest.json"
$logPath = Join-Path $buildRoot "verify.log"
$lines = New-Object System.Collections.Generic.List[string]
$failed = $false

function Record-Pass([string]$Message) {
    $line = "VERIFY_PASS " + $Message
    $lines.Add($line)
    Write-Output $line
}
function Record-Fail([string]$Message) {
    $script:failed = $true
    $line = "VERIFY_FAIL " + $Message
    $lines.Add($line)
    Write-Output $line
}

if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) { Record-Fail "artifact missing" }
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { Record-Fail "manifest missing" }
if (-not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) { Record-Fail "pinned compiler missing" }

if (-not $failed) {
    $versionText = (& $PythonPath -c "import sys; print('%d.%d.%d' % sys.version_info[:3]); raise SystemExit(0 if sys.version_info[:2] == (3, 7) and sys.version_info[2] == 0 else 1)")
    if ($LASTEXITCODE -eq 0) { Record-Pass ("compiler=" + $versionText.Trim()) } else { Record-Fail "compiler is not CPython 3.7.0" }
}

$systemPython = (Get-Command python -ErrorAction SilentlyContinue).Source
if ($null -eq $systemPython) {
    Record-Fail "system Python unavailable"
} else {
    $systemVersion = (& $systemPython --version 2>&1 | Out-String).Trim()
    if ($systemVersion -match '^Python 3\.14\.') { Record-Pass ("system=" + $systemVersion) }
    else { Record-Fail ("system Python must be 3.14.x: " + $systemVersion) }
}

if (-not $failed) {
    $guardOutput = & $PythonPath (Join-Path $repo "sims-e1\tools\check_guards.py") (Join-Path $repo "sims-e1\src") 2>&1
    if ($LASTEXITCODE -eq 0) { Record-Pass "AST guards" } else { Record-Fail ("AST guards: " + ($guardOutput -join " | ")) }
    $testOutput = & $systemPython -m unittest discover -s (Join-Path $repo "sims-e1\tests") -p "test_*.py" 2>&1
    if ($LASTEXITCODE -eq 0) { Record-Pass "focused tests under system Python" } else { Record-Fail ("system tests: " + ($testOutput -join " | ")) }
    $pinnedOutput = & $PythonPath -m unittest discover -s (Join-Path $repo "sims-e1\tests") -p "test_*.py" 2>&1
    if ($LASTEXITCODE -eq 0) { Record-Pass "focused tests under CPython 3.7.0" } else { Record-Fail ("pinned tests: " + ($pinnedOutput -join " | ")) }
}

$packageCode = @'
import hashlib
import json
import os
import sys
import zipfile
artifact, manifest_path, source_root, sidecar, expected_version = sys.argv[1:]
sys.path.insert(0, os.path.join(os.path.dirname(manifest_path), '..', 'tools'))
from check_guards import inspect_archive
with open(manifest_path, 'r', encoding='utf-8-sig') as handle:
    manifest = json.load(handle)
expected_magic = bytes.fromhex('420d0d0a')
errors = inspect_archive(artifact, expected_magic)
if manifest.get('probe_version') != expected_version:
    errors.append('manifest probe version mismatch')
if manifest.get('target_sims_build') != '1.128.90.1030':
    errors.append('target Sims build mismatch')
if manifest.get('compiler', {}).get('version') != '3.7.0' or manifest.get('compiler', {}).get('architecture') != 'x64':
    errors.append('compiler pin mismatch')
compiler = manifest.get('compiler', {})
if compiler.get('installer_url') != 'https://www.python.org/ftp/python/3.7.0/python-3.7.0-amd64.exe':
    errors.append('compiler installer URL mismatch')
if compiler.get('installer_md5') != '531C3FC821CE0A4107B6D2C6A129BE3E' or compiler.get('installer_sha256') != '9D6AFA39538AADE3A2BACB099EF1C9F78E8D4AFAEFFF99057B902118845C5DDA':
    errors.append('compiler installer identity mismatch')
if compiler.get('embedded_package_url') != 'https://www.python.org/ftp/python/3.7.0/python-3.7.0-embed-amd64.zip':
    errors.append('compiler embedded URL mismatch')
if compiler.get('embedded_package_md5') != 'CB8B4F0D979A36258F73ED541DEF10A5' or compiler.get('embedded_package_sha256') != '0CC08F3C74C0112ABC2ADAFD16A534CDE12FE7C7AAFB42E936D59FD3AB08FCDB':
    errors.append('compiler embedded identity mismatch')
compiler_path = compiler.get('executable_path')
if not compiler_path or not os.path.isfile(compiler_path):
    errors.append('recorded compiler executable missing')
else:
    with open(compiler_path, 'rb') as handle:
        compiler_hash = hashlib.sha256(handle.read()).hexdigest().upper()
    if compiler_hash != compiler.get('executable_sha256'):
        errors.append('compiler executable hash mismatch')
if manifest.get('p1_game_dll', {}).get('verdict') != 'COMPATIBLE':
    errors.append('P1 DLL verdict mismatch')
p1 = manifest.get('p1_game_dll', {})
if os.path.basename(p1.get('path', '')) != p1.get('filename'):
    errors.append('P1 DLL path/filename mismatch')
if not p1.get('path') or not os.path.isfile(p1['path']):
    errors.append('recorded P1 DLL missing')
else:
    with open(p1['path'], 'rb') as handle:
        dll_hash = hashlib.sha256(handle.read()).hexdigest().upper()
    if dll_hash != p1.get('sha256'):
        errors.append('P1 DLL hash mismatch')
with open(artifact, 'rb') as handle:
    artifact_hash = hashlib.sha256(handle.read()).hexdigest().upper()
if artifact_hash != manifest.get('artifact', {}).get('sha256'):
    errors.append('manifest artifact hash mismatch')
with open(sidecar, 'r', encoding='ascii') as handle:
    if handle.read().strip().upper() != artifact_hash:
        errors.append('sidecar hash mismatch')
material = bytearray()
source_items = {}
for name in sorted(os.listdir(os.path.join(source_root, 'ashley_e1'))):
    if not name.endswith('.py'):
        continue
    rel = 'ashley_e1/' + name
    with open(os.path.join(source_root, 'ashley_e1', name), 'rb') as handle:
        data = handle.read()
    source_items[rel] = {'path': rel, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest().upper()}
    material.extend(rel.encode('utf-8'))
    material.append(0)
    material.extend(data)
if hashlib.sha256(material).hexdigest().upper() != manifest.get('source_content_sha256'):
    errors.append('source content digest mismatch')
manifest_items = {item.get('path'): item for item in manifest.get('files', [])}
if set(manifest_items) != set(source_items):
    errors.append('manifest source file set mismatch')
for path, item in source_items.items():
    if manifest_items.get(path) != item:
        errors.append('manifest source file hash mismatch: ' + path)
with zipfile.ZipFile(artifact, 'r') as archive:
    expected_members = {'ashley_e1/' + path.rsplit('/', 1)[-1] + 'c' for path in source_items}
    if set(archive.namelist()) != expected_members:
        errors.append('artifact member set mismatch')
if manifest.get('governing_documents', {}).get('master_sha256') != 'A06C24544F23F3520FD0C1FDA78E375C8A24D12581BFB8D2E7D98EE0E4E178F3':
    errors.append('master hash mismatch')
if manifest.get('governing_documents', {}).get('plan_v1_2a_sha256') != 'CBF47BF6803FE909F02C0BF2B0B0F21EBB78E139BDEB3595984F8E313130F683':
    errors.append('plan hash mismatch')
for error in errors:
    print(error)
raise SystemExit(1 if errors else 0)
'@
if (-not $failed) {
    $packageOutput = & $PythonPath -c $packageCode $artifact $manifestPath (Join-Path $repo "sims-e1\src") $sidecar $Version 2>&1
    if ($LASTEXITCODE -eq 0) { Record-Pass "artifact layout, magic, hashes, manifest, source digest" }
    else { Record-Fail ("artifact verification: " + ($packageOutput -join " | ")) }
}

$lines | Set-Content -LiteralPath $logPath -Encoding UTF8
if ($failed) { exit 1 }
Write-Output "VERIFY_PASS all checks"
