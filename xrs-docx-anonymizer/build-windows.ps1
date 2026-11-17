param([switch]$Offline)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not [Environment]::Is64BitProcess -or $env:OS -ne 'Windows_NT') {
    throw 'Build requires Windows x64 with Python 3.12 x64.'
}
python -c "import sys; assert sys.version_info[:2] == (3, 12)"
if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 x64 is required.' }
if ($Offline) {
    python -m pip install --no-index --find-links wheelhouse -r requirements-dev.txt
} else {
    python -m pip install -r requirements-dev.txt
}
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
python -m unittest discover -s tests -t . -v
if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
python -m PyInstaller --noconfirm --clean --onedir --windowed --name XRS-DOCX-Anonymizer --exclude-module PIL --exclude-module docx launcher.py
if ($LASTEXITCODE -ne 0) { throw 'GUI build failed.' }
python -m PyInstaller --noconfirm --clean --onefile --console --name XRS-DOCX-Anonymizer-CLI --exclude-module PIL --exclude-module docx cli_launcher.py
if ($LASTEXITCODE -ne 0) { throw 'CLI build failed.' }
Copy-Item dist/XRS-DOCX-Anonymizer-CLI.exe dist/XRS-DOCX-Anonymizer/
Copy-Item README_RU.md,ARCHITECTURE.md,SECURITY.md,MANUAL_REVIEW.md,THIRD_PARTY_NOTICES.md dist/XRS-DOCX-Anonymizer/
python tools/collect_licenses.py dist/XRS-DOCX-Anonymizer/licenses
if ($LASTEXITCODE -ne 0) { throw 'License collection failed.' }
python tools/windows_smoke.py dist/XRS-DOCX-Anonymizer/XRS-DOCX-Anonymizer-CLI.exe
if ($LASTEXITCODE -ne 0) { throw 'Frozen smoke test failed.' }
# Actual GUI creation on the Windows desktop is an additional build smoke test.
$gui = Start-Process dist/XRS-DOCX-Anonymizer/XRS-DOCX-Anonymizer.exe -PassThru
Start-Sleep -Seconds 4
if ($gui.HasExited) { throw 'Frozen GUI exited during startup.' }
$gui.CloseMainWindow() | Out-Null
if (-not $gui.WaitForExit(5000)) { $gui.Kill() }
Compress-Archive -Path dist/XRS-DOCX-Anonymizer -DestinationPath dist/XRS-DOCX-Anonymizer-Windows-x64.zip -Force
Get-FileHash dist/XRS-DOCX-Anonymizer-Windows-x64.zip -Algorithm SHA256 | Format-List
