[CmdletBinding()]
param(
    [string]$ProfilePath = (Join-Path $env:APPDATA 'MRI Report Studio'),
    [string]$DestinationRoot = '',
    [string]$DictionaryPath = '',
    [string]$Version = '0.4.53',
    [string]$TargetVersion = '0.4.54',
    [long]$ReserveBytes = 67108864,
    [switch]$Library
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Get-XrsFullPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { throw 'A required path is missing.' }
    try { return [IO.Path]::GetFullPath($Path) }
    catch { throw 'A selected path is invalid.' }
}

function Get-XrsPathSeparators {
    return [char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}

function Test-XrsPathWithin([string]$Path, [string]$Root) {
    $separators = Get-XrsPathSeparators
    $fullPath = (Get-XrsFullPath $Path).TrimEnd($separators)
    $fullRoot = (Get-XrsFullPath $Root).TrimEnd($separators)
    if ([string]::Equals($fullPath, $fullRoot, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    $prefix = $fullRoot
    if (-not $prefix.EndsWith([string][IO.Path]::DirectorySeparatorChar) -and -not $prefix.EndsWith([string][IO.Path]::AltDirectorySeparatorChar)) {
        $prefix += [IO.Path]::DirectorySeparatorChar
    }
    return $fullPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

function Test-XrsPathsOverlap([string]$Left, [string]$Right) {
    return (Test-XrsPathWithin $Left $Right) -or (Test-XrsPathWithin $Right $Left)
}

function Assert-XrsNoReparseAncestors([string]$Path) {
    $current = Get-XrsFullPath $Path
    while (-not [string]::IsNullOrWhiteSpace($current)) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'A selected path contains a symbolic link or reparse point.'
            }
        }
        $parent = [IO.Directory]::GetParent($current)
        if ($null -eq $parent -or [string]::Equals($parent.FullName, $current, [StringComparison]::OrdinalIgnoreCase)) { break }
        $current = $parent.FullName
    }
}

function Assert-XrsOutsideInstallDirectory([string]$Path) {
    $full = Get-XrsFullPath $Path
    foreach ($segment in ($full -split '[\\/]')) {
        if ($segment -match '^App_[0-9]{8,}.*$') { throw 'The backup destination cannot be inside an installed application version folder.' }
    }
}

function Get-XrsInstallRoots([string[]]$AdditionalRoots = @()) {
    $roots = New-Object 'System.Collections.Generic.List[string]'
    $desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)
    if (-not [string]::IsNullOrWhiteSpace($desktop)) {
        $knownRoot = Join-Path $desktop 'X-ray Report Studio'
        $roots.Add((Get-XrsFullPath $knownRoot))
        $shortcut = Join-Path $desktop 'X-ray Report Studio.lnk'
        if (Test-Path -LiteralPath $shortcut) {
            try {
                $shell = New-Object -ComObject WScript.Shell
                $target = $shell.CreateShortcut($shortcut).TargetPath
                if (-not [string]::IsNullOrWhiteSpace($target)) {
                    $versionRoot = [IO.Directory]::GetParent($target)
                    if ($null -ne $versionRoot) {
                        $applicationRoot = [IO.Directory]::GetParent($versionRoot.FullName)
                        if ($null -ne $applicationRoot) { $roots.Add((Get-XrsFullPath $applicationRoot.FullName)) }
                    }
                }
            } catch { throw 'The installed application location could not be verified.' }
        }
    }
    foreach ($root in $AdditionalRoots) {
        if (-not [string]::IsNullOrWhiteSpace($root)) { $roots.Add((Get-XrsFullPath $root)) }
    }
    return @($roots | Select-Object -Unique)
}

