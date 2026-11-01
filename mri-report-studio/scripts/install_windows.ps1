$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
    $package = $env:MRI_STUDIO_PACKAGE
    if ([string]::IsNullOrWhiteSpace($package)) { $package = $PSScriptRoot }
    $desktop = [Environment]::GetFolderPath('Desktop')
    if ([string]::IsNullOrWhiteSpace($desktop)) { throw 'Desktop folder is unavailable.' }
    $parent = Join-Path $desktop 'MRI Alliance'
    $stem = 'App_' + (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss')
    $destination = Join-Path $parent $stem
    $i = 1
    while (Test-Path -LiteralPath $destination) {
        $destination = Join-Path $parent ($stem + '_' + $i)
        $i++
    }
    $temporary = Join-Path ([IO.Path]::GetTempPath()) ('MRIAlliance_' + [guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($temporary)
    try {
        $archive = Join-Path $temporary 'electron.zip'
        Write-Host 'Downloading the official Electron runtime (about 150 MB)...'
        Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/electron/electron/releases/download/v45.0.0/electron-v45.0.0-win32-x64.zip' -OutFile $archive
        $expected = 'ae53887a23bb640369c93dbd38c408a2af5c0deb86f2fa76c6c244cb444b7f47'
        $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $expected) { throw 'Runtime SHA256 mismatch. Installation has been stopped.' }
        Write-Host 'Checksum verified. Preparing the application...'
        $stage = Join-Path $temporary 'app'
        Expand-Archive -LiteralPath $archive -DestinationPath $stage
        $appTarget = Join-Path $stage 'resources/app'
        Copy-Item -LiteralPath (Join-Path $package 'app') -Destination $appTarget -Recurse
        Rename-Item -LiteralPath (Join-Path $stage 'electron.exe') -NewName 'MRI Alliance.exe'
        Copy-Item -LiteralPath (Join-Path $package 'README_RU.txt') -Destination (Join-Path $stage 'README_RU.txt')
        if (Test-Path -LiteralPath (Join-Path $package 'THIRD_PARTY_LICENSES.txt')) {
            Copy-Item -LiteralPath (Join-Path $package 'THIRD_PARTY_LICENSES.txt') -Destination (Join-Path $stage 'THIRD_PARTY_LICENSES.txt')
        }
        [void][IO.Directory]::CreateDirectory($parent)
        Move-Item -LiteralPath $stage -Destination $destination
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
    }
    Write-Host ('Installed: ' + $destination) -ForegroundColor Green
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path $desktop 'MRI Alliance.lnk'))
    $shortcut.TargetPath = Join-Path $destination 'MRI Alliance.exe'
    $shortcut.WorkingDirectory = $destination
    $shortcut.IconLocation = Join-Path $destination 'resources\app\dist\mri-alliance.ico'
    $shortcut.Save()
    Start-Process -FilePath (Join-Path $destination 'MRI Alliance.exe')
    Start-Process explorer.exe -ArgumentList ('"' + $destination + '"')
} catch {
    Write-Host ('Installation failed: ' + $_.Exception.Message) -ForegroundColor Red
    [void](Read-Host 'Press Enter to close')
    exit 1
}
