param([switch]$ValidationOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$app = Join-Path $root 'X-ray Report Studio.exe'
$stable = Join-Path $env:APPDATA 'MRI Report Studio'
$beta = Join-Path $env:APPDATA 'MRI Report Studio Beta'
$channel = Join-Path $env:APPDATA 'X-ray Report Studio Channel.json'
$backups = Join-Path $env:APPDATA 'X-ray Report Studio Backups'
$backupScript = Join-Path $root 'XRS-PreUpdate-Backup.ps1'

try {
    if (-not (Test-Path -LiteralPath $app -PathType Leaf)) { throw 'Beta EXE is missing.' }
    if (Test-Path -LiteralPath $beta) {
        $item = Get-Item -LiteralPath $beta -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or -not $item.PSIsContainer) { throw 'Beta profile path is unsafe.' }
    }
    $onboarded = $false
    if (Test-Path -LiteralPath $channel -PathType Leaf) {
        try { $onboarded = ((Get-Content -LiteralPath $channel -Raw -Encoding UTF8 | ConvertFrom-Json).onboarded -eq $true) }
        catch { throw 'Channel settings are damaged; no profile was changed.' }
    }
    if (-not $onboarded -and (Test-Path -LiteralPath $stable -PathType Container)) {
        if (-not (Test-Path -LiteralPath $backupScript -PathType Leaf)) { throw 'Verified backup script is missing.' }
        . $backupScript -Library
        $verifiedBackup = New-XrsVerifiedBackup -ProfilePath $stable -DestinationRoot $backups `
            -Version '0.4.54' -TargetVersion '0.4.55-beta.1' -InstallRoots @(Get-XrsInstallRoots)
        if ($null -eq $verifiedBackup -or -not (Test-Path -LiteralPath (Join-Path $verifiedBackup.Path 'manifest.json') -PathType Leaf)) {
            throw 'Stable profile backup could not be verified. Beta was not started.'
        }
        $null = Assert-XrsBackupIntegrity $verifiedBackup.Path
    }
    if (-not (Test-Path -LiteralPath $beta)) { $null = New-Item -ItemType Directory -Path $beta -Force }
    $value = @{ channel = 'beta'; profile = 'beta'; onboarded = $true } | ConvertTo-Json -Compress
    $temporary = Join-Path $env:APPDATA ('.xrs-beta-channel-' + [guid]::NewGuid().ToString('N') + '.tmp')
    [IO.File]::WriteAllText($temporary, $value, (New-Object System.Text.UTF8Encoding $false))
    try {
        if (Test-Path -LiteralPath $channel) {
            $old = $temporary + '.old'
            [IO.File]::Replace($temporary, $channel, $old)
            Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue
        } else { [IO.File]::Move($temporary, $channel) }
    } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
    if (-not $ValidationOnly) {
        $startArguments = @()
        if (-not [string]::IsNullOrWhiteSpace($env:XRS_BETA_USER_DATA_DIR)) {
            $testProfile = [IO.Path]::GetFullPath($env:XRS_BETA_USER_DATA_DIR)
            if (-not [IO.Path]::IsPathRooted($testProfile) -or (Test-XrsPathWithin $testProfile $stable) -or (Test-XrsPathWithin $stable $testProfile)) {
                throw 'The isolated Beta profile path is invalid.'
            }
            $null = [IO.Directory]::CreateDirectory($testProfile)
            $startArguments = @('--user-data-dir="' + $testProfile + '"')
        }
        $started = Start-Process -FilePath $app -ArgumentList $startArguments -PassThru
        if (-not [string]::IsNullOrWhiteSpace($env:XRS_BETA_SMOKE_PID_FILE)) {
            [IO.File]::WriteAllText($env:XRS_BETA_SMOKE_PID_FILE, [string]$started.Id, [Text.UTF8Encoding]::new($false))
        }
    }
    Write-Host 'BETA PROFILE READY; Stable data and installation were not changed.'
    exit 0
} catch {
    Write-Host 'BETA START FAILED: Stable data and installation were not changed.'
    exit 1
}
