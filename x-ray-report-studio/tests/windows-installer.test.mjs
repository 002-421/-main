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
