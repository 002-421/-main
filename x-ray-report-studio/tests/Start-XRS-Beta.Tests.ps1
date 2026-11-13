$ErrorActionPreference = 'Stop'
$oldAppData = $env:APPDATA
$oldPublic = $env:PUBLIC
$temporary = Join-Path $env:TEMP ('XRS Beta Тест ' + [guid]::NewGuid().ToString('N'))
try {
    $env:APPDATA = Join-Path $temporary 'Роуминг с пробелом'
    $env:PUBLIC = Join-Path $temporary 'Общие документы'
    $kit = Join-Path $temporary 'Beta комплект'
    New-Item -ItemType Directory -Path $env:APPDATA, $env:PUBLIC, $kit -Force | Out-Null
    $source = Split-Path -Parent $PSScriptRoot
    Copy-Item -LiteralPath (Join-Path $source 'scripts/Start-XRS-Beta.ps1') -Destination $kit
    Copy-Item -LiteralPath (Join-Path $source 'scripts/XRS-PreUpdate-Backup.ps1') -Destination $kit
    Set-Content -LiteralPath (Join-Path $kit 'X-ray Report Studio.exe') -Value 'synthetic executable' -Encoding Ascii
    $stable = Join-Path $env:APPDATA 'MRI Report Studio'
    New-Item -ItemType Directory -Path $stable -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $stable 'synthetic-workspace.json') -Value '{"synthetic":true}' -Encoding UTF8
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $kit 'Start-XRS-Beta.ps1') -ValidationOnly | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Beta onboarding did not verify the synthetic Stable backup.' }
    $channel = Get-Content -LiteralPath (Join-Path $env:APPDATA 'X-ray Report Studio Channel.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($channel.channel -ne 'beta' -or $channel.profile -ne 'beta' -or $channel.onboarded -ne $true) { throw 'Beta profile was not selected after backup.' }
    $manifests = @(Get-ChildItem -LiteralPath (Join-Path $env:APPDATA 'X-ray Report Studio Backups') -Recurse -Filter manifest.json)
    if ($manifests.Count -ne 1) { throw 'Expected one verified synthetic backup.' }
    $manifest = Get-Content -LiteralPath $manifests[0].FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.applicationVersion -ne '0.4.54' -or $manifest.targetVersion -ne '0.4.55-beta.1') { throw 'Backup version metadata is incorrect.' }
    if (-not (Test-Path -LiteralPath (Join-Path $stable 'synthetic-workspace.json'))) { throw 'Stable profile was modified.' }

    Remove-Item -LiteralPath (Join-Path $env:APPDATA 'X-ray Report Studio Channel.json') -Force
    Remove-Item -LiteralPath (Join-Path $env:APPDATA 'X-ray Report Studio Backups') -Recurse -Force
    Set-Content -LiteralPath (Join-Path $env:APPDATA 'X-ray Report Studio Backups') -Value 'not a directory' -Encoding Ascii
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $kit 'Start-XRS-Beta.ps1') -ValidationOnly | Out-Null
    if ($LASTEXITCODE -eq 0) { throw 'Beta onboarding must fail when backup cannot be created.' }
    if (Test-Path -LiteralPath (Join-Path $env:APPDATA 'X-ray Report Studio Channel.json')) { throw 'Failed backup changed the update channel.' }
    Write-Host 'PASS: isolated Beta onboarding verifies a synthetic backup and refuses backup failure.'
} finally {
    $env:APPDATA = $oldAppData
    $env:PUBLIC = $oldPublic
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
}
