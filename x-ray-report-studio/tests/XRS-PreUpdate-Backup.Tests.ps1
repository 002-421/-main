[CmdletBinding()]
param(
    [ValidateSet('All', 'Core', 'CliSuccess', 'CliFailureExit', 'CliFailureOutput', 'CliCleanup')]
    [string]$TestGroup = 'All'
)

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

function Invoke-BackupCli([string]$ScriptFile, [string]$ProfilePath, [string]$DestinationPath, [string]$DictionaryFile, [long]$ReserveBytes, [string]$OutputPrefix) {
    $powershell = Join-Path $PSHOME 'powershell.exe'
    $stdoutPath = $OutputPrefix + '.stdout.txt'
    $stderrPath = $OutputPrefix + '.stderr.txt'
    $arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -ProfilePath "{1}" -DestinationRoot "{2}" -DictionaryPath "{3}" -ReserveBytes {4}' -f `
        $ScriptFile, $ProfilePath, $DestinationPath, $DictionaryFile, $ReserveBytes
    $process = Start-Process -FilePath $powershell -ArgumentList $arguments -PassThru -Wait -NoNewWindow `
        -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    $stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw } else { '' }
    $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { '' }
    return [pscustomobject]@{ ExitCode=$process.ExitCode; Output=($stdout + [Environment]::NewLine + $stderr) }
}

$tempRoot = Join-Path $env:TEMP ('XRS-Backup-Test-' + [guid]::NewGuid().ToString('N'))
$profile = Join-Path $tempRoot 'профиль-искусственный'
$dictionaryRoot = Join-Path $tempRoot 'общий-словарь'
$publicRoot = Join-Path $tempRoot 'публичные-документы'
$destination = Join-Path $tempRoot 'резервные-копии'
$appRoot = Join-Path $tempRoot 'X-ray Report Studio\App_20261111-test'
$oldDictionaryDir = $env:MRI_REPORT_STUDIO_DICTIONARY_DIR
$oldPublic = $env:PUBLIC
$noAppProcesses = @([pscustomobject]@{ Name='synthetic-test-host'; ExecutablePath=''; CommandLine='' })
$phase = 'initialize synthetic fixture'

try {
    $phase = 'create synthetic profile and dictionaries'
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

    if ($TestGroup -eq 'All' -or $TestGroup -eq 'Core') {
    $phase = 'create and verify first backup with Cyrillic paths'
    $backupOne = New-XrsVerifiedBackup -ProfilePath $profile -DestinationRoot $destination `
        -DictionaryPath (Join-Path $dictionaryRoot 'dictionary.json') -Version '0.4.53' -TargetVersion '0.4.54' `
        -ReserveBytes 0 -InstallRoots @($appRoot) -ProcessList $noAppProcesses
    Assert-True ($backupOne.Files -eq 4) 'Backup did not include every profile and dictionary file.'
    $manifestOne = Assert-XrsBackupIntegrity $backupOne.Path
    Assert-True (@($manifestOne.files).Count -eq 4) 'Manifest file count does not match expected synthetic files.'
    $manifestText = Get-Content -LiteralPath (Join-Path $backupOne.Path 'manifest.json') -Raw -Encoding UTF8
    Assert-True (-not $manifestText.Contains($syntheticOne) -and -not $manifestText.Contains($syntheticTwo)) 'Manifest leaked synthetic file contents.'
    $restoredSettings = Join-Path $tempRoot 'восстановление с пробелом\профиль\settings.json'
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $restoredSettings))
    [IO.File]::Copy((Join-Path $backupOne.Path 'data\profile\settings.json'), $restoredSettings, $false)
    Assert-True ([IO.File]::ReadAllText($restoredSettings) -ceq $syntheticOne) 'A synthetic settings file could not be restored from the verified backup.'
    Assert-Fails { Get-XrsSha256 (Join-Path $tempRoot 'отсутствующий файл.json') } 'An absent file was accepted as hashable.'
    $nestedRestored = Join-Path $tempRoot 'восстановление с пробелом\профиль\Local Storage\leveldb\черновик-искусственный.log'
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $nestedRestored))
    [IO.File]::Copy((Join-Path $backupOne.Path 'data\profile\Local Storage\leveldb\черновик-искусственный.log'), $nestedRestored, $false)
    Assert-True ([IO.File]::ReadAllText($nestedRestored) -ceq $syntheticTwo) 'A nested Cyrillic file could not be restored from the verified backup.'

    $phase = 'create unique second backup and verify tamper detection'
    $backupTwo = New-XrsVerifiedBackup -ProfilePath $profile -DestinationRoot $destination `
        -DictionaryPath (Join-Path $dictionaryRoot 'dictionary.json') -Version '0.4.53' -TargetVersion '0.4.54' `
        -ReserveBytes 0 -InstallRoots @($appRoot) -ProcessList $noAppProcesses
    Assert-True ($backupOne.Path -ne $backupTwo.Path) 'A second backup overwrote the previous backup.'
    $tamperTarget = Join-Path $backupTwo.Path 'data\profile\settings.json'
    [IO.File]::AppendAllText($tamperTarget, 'tampered', [Text.UTF8Encoding]::new($false))
    Assert-Fails { Assert-XrsBackupIntegrity $backupTwo.Path } 'A modified backup passed manifest verification.'
    Remove-Item -LiteralPath (Join-Path $backupTwo.Path 'data\dictionaries\dictionary-0001.json') -Force
    Assert-Fails { Assert-XrsBackupIntegrity $backupTwo.Path } 'A backup with a missing file passed manifest verification.'
    $null = Assert-XrsBackupIntegrity $backupOne.Path

    $phase = 'refuse unsafe destinations, insufficient space and running Electron'
    Assert-Fails { New-XrsVerifiedBackup -ProfilePath $profile -DestinationRoot (Join-Path $profile 'nested-backup') -ReserveBytes 0 -InstallRoots @($appRoot) -ProcessList $noAppProcesses } 'A destination inside the profile was accepted.'
    Assert-Fails { New-XrsVerifiedBackup -ProfilePath $profile -DestinationRoot $appRoot -ReserveBytes 0 -InstallRoots @($appRoot) -ProcessList $noAppProcesses } 'A destination inside an install folder was accepted.'
    Assert-Fails { New-XrsVerifiedBackup -ProfilePath $profile -DestinationRoot $destination -ReserveBytes ([long]::MaxValue) -InstallRoots @($appRoot) -ProcessList $noAppProcesses } 'Insufficient disk space was accepted.'
    $blockedParent = Join-Path $tempRoot 'this-is-a-file'
    [IO.File]::WriteAllText($blockedParent, 'synthetic', [Text.UTF8Encoding]::new($false))
    Assert-Fails { New-XrsVerifiedBackup -ProfilePath $profile -DestinationRoot (Join-Path $blockedParent 'backup') -ReserveBytes 0 -InstallRoots @($appRoot) -ProcessList $noAppProcesses } 'An inaccessible destination was accepted.'
    $runningElectron = @([pscustomobject]@{ Name='electron'; ExecutablePath=(Join-Path $appRoot 'resources\app\electron.exe'); CommandLine='' })
    Assert-True (@(Get-XrsRunningAppProcesses -ProcessList $runningElectron -InstallRoots @($appRoot) -ProfileRoot $profile).Count -eq 1) 'The installed Electron process was not identified.'
    Assert-Fails { New-XrsVerifiedBackup -ProfilePath $profile -DestinationRoot $destination -ReserveBytes 0 -InstallRoots @($appRoot) -ProcessList $runningElectron } 'A running Electron process was accepted.'

    $phase = 'refuse a profile containing a symbolic link or junction'
    $junctionTarget = Join-Path $tempRoot 'junction-target'
    $junction = Join-Path $profile 'unsafe-junction'
    [void][IO.Directory]::CreateDirectory($junctionTarget)
    if ($env:OS -eq 'Windows_NT') {
        $junctionCommand = 'mklink /J "{0}" "{1}"' -f $junction, $junctionTarget
        & $env:ComSpec /d /c $junctionCommand | Out-Null
        if ($LASTEXITCODE -ne 0) { throw ('Could not create the synthetic junction needed for the refusal test. Exit code: ' + $LASTEXITCODE) }
    }
    else { New-Item -ItemType SymbolicLink -Path $junction -Target $junctionTarget | Out-Null }
    Assert-Fails { New-XrsVerifiedBackup -ProfilePath $profile -DestinationRoot $destination -ReserveBytes 0 -InstallRoots @($appRoot) -ProcessList $noAppProcesses } 'A profile containing a link was accepted.'
    Remove-Item -LiteralPath $junction -Force
    }

    if ($env:OS -eq 'Windows_NT' -and $TestGroup -ne 'Core') {
        $cliDestination = Join-Path $tempRoot 'cli-backups'
        $expectedBackupDirectories = 0
        if ($TestGroup -eq 'All' -or $TestGroup -eq 'CliSuccess') {
        $phase = 'verify successful command-line result'
        $cliSuccess = Invoke-BackupCli -ScriptFile $scriptPath -ProfilePath $profile -DestinationPath $cliDestination `
            -DictionaryFile (Join-Path $dictionaryRoot 'dictionary.json') -ReserveBytes 0 -OutputPrefix (Join-Path $tempRoot 'cli-success')
        Assert-True ($cliSuccess.ExitCode -eq 0 -and $cliSuccess.Output -match 'BACKUP VERIFIED') 'The command-line success result was not reported.'
        $expectedBackupDirectories = @(Get-ChildItem -LiteralPath $cliDestination -Directory -ErrorAction SilentlyContinue).Count
        }
        if ($TestGroup -eq 'All' -or $TestGroup -in @('CliFailureExit', 'CliFailureOutput', 'CliCleanup')) {
        $phase = 'verify failed command-line result and absence of partial backup'
        $cliFailure = Invoke-BackupCli -ScriptFile $scriptPath -ProfilePath $profile -DestinationPath $cliDestination `
            -DictionaryFile (Join-Path $dictionaryRoot 'dictionary.json') -ReserveBytes 9000000000000 -OutputPrefix (Join-Path $tempRoot 'cli-failure')
        if ($TestGroup -eq 'All' -or $TestGroup -eq 'CliFailureExit') {
            Assert-True ($cliFailure.ExitCode -ne 0) 'The command-line failure result returned a success exit code.'
        }
        if ($TestGroup -eq 'All' -or $TestGroup -eq 'CliFailureOutput') {
            Assert-True ($cliFailure.Output -match 'BACKUP FAILED') 'The command-line BACKUP FAILED message was not reported.'
        }
        if ($TestGroup -eq 'All' -or $TestGroup -eq 'CliCleanup') {
            Assert-True (@(Get-ChildItem -LiteralPath $cliDestination -Directory -ErrorAction SilentlyContinue).Count -eq $expectedBackupDirectories) 'A failed run left an incomplete backup folder or changed an earlier backup.'
        }
        }
    }

    Write-Output 'XRS pre-update backup tests passed using synthetic data.'
} catch {
    $diagnostic = 'Phase: ' + $phase + [Environment]::NewLine +
        'Exception type: ' + $_.Exception.GetType().FullName + [Environment]::NewLine +
        'PowerShell error id: ' + $_.FullyQualifiedErrorId + [Environment]::NewLine
    $diagnosticPath = Join-Path $PSScriptRoot '..\test-output\XRS-PreUpdate-Backup-Failure.txt'
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($diagnosticPath))
    [IO.File]::WriteAllText($diagnosticPath, $diagnostic, [Text.UTF8Encoding]::new($false))
    Write-Error $diagnostic
    throw
} finally {
    $env:MRI_REPORT_STUDIO_DICTIONARY_DIR = $oldDictionaryDir
    $env:PUBLIC = $oldPublic
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
