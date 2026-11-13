param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Diagnostics', 'Acceptance')]
  [string] $Mode,
  [Parameter(Mandatory = $true)]
  [string] $Archive,
  [Parameter(Mandatory = $true)]
  [string] $SourcePath,
  [Parameter(Mandatory = $true)]
  [string] $DiagnosticsPath
)

$ErrorActionPreference = 'Stop'
$toolsRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$source = (Resolve-Path $SourcePath).Path
$archivePath = (Resolve-Path $Archive).Path
$output = [System.IO.Path]::GetFullPath($DiagnosticsPath)
$runnerTemp = $env:RUNNER_TEMP
if (-not $runnerTemp) { $runnerTemp = [System.IO.Path]::GetTempPath() }
$runId = [guid]::NewGuid().ToString('N')
$extractPath = Join-Path $runnerTemp "xrs-$Mode-package-$runId"
$profilePath = Join-Path $runnerTemp "xrs-$Mode-profile-$runId"
$dictionaryPath = Join-Path $runnerTemp "xrs-$Mode-dictionary-$runId"
$firewallName = "XRS $Mode offline smoke $runId"
$scriptName = if ($Mode -eq 'Diagnostics') { 'windows-ai-review-diagnostics.mjs' } else { 'windows-ai-review-acceptance.mjs' }
$statusFile = Join-Path $output 'wrapper-status.json'

New-Item -ItemType Directory -Path $output -Force | Out-Null
$status = [ordered]@{ mode = $Mode; status = 'FAIL'; reason = ''; profile_isolated = $false; firewall_blocked = $false; diagnostic_files = @() }

try {
  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath
  $exe = Join-Path $extractPath 'X-ray Report Studio/X-ray Report Studio.exe'
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Packaged application executable is missing' }

  New-Item -ItemType Directory -Path $profilePath -Force | Out-Null
  New-Item -ItemType Directory -Path $dictionaryPath -Force | Out-Null
  $rule = New-NetFirewallRule -DisplayName $firewallName -Direction Outbound -Program $exe -RemoteAddress Any -Action Block -Profile Any
  if (-not $rule -or $rule.Action -ne 'Block') { throw 'Could not install the per-EXE outbound block rule' }
  $status.profile_isolated = $true
  $status.firewall_blocked = $true
  Write-Output "PROFILE POLICY: temporary --user-data-dir and dictionary paths are isolated for $Mode."
  Write-Output 'OFFLINE POLICY: outbound traffic from the packaged EXE is blocked; updater traffic is separately identified.'

  $env:XRS_SMOKE_EXE = $exe
  $env:XRS_SMOKE_PROFILE = $profilePath
  $env:XRS_SMOKE_PLAYWRIGHT_CORE = Join-Path $source 'node_modules/playwright-core'
  $env:MRI_REPORT_STUDIO_DICTIONARY_DIR = $dictionaryPath
  $env:XRS_SMOKE_OUTPUT = $output
  $env:XRS_SMOKE_MODE = $Mode
  node (Join-Path $toolsRoot "tests/$scriptName")
  $nodeExitCode = $LASTEXITCODE
  if ($nodeExitCode -ne 0) { throw "$Mode Playwright runner failed with exit code $nodeExitCode" }
  $status.status = 'PASS'
} catch {
  $status.reason = $_.Exception.Message
  $failure = [ordered]@{ mode = $Mode; status = 'FAIL'; reason = $status.reason; profile_isolated = $status.profile_isolated; firewall_blocked = $status.firewall_blocked }
  $failure | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'wrapper-failure.json') -Encoding utf8
} finally {
  if (Test-Path -LiteralPath (Join-Path $profilePath 'logs')) {
    $logDir = Join-Path $output 'electron-logs'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $profilePath 'logs') -File -Filter 'startup-*.log' -ErrorAction SilentlyContinue |
      Copy-Item -Destination $logDir -Force
    Get-ChildItem -LiteralPath (Join-Path $profilePath 'logs') -File -Filter 'update-*.log' -ErrorAction SilentlyContinue |
      Copy-Item -Destination $logDir -Force
  }

  $status.diagnostic_files = @(Get-ChildItem -LiteralPath $output -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName.Substring($output.Length).TrimStart('\', '/') })
  $status | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statusFile -Encoding utf8

  Remove-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue
  Remove-Item Env:XRS_SMOKE_EXE -ErrorAction SilentlyContinue
  Remove-Item Env:XRS_SMOKE_PROFILE -ErrorAction SilentlyContinue
  Remove-Item Env:XRS_SMOKE_PLAYWRIGHT_CORE -ErrorAction SilentlyContinue
  Remove-Item Env:MRI_REPORT_STUDIO_DICTIONARY_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:XRS_SMOKE_OUTPUT -ErrorAction SilentlyContinue
  Remove-Item Env:XRS_SMOKE_MODE -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $extractPath -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $profilePath -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $dictionaryPath -Recurse -Force -ErrorAction SilentlyContinue
}

if ($status.status -ne 'PASS') {
  Write-Error $status.reason
  exit 1
}
