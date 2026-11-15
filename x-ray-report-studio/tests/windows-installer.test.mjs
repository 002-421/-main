import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Windows installer stages its shortcut, retains a unique backup and never removes the old shortcut',async()=>{
 const script=await readFile(new URL('../scripts/install_windows.ps1',import.meta.url),'utf8');
 assert.match(script,/\.XRS-' \+ \[guid\]::NewGuid\(\)\.ToString\('N'\) \+ '\.lnk'/);
 assert.match(script,/\[IO\.File\]::Replace\(\$temporaryShortcut, \$shortcutPath, \$shortcutBackup, \$true\)/);
 assert.match(script,/\[IO\.File\]::Move\(\$temporaryShortcut, \$shortcutPath\)/);
 assert.doesNotMatch(script,/Remove-Item[^\n]*MRI Report Studio\.lnk/);
 assert.match(script,/-LiteralPath/);
});

test('Windows Setup launcher runs the intact adjacent PowerShell installer with a process-local ExecutionPolicy override',async()=>{
 const packager=await readFile(new URL('../scripts/package_setup.py',import.meta.url),'utf8');
 const verifier=await readFile(new URL('../scripts/verify_setup_package.py',import.meta.url),'utf8');
 assert.match(packager,/def install_cmd_content\(\):[\s\S]*?powershell\.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install\.ps1"/);
 assert.match(packager,/set "MRI_STUDIO_PACKAGE=%~dp0"/);
 assert.match(packager,/Install\.cmd'\)\.write_bytes\(install_cmd_content\(\)\.encode\('ascii'\)\)/);
 assert.doesNotMatch(packager,/for source in installer\.splitlines\(\)/,'the PowerShell source is not flattened into an inline command');
 assert.match(verifier,/Setup ZIP is missing its Windows launcher or PowerShell installer/);
 assert.match(verifier,/Install\.cmd must invoke the adjacent Install\.ps1 file with PowerShell -File/);
});
