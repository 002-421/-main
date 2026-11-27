// One-time, owner-reviewed build input. Never download and trust a first root.
import {readFile,writeFile,stat} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),p=createRequire(import.meta.url)('../electron/template-protocol.cjs');
const file=process.argv[2];if(!file)throw Error('Pass the public anchor.json from the approved setup ceremony. No private key is accepted.');
if((await stat(file)).size>p.LIMITS.json)throw Error('ROOT_SIZE');const root=p.parse(await readFile(file));p.validateRoot(root);
const roles=Object.values(root.roles).flatMap(role=>role.keyIds);p.check(new Set(roles).size===roles.length,'CHANNEL_KEY_SEPARATION');
const target=path.join(ROOT,'electron/template-source.cjs');const existing=createRequire(import.meta.url)(target);
if(existing.root)p.check(p.canonical(existing.root)===p.canonical(root),'ROOT_ANCHOR_DIFFERENT');
const source={schemaVersion:1,enabled:true,channel:'stable',manifestUrl:'https://github.com/002-421/XRS-Templates/releases/latest/download/manifest.json',rootUpdatesUrl:'https://raw.githubusercontent.com/002-421/XRS-Templates/main/trust/root-chain.json',allowedPrefixes:['https://github.com/002-421/XRS-Templates/releases/','https://raw.githubusercontent.com/002-421/XRS-Templates/main/trust/'],root,publisher:{enabled:true,stableEnabled:true}};
await writeFile(target,"'use strict';\nmodule.exports = "+JSON.stringify(source)+";\n");
console.log('Embedded approved public trust anchor SHA-256:',p.sha256(p.bytes(root)));
console.log('Stable publication still requires the protected server provisioning flag and explicit owner confirmation. No Secrets or GitHub settings were changed.');
