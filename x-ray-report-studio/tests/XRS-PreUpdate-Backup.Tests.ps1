$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\XRS-PreUpdate-Backup.ps1'
. $scriptPath -Library -ProfilePath $env:TEMP -DestinationRoot $env:TEMP

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Assert-Fails([scriptblock]$Action, [string]$Message) {
    $failed = $false
    try { & $Action | Out-Null } catch { $failed = $true }
    if (-not $failed) { throw $Message }
}

$tempRoot = Join-Path $env:TEMP ('XRS-Backup-Test-' + [guid]::NewGuid().ToString('N'))
$profile = Join-Path $tempRoot 'профиль-искусственный'
$dictionaryRoot = Join-Path $tempRoot 'общий-словарь'
$publicRoot = Join-Path $tempRoot 'публичные-документы'
$destination = Join-Path $tempRoot 'резервные-копии'
$appRoot = Join-Path $tempRoot 'X-ray Report Studio\App_20261111-test'
$oldDictionaryDir = $env:MRI_REPORT_STUDIO_DICTIONARY_DIR
$oldPublic = $env:PUBLIC

try {
    [void][IO.Directory]::CreateDirectory((Join-Path $profile 'Local Storage\leveldb'))
    [void][IO.Directory]::CreateDirectory($dictionaryRoot)
    [void][IO.Directory]::CreateDirectory((Join-Path $publicRoot 'Documents\MRI Report Studio'))
    [void][IO.Directory]::CreateDirectory($appRoot)
    $env:MRI_REPORT_STUDIO_DICTIONARY_DIR = $dictionaryRoot
    $env:PUBLIC = $publicRoot

    $syntheticOne = 'SYNTHETIC DOCUMENT CONTENT ONLY'
    $syntheticTwo = 'ИСКУССТВЕННЫЙ ТЕКСТ, НЕ ДАННЫЕ ПАЦИЕНТА'
    [IO.File]::WriteAllText((Join-Path $profile 'settings.json'), $syntheticOne, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $profile 'Local Storage\leveldb\черновик-искусственный.log'), $syntheticTwo, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $dictionaryRoot 'dictionary.json'), '["искусственный"]', [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $publicRoot 'Documents\MRI Report Studio\dictionary.json'), '["синтетический"]', [Text.UTF8Encoding]::new($false))

    $backupOne = New-XrsVerifiedBackup -ProfilePath $profile -DestinationRoot $destination `
        -DictionaryPath (Join-Path $dictionaryRoot 'dictionary.json') -Version '0.4.53' -TargetVersion '0.4.54' `
        -ReserveBytes 0 -InstallRoots @($appRoot) -ProcessList @()
    Assert-True ($backupOne.Files -eq 4) 'Backup did not include every profile and dictionary file.'
    $manifestOne = Assert-XrsBackupIntegrity $backupOne.Path
    Assert-True (@($manifestOne.files).Count -eq 4) 'Manifest file count does not match expected synthetic files.'
    $manifestText = Get-Content -LiteralPath (Join-Path $backupOne.Path 'manifest.json') -Raw -Encoding UTF8
    Assert-True (-not $manifestText.Contains($syntheticOne) -and -not $manifestText.Contains($syntheticTwo)) 'Manifest leaked synthetic file contents.'

    $backupTwo = New-XrsVerifiedBackup -ProfilePath $profile -DestinationRoot $destination `
        -DictionaryPath (Join-Path $dictionaryRoot 'dictionary.json') -Version '0.4.53' -TargetVersion '0.4.54' `
        -ReserveBytes 0 -InstallRoots @($appRoot) -ProcessList @()
    Assert-True ($backupOne.Path -ne $backupTwo.Path) 'A second backup overwrote the previous backup.'
    $tamperTarget = Join-Path $backupTwo.Path 'data\profile\settings.json'
    [IO.File]::AppendAllText($tamperTarget, 'tampered', [Text.UTF8Encoding]::new($false))
    Assert-Fails { Assert-XrsBackupIntegrity $backupTwo.Path } 'A modified backup passed manifest verification.'
    $null = Assert-XrsBackupIntegrity $backupOne.Path

    Assert-Fails { New-XrsVerifiedBackup -ProfilePath $profile -DestinationRoot (Join-Path $profile 'nested-backup') -ReserveBytes 0 -InstallRoots @($appRoot) -ProcessList @() } 'A destination inside the profile was accepted.'
    Assert-Fails { New-XrsVerifiedBackup -ProfilePath $profile -DestinationRoot $appRoot -ReserveBytes 0 -InstallRoots @($appRoot) -ProcessList @() } 'A destination inside an install folder was accepted.'
    Assert-Fails { New-XrsVerifiedBackup -ProfilePath $profile -DestinationRoot $destination -ReserveBytes ([long]::MaxValue) -InstallRoots @($appRoot) -ProcessList @() } 'Insufficient disk space was accepted.'
    $blockedParent = Join-Path $tempRoot 'this-is-a-file'
    [IO.File]::WriteAllText($blockedParent, 'synthetic', [Text.UTF8Encoding]::new($false))
    Assert-Fails { New-XrsVerifiedBackup -ProfilePath $profile -DestinationRoot (Join-Path $blockedParent 'backup') -ReserveBytes 0 -InstallRoots @($appRoot) -ProcessList @() } 'An inaccessible destination was accepted.'
    Assert-Fails { New-XrsVerifiedBackup -ProfilePath $profile -DestinationRoot $destination -ReserveBytes 0 -InstallRoots @($appRoot) -ProcessList @([pscustomobject]@{ Name='electron'; ExecutablePath=(Join-Path $appRoot 'resources\app\electron.exe'); CommandLine='' }) } 'A running Electron process was accepted.'

    $junctionTarget = Join-Path $tempRoot 'junction-target'
    $junction = Join-Path $profile 'unsafe-junction'
    [void][IO.Directory]::CreateDirectory($junctionTarget)
    New-Item -ItemType Junction -Path $junction -Target $junctionTarget | Out-Null
    Assert-Fails { New-XrsVerifiedBackup -ProfilePath $profile -DestinationRoot $destination -ReserveBytes 0 -InstallRoots @($appRoot) -ProcessList @() } 'A profile containing a junction was accepted.'
    Remove-Item -LiteralPath $junction -Force

    $powershell = Join-Path $PSHOME 'powershell.exe'
    $cliDestination = Join-Path $tempRoot 'cli-backups'
    $cliOutput = & $powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath `
        -ProfilePath $profile -DestinationRoot $cliDestination -DictionaryPath (Join-Path $dictionaryRoot 'dictionary.json') `
        -ReserveBytes 0 2>&1
    Assert-True ($LASTEXITCODE -eq 0 -and ($cliOutput -join "`n") -match 'BACKUP VERIFIED') 'The command-line success result was not reported.'
    $cliFailure = & $powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath `
        -ProfilePath $profile -DestinationRoot $cliDestination -DictionaryPath (Join-Path $dictionaryRoot 'dictionary.json') `
        -ReserveBytes ([long]::MaxValue) 2>&1
    Assert-True ($LASTEXITCODE -ne 0 -and ($cliFailure -join "`n") -match 'BACKUP FAILED') 'The command-line failure result was not reported.'
    Assert-True (@(Get-ChildItem -LiteralPath $cliDestination -Directory -ErrorAction SilentlyContinue).Count -eq 0) 'A failed run left an incomplete backup folder.'

    Write-Output 'XRS pre-update backup tests passed using synthetic data.'
} finally {
    $env:MRI_REPORT_STUDIO_DICTIONARY_DIR = $oldDictionaryDir
    $env:PUBLIC = $oldPublic
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
