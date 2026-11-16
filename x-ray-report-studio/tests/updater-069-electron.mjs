// Exercises actual packaged main/preload from the published .68 ZIP, then recovery
// through the new package. All profiles, manifests and shortcuts stay in a test kit.
import assert from 'node:assert/strict';
import { _electron } from 'playwright-core';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strToU8 } from 'fflate';
const hash=b=>createHash('sha256').update(b).digest('hex');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'XRS-069-updater-'));
const updates=path.join(root,'Updates');await fs.mkdir(updates,{recursive:true});
let app;
const marker=JSON.stringify({format:'xrs-isolated-test-kit',allowLocalUpdateFiles:true});
const candidate=await fs.readFile('test-output/xrs-0.4.69/X-ray_Report_Studio_Windows_Setup.zip');
const published=path.join(root,'old.zip');
async function materialize(bytes,dest){for(const [name,b] of Object.entries(unzipSync(bytes))){if(name.endsWith('/'))continue;const target=path.join(dest,...name.split('/'));assert.ok(target.startsWith(dest+path.sep));await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,b);}}
async function runtime(version,archive){const dir=path.join(root,'App_'+version);await fs.cp('node_modules/electron/dist',dir,{recursive:true});await fs.rename(path.join(dir,'electron.exe'),path.join(dir,'X-ray Report Studio.exe'));const extracted=path.join(root,'extracted-'+version);await materialize(archive,extracted);await fs.cp(path.join(extracted,'X-ray Report Studio Setup/app'),path.join(dir,'resources/app'),{recursive:true});await fs.writeFile(path.join(dir,'resources/app/xrs-test-mode.json'),marker);return dir;}
async function launch(dir){app=await _electron.launch({executablePath:path.join(dir,'X-ray Report Studio.exe'),cwd:dir,env:{...process.env,XRS_TEST_ROOT:root,MRI_REPORT_STUDIO_DICTIONARY_DIR:path.join(root,'Dictionary')}});const p=await app.firstWindow();await p.locator('.report-content').waitFor();await p.waitForTimeout(1500);return p;}
async function manifest(version,bytes,sha=hash(bytes)){const name=`XRS_Test_Update_${version}.zip`;await fs.writeFile(path.join(updates,name),bytes);await fs.writeFile(path.join(updates,'latest.json'),JSON.stringify({version,url:name,sha256:sha}));}
try{
 execFileSync('curl.exe',['-fL','--retry','2','-o',published,'https://github.com/002-421/-main/raw/refs/heads/codex/mri-report-studio/x-ray-report-studio/downloads/X-ray_Report_Studio_Windows_Setup-0.4.68.zip'],{stdio:'ignore'});
 const old=await fs.readFile(published);assert.equal(hash(old),'be5db6bf78619b7cc5f5a99622af291c135522aaeeb7ca48579bf5a036083ea7');
 const oldDir=await runtime('0.4.68',old);await manifest('0.4.69',candidate);
 let page=await launch(oldDir);await page.locator('#document-name').fill('Synthetic retained draft');
 await page.waitForTimeout(1000);
 const failure=await page.evaluate(async()=>{try{return await window.desktop.installUpdate();}catch(e){return String(e);}});
 assert.match(failure,/UPDATE_FAILED/);
 const logs=await fs.readdir(path.join(root,'Profile/logs'));let recorded='';for(const n of logs.filter(n=>n.startsWith('update-')))recorded+=await fs.readFile(path.join(root,'Profile/logs',n),'utf8');
 assert.match(recorded,/ReferenceError/);assert.match(recorded,/verified-archive-written/);assert.ok(!recorded.includes('extract-start'));
 assert.equal(await app.evaluate(({app})=>app.getVersion()),'0.4.68');
 console.log('PASS reproduced .68 → .69: actual old main throws ReferenceError before extraction; old EXE/profile retained. This path remains BLOCKED in installed .68.');
 await app.close();app=null;
 const fixedDir=await runtime('0.4.69',candidate);page=await launch(fixedDir);
 assert.equal(await page.locator('#document-name').inputValue(),'Synthetic retained draft');
 // A future version exists only in synthetic test payload; never published.
 const entries=unzipSync(candidate);const p='X-ray Report Studio Setup/app/package.json';const pkg=JSON.parse(new TextDecoder().decode(entries[p]));pkg.version='0.4.70';entries[p]=strToU8(JSON.stringify(pkg));const next=Buffer.from(zipSync(entries));
 await manifest('0.4.70',next,'0'.repeat(64));
 const bad=await page.evaluate(async()=>{try{return await window.desktop.installUpdate();}catch(e){return String(e);}});assert.match(bad,/SHA-256|контрольн|checksum/iu);
 assert.equal(await page.locator('#document-name').inputValue(),'Synthetic retained draft');
 await manifest('0.4.70',next);
 // Registration of app:ready follows async installation; wait for the IPC outcome.
 await page.evaluate(()=>{void window.desktop.installUpdate().catch(()=>{});});
 await page.waitForFunction(()=>window.desktop.getApplicationVersion().then(v=>v==='0.4.70'),null,{timeout:60000});
 await page.waitForTimeout(2500);
 await page.locator('.report-content').waitFor();assert.equal(await page.locator('#document-name').inputValue(),'Synthetic retained draft');
 const state=JSON.parse(await fs.readFile(path.join(root,'Profile/install-state.json'),'utf8'));assert.equal(state.current.version,'0.4.70');assert.equal(state.previous.version,'0.4.69');
 const target=await app.evaluate(({shell},link)=>shell.readShortcutLink(link).target,path.join(root,'Shortcuts/X-ray Report Studio.lnk'));assert.equal((await fs.realpath(target)).toLowerCase(),(await fs.realpath(state.current.executable)).toLowerCase());
 await app.close();app=null;page=await launch(state.current.root);assert.equal(await app.evaluate(({app})=>app.getVersion()),'0.4.70');assert.equal(await page.locator('#document-name').inputValue(),'Synthetic retained draft');
 await page.waitForFunction(()=>window.desktop.getApplicationVersion().then(v=>v==='0.4.70'));
 const healthy=JSON.parse(await fs.readFile(path.join(root,'Profile/install-state.json'),'utf8'));assert.equal(healthy.status,'stable');
 console.log('PASS recovered .69: real IPC installer, SHA rejection, real ZIP extraction, live UI, shortcut, restart/new EXE, stable state and retained workspace.');
}finally{await app?.close();await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
