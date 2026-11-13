$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
    $package = $env:MRI_STUDIO_PACKAGE
    if ([string]::IsNullOrWhiteSpace($package)) { $package = $PSScriptRoot }
    $appPackage = Get-Content -LiteralPath (Join-Path $package 'app\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
    if ($appPackage.version -eq '0.4.55') {
        # Guard this local test candidate against accidental installation on another machine.
        $desktop = [Environment]::GetFolderPath('Desktop')
        $shortcutPath = Join-Path $desktop 'X-ray Report Studio.lnk'
        if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) { throw 'Test upgrade requires an existing Stable 0.4.54 desktop shortcut.' }
        try {
            $shell = New-Object -ComObject WScript.Shell
            $currentShortcut = $shell.CreateShortcut($shortcutPath)
            $currentExecutable = [IO.Path]::GetFullPath($currentShortcut.TargetPath)
            $currentRoot = [IO.Path]::GetDirectoryName($currentExecutable)
            $currentPackage = Get-Content -LiteralPath (Join-Path $currentRoot 'resources\app\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
        } catch { throw 'Could not verify the installed version from its shortcut; upgrade stopped.' }
        if ($currentPackage.version -ne '0.4.54' -or [IO.Path]::GetFileName($currentExecutable) -ine 'X-ray Report Studio.exe') {
            throw 'The 0.4.55 test package only upgrades Stable 0.4.54. Installation did not start.'
        }
        $channelFile = Join-Path $env:APPDATA 'X-ray Report Studio Channel.json'
        if (Test-Path -LiteralPath $channelFile -PathType Leaf) {
            try { $channel = Get-Content -LiteralPath $channelFile -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop }
            catch { throw 'Update channel settings are damaged; upgrade stopped.' }
            if ($channel.channel -eq 'beta' -or $channel.profile -eq 'beta') { throw 'Beta is selected for this profile; Stable 0.4.55 test stopped.' }
        }
        try { $running = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop) }
        catch { throw 'Could not inspect Windows processes; upgrade stopped.' }
        $prefix = [IO.Path]::GetFullPath($currentRoot).TrimEnd('\') + '\'
        foreach ($process in $running) {
            $processPath = [string]$process.ExecutablePath
            if ($process.Name -ieq 'X-ray Report Studio.exe' -or
                ($process.Name -ieq 'electron.exe' -and $processPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase))) {
                throw 'Close X-ray Report Studio before installing the test update.'
            }
        }
        $confirmation = Read-Host 'TEST VERSION 0.4.55: only this computer shortcut changes; 0.4.54 stays installed. Type UPDATE 0.4.54 TO 0.4.55 to continue'
        if ($confirmation -cne 'UPDATE 0.4.54 TO 0.4.55') { throw 'Confirmation was not received; installation cancelled.' }
    }
    $desktop = [Environment]::GetFolderPath('Desktop')
    if ([string]::IsNullOrWhiteSpace($desktop)) { throw 'Desktop folder is unavailable.' }
    $parent = Join-Path $desktop 'X-ray Report Studio'
    $stem = 'App_' + (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss')
    $destination = Join-Path $parent $stem
    $i = 1
    while (Test-Path -LiteralPath $destination) {
        $destination = Join-Path $parent ($stem + '_' + $i)
        $i++
    }
    $temporary = Join-Path ([IO.Path]::GetTempPath()) ('MRIReportStudio_' + [guid]::NewGuid().ToString('N'))
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
        $executable = Join-Path $stage 'X-ray Report Studio.exe'
        Rename-Item -LiteralPath (Join-Path $stage 'electron.exe') -NewName 'X-ray Report Studio.exe'
        $icon = Join-Path $appTarget 'dist\x-ray-report-studio.ico'
        $resourceEditor = Join-Path $appTarget 'dist\rcedit-x64.exe'
        & $resourceEditor $executable --set-icon $icon
        if ($LASTEXITCODE -ne 0) { throw 'Could not apply the X-ray Report Studio icon to the application.' }
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
    $shortcutPath = Join-Path $desktop 'X-ray Report Studio.lnk'
    $temporaryShortcut = Join-Path $desktop ('.XRS-' + [guid]::NewGuid().ToString('N') + '.lnk')
    $shortcut = $shell.CreateShortcut($temporaryShortcut)
    $shortcut.TargetPath = Join-Path $destination 'X-ray Report Studio.exe'
    $shortcut.WorkingDirectory = $destination
    $shortcut.IconLocation = Join-Path $destination 'resources\app\dist\x-ray-report-studio.ico'
    $shortcut.Save()
    if (Test-Path -LiteralPath $shortcutPath) {
        $shortcutBackup = Join-Path $desktop ('.XRS-previous-' + [guid]::NewGuid().ToString('N') + '.lnk')
        [IO.File]::Replace($temporaryShortcut, $shortcutPath, $shortcutBackup, $true)
    } else {
        [IO.File]::Move($temporaryShortcut, $shortcutPath)
    }
    Start-Process -FilePath (Join-Path $destination 'X-ray Report Studio.exe')
    Start-Process explorer.exe -ArgumentList ('"' + $destination + '"')
} catch {
    Write-Host ('Installation failed: ' + $_.Exception.Message) -ForegroundColor Red
    [void](Read-Host 'Press Enter to close')
    exit 1
}
