// Regenerate the embedded dictionary from the pinned az dependency, without changing its contents.
import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {zipSync} from 'fflate';
const files=Object.fromEntries(readdirSync('node_modules/az/dicts').sort().map(name=>[name,new Uint8Array(readFileSync(`node_modules/az/dicts/${name}`))]));
const archive=zipSync(files,{level:9,mtime:new Date('2026-01-01T00:00:00Z')});
writeFileSync('src/assets/morphology/dictionary.ts',`// Az.js 0.2.3 / OpenCorpora 0.92 rev.394551. See LICENSE.txt.\nexport default '${Buffer.from(archive).toString('base64')}';\n`);
