param(
  [Parameter(Mandatory = $true)]
  [string] $Archive,
  [Parameter(Mandatory = $true)]
  [string] $SourcePath
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$source = (Resolve-Path (Join-Path $repo $SourcePath)).Path
$archivePath = (Resolve-Path (Join-Path $source $Archive)).Path
$runnerTemp = $env:RUNNER_TEMP
if (-not $runnerTemp) { $runnerTemp = [System.IO.Path]::GetTempPath() }
$runId = [guid]::NewGuid().ToString('N')
$extractPath = Join-Path $runnerTemp "xrs-offline-$runId"
$profilePath = Join-Path $runnerTemp "xrs-profile-$runId"
$dictionaryPath = Join-Path $runnerTemp "xrs-dictionary-$runId"
$firewallName = "XRS offline smoke $runId"

try {
  python (Join-Path $repo 'scripts/verify_windows_portable.py') $archivePath --expected-html (Join-Path $source 'dist/index.html')
  if ($LASTEXITCODE -ne 0) { throw 'Portable ZIP verification failed' }

  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath
  $exe = Join-Path $extractPath 'X-ray Report Studio/X-ray Report Studio.exe'
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Packaged application executable is missing' }

  New-Item -ItemType Directory -Path $profilePath -Force | Out-Null
  $rule = New-NetFirewallRule -DisplayName $firewallName -Direction Outbound -Program $exe -RemoteAddress Any -Action Block -Profile Any
  if (-not $rule -or $rule.Action -ne 'Block') { throw 'Could not install the per-EXE outbound block rule' }
  Write-Output 'OFFLINE POLICY: outbound traffic from the packaged EXE, including the separate version-check path, is blocked.'

  $env:XRS_SMOKE_EXE = $exe
  $env:XRS_SMOKE_PROFILE = $profilePath
  $env:XRS_SMOKE_PLAYWRIGHT_CORE = Join-Path $source 'node_modules/playwright-core'
  $env:MRI_REPORT_STUDIO_DICTIONARY_DIR = $dictionaryPath
  Write-Output 'PROFILE POLICY: app profile and shared dictionary are redirected to per-run temporary directories.'
  node (Join-Path $repo 'tests/windows-ai-review-smoke.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Packaged AI Review smoke test failed' }
}
finally {
  Remove-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue
  Remove-Item Env:XRS_SMOKE_EXE -ErrorAction SilentlyContinue
  Remove-Item Env:XRS_SMOKE_PROFILE -ErrorAction SilentlyContinue
  Remove-Item Env:XRS_SMOKE_PLAYWRIGHT_CORE -ErrorAction SilentlyContinue
  Remove-Item Env:MRI_REPORT_STUDIO_DICTIONARY_DIR -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $extractPath -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $profilePath -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $dictionaryPath -Recurse -Force -ErrorAction SilentlyContinue
}