function Get-XrsRunningAppProcesses([object[]]$ProcessList, [string[]]$InstallRoots, [string]$ProfileRoot) {
    $runningMatches = New-Object 'System.Collections.Generic.List[object]'
    foreach ($process in $ProcessList) {
        $name = [string]$process.Name
        $exe = [string]$process.ExecutablePath
        $commandLine = [string]$process.CommandLine
        $isNamedApp = $name -match '^(?i:X-ray Report Studio|MRI Report Studio)(?:\.exe)?$'
        $isElectronInInstall = $false
        if ($name -match '^(?i:electron)(?:\.exe)?$') {
            foreach ($root in $InstallRoots) {
                if (-not [string]::IsNullOrWhiteSpace($exe) -and (Test-XrsPathWithin $exe $root)) { $isElectronInInstall = $true }
            }
            if (-not $isElectronInInstall -and -not [string]::IsNullOrWhiteSpace($commandLine)) {
                $isElectronInInstall = $commandLine.IndexOf('X-ray Report Studio', [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                    $commandLine.IndexOf('MRI Report Studio', [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                    $commandLine.IndexOf($ProfileRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0
            }
        }
        if ($isNamedApp -or $isElectronInInstall) { $runningMatches.Add($process) }
    }
    return @($runningMatches.ToArray())
}

function Assert-XrsApplicationClosed([object[]]$ProcessList, [string[]]$InstallRoots, [string]$ProfileRoot) {
    $running = @(Get-XrsRunningAppProcesses -ProcessList $ProcessList -InstallRoots $InstallRoots -ProfileRoot $ProfileRoot)
    if ($running.Count -gt 0) { throw 'X-ray Report Studio or one of its Electron processes is still running. Close it and retry.' }
}

function Get-XrsProfileFiles([string]$Root) {
    Assert-XrsNoReparseAncestors $Root
    $allEntries = @(Get-ChildItem -LiteralPath $Root -Force -Recurse -ErrorAction Stop)
    foreach ($entry in $allEntries) {
        if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'The application profile contains a symbolic link or reparse point; backup was refused.'
        }
    }
    return @($allEntries | Where-Object { -not $_.PSIsContainer })
}

function Get-XrsExternalDictionaries([string]$ProfileRoot, [string]$RequestedPath) {
    $candidates = New-Object 'System.Collections.Generic.List[string]'
    if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) { $candidates.Add($RequestedPath) }
    if (-not [string]::IsNullOrWhiteSpace($env:MRI_REPORT_STUDIO_DICTIONARY_DIR)) {
        $candidates.Add((Join-Path $env:MRI_REPORT_STUDIO_DICTIONARY_DIR 'dictionary.json'))
    }
    if (-not [string]::IsNullOrWhiteSpace($env:PUBLIC)) {
        $candidates.Add((Join-Path $env:PUBLIC 'Documents\MRI Report Studio\dictionary.json'))
    }
    $result = New-Object 'System.Collections.Generic.List[string]'
    $seen = @{}
    foreach ($candidate in $candidates) {
        $full = Get-XrsFullPath $candidate
        if ([string]::IsNullOrWhiteSpace($RequestedPath) -and -not (Test-Path -LiteralPath $full -PathType Leaf)) { continue }
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw 'A requested dictionary file was not found.' }
        if (Test-XrsPathWithin $full $ProfileRoot) { continue }
        $key = $full.ToLowerInvariant()
        if (-not $seen.ContainsKey($key)) { $seen[$key] = $true; $result.Add($full) }
    }
    return @($result.ToArray())
}

function Get-XrsSha256([string]$Path) {
    try { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant() }
    catch { throw 'A file could not be hashed; backup was refused.' }
}

function Assert-XrsBackupIntegrity([string]$BackupPath) {
    $manifestPath = Join-Path $BackupPath 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'The backup manifest is missing.' }
    try { $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop }
    catch { throw 'The backup manifest could not be read.' }
    if ($manifest.format -ne 'xrs-pre-update-backup' -or $manifest.schemaVersion -ne 1 -or -not $manifest.files) {
        throw 'The backup manifest has an unsupported or incomplete format.'
    }
    $dataRoot = Join-Path $BackupPath 'data'
    $actualFiles = @(Get-ChildItem -LiteralPath $dataRoot -Force -Recurse -ErrorAction Stop | Where-Object { -not $_.PSIsContainer })
    foreach ($item in @(Get-ChildItem -LiteralPath $dataRoot -Force -Recurse -ErrorAction Stop)) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'The backup contains a symbolic link or reparse point.' }
    }
    $expectedPaths = New-Object 'System.Collections.Generic.List[string]'
    $seenPaths = @{}
    foreach ($record in $manifest.files) {
        if ([string]::IsNullOrWhiteSpace([string]$record.backupPath) -or $record.backupPath.Contains('\') -or
            [IO.Path]::IsPathRooted($record.backupPath) -or $record.backupPath -match '(^|/)\.\.(/|$)' -or
            $record.backupPath.StartsWith('/') -or $record.sha256 -notmatch '^[a-f0-9]{64}$') {
            throw 'The backup manifest contains an unsafe file record.'
        }
        $key = ([string]$record.backupPath).ToLowerInvariant()
        if ($seenPaths.ContainsKey($key)) { throw 'The backup manifest contains a duplicate file record.' }
        $seenPaths[$key] = $true
        $expectedPaths.Add([string]$record.backupPath)
        $copyPath = Join-Path (Join-Path $BackupPath 'data') ($record.backupPath -replace '/', [IO.Path]::DirectorySeparatorChar)
        if (-not (Test-Path -LiteralPath $copyPath -PathType Leaf)) { throw 'A backed-up file is missing.' }
        $item = Get-Item -LiteralPath $copyPath -Force -ErrorAction Stop
        if ($item.Length -ne [long]$record.bytes -or (Get-XrsSha256 $copyPath) -ne [string]$record.sha256) {
            throw 'A backed-up file failed its size or SHA256 check.'
        }
    }
    $separators = Get-XrsPathSeparators
    $dataPrefix = $dataRoot.TrimEnd($separators)
    $actualPaths = @($actualFiles | ForEach-Object {
        $_.FullName.Substring($dataPrefix.Length).TrimStart($separators) -replace [regex]::Escape([string][IO.Path]::DirectorySeparatorChar), '/'
    } | Sort-Object)
    $expectedSorted = @($expectedPaths.ToArray() | Sort-Object)
    if (($actualPaths -join "`n") -cne ($expectedSorted -join "`n")) { throw 'The backup contains missing or unlisted files.' }
    return $manifest
}

