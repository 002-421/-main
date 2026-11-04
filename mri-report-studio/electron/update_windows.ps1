param(
    [Parameter(Mandatory=$true)][string]$Archive,
    [Parameter(Mandatory=$true)][string]$CurrentRoot,
    [Parameter(Mandatory=$true)][string]$Version,
    [Parameter(Mandatory=$true)][string]$StatusFile
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('MRIReportStudio_Update_' + [guid]::NewGuid().ToString('N'))
try {
    [IO.File]::WriteAllText($StatusFile, 'started')
    $package = Join-Path $temporary 'package'
    $stage = Join-Path $temporary 'stage'
    [void][IO.Directory]::CreateDirectory($package)
    [void][IO.Directory]::CreateDirectory($stage)
    Expand-Archive -LiteralPath $Archive -DestinationPath $package
    $sourceApp = Join-Path $package 'MRI Report Studio Setup\app'
    if (-not (Test-Path -LiteralPath (Join-Path $sourceApp 'electron\main.cjs'))) { throw 'The update package is missing its application files.' }
    Copy-Item -Path (Join-Path $CurrentRoot '*') -Destination $stage -Recurse
    $targetApp = Join-Path $stage 'resources\app'
    if (Test-Path -LiteralPath $targetApp) { Remove-Item -LiteralPath $targetApp -Recurse -Force }
    Copy-Item -LiteralPath $sourceApp -Destination $targetApp -Recurse
    $newRoot = Join-Path (Split-Path -Parent $CurrentRoot) ('App_' + ($Version -replace '[^A-Za-z0-9._-]', '_'))
    if (Test-Path -LiteralPath $newRoot) { $newRoot += '_' + [guid]::NewGuid().ToString('N').Substring(0,8) }
    Move-Item -LiteralPath $stage -Destination $newRoot
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'MRI Report Studio.lnk'))
    $shortcut.TargetPath = Join-Path $newRoot 'MRI Report Studio.exe'
    $shortcut.WorkingDirectory = $newRoot
    $shortcut.IconLocation = Join-Path $newRoot 'resources\app\dist\mri-report-studio.ico'
    $shortcut.Save()
    $process = Start-Process -PassThru -FilePath (Join-Path $newRoot 'MRI Report Studio.exe')
    Start-Sleep -Seconds 2
    if ($process.HasExited) { throw 'Обновлённое приложение завершилось сразу после запуска.' }
    [IO.File]::WriteAllText($StatusFile, 'ready')
} catch {
    try { [IO.File]::WriteAllText($StatusFile, ('error:' + $_.Exception.Message)) } catch {}
} finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $Archive) { Remove-Item -LiteralPath $Archive -Force -ErrorAction SilentlyContinue }
}