function New-XrsVerifiedBackup {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$ProfilePath,
        [Parameter(Mandatory=$true)][string]$DestinationRoot,
        [string]$DictionaryPath = '',
        [string]$Version = '0.4.53',
        [string]$TargetVersion = '0.4.54',
        [long]$ReserveBytes = 67108864,
        [string[]]$InstallRoots = @(),
        [object[]]$ProcessList = $null
    )

    $profile = Get-XrsFullPath $ProfilePath
    if (-not (Test-Path -LiteralPath $profile -PathType Container)) { throw 'The application profile was not found; backup was refused.' }
    if ([string]::IsNullOrWhiteSpace($DestinationRoot)) { throw 'A separate backup destination is required.' }
    $destination = Get-XrsFullPath $DestinationRoot
    if ((Test-XrsPathsOverlap $profile $destination)) { throw 'The backup destination must be outside the application profile.' }
    Assert-XrsOutsideInstallDirectory $destination
    if ($ReserveBytes -lt 0) { throw 'The required free-space reserve cannot be negative.' }

    $roots = @(Get-XrsInstallRoots -AdditionalRoots $InstallRoots)
    foreach ($root in $roots) {
        if (Test-XrsPathsOverlap $destination $root) { throw 'The backup destination must be outside installed application folders.' }
    }

    if ($null -eq $ProcessList) {
        try { $ProcessList = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop) }
        catch { throw 'Running application processes could not be checked; backup was refused.' }
    }
    Assert-XrsApplicationClosed -ProcessList $ProcessList -InstallRoots $roots -ProfileRoot $profile

    $profileFiles = @(Get-XrsProfileFiles $profile)
    $dictionaries = @(Get-XrsExternalDictionaries -ProfileRoot $profile -RequestedPath $DictionaryPath)
    foreach ($dictionary in $dictionaries) {
        Assert-XrsNoReparseAncestors $dictionary
        $file = Get-Item -LiteralPath $dictionary -Force -ErrorAction Stop
        if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'A dictionary is a symbolic link or reparse point; backup was refused.' }
    }
    if ($profileFiles.Count -eq 0 -and $dictionaries.Count -eq 0) { throw 'No user data files were found; backup was refused.' }

    Assert-XrsNoReparseAncestors $destination
    [void][IO.Directory]::CreateDirectory($destination)
    Assert-XrsNoReparseAncestors $destination
    $driveRoot = [IO.Path]::GetPathRoot($destination)
    if ([string]::IsNullOrWhiteSpace($driveRoot)) { throw 'The backup destination must be on a local drive.' }
    try { $drive = [IO.DriveInfo]::new($driveRoot) }
    catch { throw 'The backup destination drive could not be checked.' }
    if (-not $drive.IsReady -or $drive.DriveType -notin @([IO.DriveType]::Fixed, [IO.DriveType]::Removable)) {
        throw 'The backup destination must be on a ready local fixed or removable drive.'
    }

    [decimal]$totalBytes = 0
    foreach ($file in $profileFiles) { $totalBytes += [decimal]$file.Length }
    foreach ($dictionary in $dictionaries) { $totalBytes += [decimal](Get-Item -LiteralPath $dictionary -Force).Length }
    if ([decimal]$drive.AvailableFreeSpace -lt ($totalBytes + [decimal]$ReserveBytes)) {
        throw 'There is not enough free space for a verified backup plus the required safety margin.'
    }

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupId = 'XRS_PreUpdate_' + $Version + '_to_' + $TargetVersion + '_' + $stamp + '_' + [guid]::NewGuid().ToString('N')
    $stage = Join-Path $destination ('.staging-' + $backupId)
    $final = Join-Path $destination $backupId
    if ((Test-Path -LiteralPath $stage) -or (Test-Path -LiteralPath $final)) { throw 'A unique backup directory could not be reserved.' }
    $records = New-Object 'System.Collections.Generic.List[object]'
    $sourceItems = New-Object 'System.Collections.Generic.List[object]'

    try {
        Assert-XrsNoReparseAncestors $stage
        $stageData = Join-Path $stage 'data'
        $stageProfile = Join-Path $stageData 'profile'
        $stageDictionaries = Join-Path $stageData 'dictionaries'
        [void][IO.Directory]::CreateDirectory($stageProfile)
        foreach ($file in $profileFiles) {
            $separators = Get-XrsPathSeparators
            $profilePrefix = $profile.TrimEnd($separators)
            $relative = $file.FullName.Substring($profilePrefix.Length).TrimStart($separators)
            $backupRelative = 'profile/' + ($relative -replace [regex]::Escape([string][IO.Path]::DirectorySeparatorChar), '/')
            $target = Join-Path $stageProfile $relative
            [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
            $beforeLength = [long]$file.Length
            $beforeWrite = $file.LastWriteTimeUtc.Ticks
            try { [IO.File]::Copy($file.FullName, $target, $false) }
            catch { throw 'A profile file could not be copied; no backup was accepted.' }
            $sourceHash = Get-XrsSha256 $file.FullName
            $copyHash = Get-XrsSha256 $target
            $copy = Get-Item -LiteralPath $target -Force
            $sourceNow = Get-Item -LiteralPath $file.FullName -Force -ErrorAction Stop
            if ([long]$copy.Length -ne $beforeLength -or $sourceHash -ne $copyHash -or
                [long]$sourceNow.Length -ne $beforeLength -or $sourceNow.LastWriteTimeUtc.Ticks -ne $beforeWrite) {
                throw 'A profile file changed or failed verification during backup.'
            }
            $records.Add([pscustomobject]@{ source='profile'; sourceRelative=$relative; backupPath=$backupRelative; bytes=[long]$copy.Length; sha256=$copyHash })
            $sourceItems.Add([pscustomobject]@{ source=$file.FullName; backup=$target; bytes=[long]$copy.Length; sha256=$copyHash })
        }

        $index = 0
        foreach ($dictionary in $dictionaries) {
            $index++
            $backupRelative = 'dictionaries/dictionary-' + $index.ToString('D4') + '.json'
            $target = Join-Path $stageDictionaries ('dictionary-' + $index.ToString('D4') + '.json')
            [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
            $source = Get-Item -LiteralPath $dictionary -Force -ErrorAction Stop
            $beforeLength = [long]$source.Length
            $beforeWrite = $source.LastWriteTimeUtc.Ticks
            try { [IO.File]::Copy($dictionary, $target, $false) }
            catch { throw 'A dictionary file could not be copied; no backup was accepted.' }
            $sourceHash = Get-XrsSha256 $dictionary
            $copyHash = Get-XrsSha256 $target
            $copy = Get-Item -LiteralPath $target -Force
            $sourceNow = Get-Item -LiteralPath $dictionary -Force -ErrorAction Stop
            if ([long]$copy.Length -ne $beforeLength -or $sourceHash -ne $copyHash -or
                [long]$sourceNow.Length -ne $beforeLength -or $sourceNow.LastWriteTimeUtc.Ticks -ne $beforeWrite) {
                throw 'A dictionary file changed or failed verification during backup.'
            }
            $records.Add([pscustomobject]@{ source='external-dictionary'; sourcePath=$dictionary; backupPath=$backupRelative; bytes=[long]$copy.Length; sha256=$copyHash })
            $sourceItems.Add([pscustomobject]@{ source=$dictionary; backup=$target; bytes=[long]$copy.Length; sha256=$copyHash })
        }

        $manifest = [pscustomobject]@{
            format='xrs-pre-update-backup'
            schemaVersion=1
            createdAtUtc=(Get-Date).ToUniversalTime().ToString('o')
            applicationVersion=$Version
            targetVersion=$TargetVersion
            sourceProfile=$profile
            files=@($records.ToArray())
        }
        $manifestJson = ConvertTo-Json -InputObject $manifest -Depth 8
        [IO.File]::WriteAllText((Join-Path $stage 'manifest.json'), $manifestJson + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))

        foreach ($sourceItem in $sourceItems) {
            $sourceNow = Get-Item -LiteralPath $sourceItem.source -Force -ErrorAction Stop
            if ([long]$sourceNow.Length -ne [long]$sourceItem.bytes -or
                (Get-XrsSha256 $sourceItem.source) -ne [string]$sourceItem.sha256 -or
                (Get-XrsSha256 $sourceItem.backup) -ne [string]$sourceItem.sha256) {
                throw 'A source file changed before the complete backup could be verified.'
            }
        }
        $profileFilesAfter = @(Get-XrsProfileFiles $profile)
        $initialProfilePaths = @($profileFiles | ForEach-Object { $_.FullName.ToLowerInvariant() } | Sort-Object)
        $finalProfilePaths = @($profileFilesAfter | ForEach-Object { $_.FullName.ToLowerInvariant() } | Sort-Object)
        if (($initialProfilePaths -join "`n") -cne ($finalProfilePaths -join "`n")) {
            throw 'The profile file inventory changed during backup; no backup was accepted.'
        }
        $dictionariesAfter = @(Get-XrsExternalDictionaries -ProfileRoot $profile -RequestedPath $DictionaryPath)
        $initialDictionaryPaths = @($dictionaries | ForEach-Object { $_.ToLowerInvariant() } | Sort-Object)
        $finalDictionaryPaths = @($dictionariesAfter | ForEach-Object { $_.ToLowerInvariant() } | Sort-Object)
        if (($initialDictionaryPaths -join "`n") -cne ($finalDictionaryPaths -join "`n")) {
            throw 'The dictionary file inventory changed during backup; no backup was accepted.'
        }
        $null = Assert-XrsBackupIntegrity $stage
        [IO.Directory]::Move($stage, $final)
        try { $verifiedManifest = Assert-XrsBackupIntegrity $final }
        catch {
            try { Remove-Item -LiteralPath $final -Recurse -Force -ErrorAction Stop }
            catch { throw 'Final backup verification failed and the incomplete new folder could not be removed.' }
            throw 'Final backup verification failed; the incomplete new folder was removed.'
        }
        [decimal]$verifiedBytes = 0
        foreach ($record in @($verifiedManifest.files)) { $verifiedBytes += [decimal]$record.bytes }
        return [pscustomobject]@{ Path=$final; Files=@($verifiedManifest.files).Count; Bytes=[long]$verifiedBytes }
    } catch {
        if (Test-Path -LiteralPath $stage) {
            try { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction Stop }
            catch { throw 'Backup failed and the incomplete staging folder could not be removed. Do not use it as a backup.' }
        }
        throw
    }
}

if (-not $Library) {
    try {
        if ([string]::IsNullOrWhiteSpace($DestinationRoot)) {
            $DestinationRoot = Read-Host 'Папка резервной копии вне папок приложения (например, D:\XRS-Backups)'
        }
        $installRoots = @(Get-XrsInstallRoots)
        $result = New-XrsVerifiedBackup -ProfilePath $ProfilePath -DestinationRoot $DestinationRoot `
            -DictionaryPath $DictionaryPath -Version $Version -TargetVersion $TargetVersion `
            -ReserveBytes $ReserveBytes -InstallRoots $installRoots
        Write-Host 'BACKUP VERIFIED' -ForegroundColor Green
        Write-Host ('Backup folder: ' + $result.Path)
        Write-Host ('Files verified: ' + $result.Files)
        Write-Host ('Bytes verified: ' + $result.Bytes)
        Write-Host 'The original profile and previous backups were not modified.'
        exit 0
    } catch {
        Write-Host 'BACKUP FAILED' -ForegroundColor Red
        Write-Host 'No backup was accepted. Existing backups were not overwritten.'
        Write-Host 'Check that the application is closed, the destination is separate and writable, and enough free space is available.'
        exit 1
    }
}
