import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const {extractWithTar}=require('../electron/update-install.cjs');
const {smokeTestInstalledApp}=require('../electron/live-update.cjs');
const root=process.cwd();
const archive=path.join(root,'test-output','xrs-09-candidate','X-ray_Report_Studio_Windows_Setup.zip');
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'XRS-09-Setup-Smoke-'));
try{
 const extracted=path.join(temporary,'setup');
 await fs.mkdir(extracted,{recursive:true});
 await extractWithTar(archive,extracted,'tar.exe');
 const appSource=path.join(extracted,'X-ray Report Studio Setup','app');
 const runtime=path.join(root,'node_modules','electron','dist');
 const install=path.join(temporary,'App_0.4.55');
 await fs.cp(runtime,install,{recursive:true});
 await fs.rename(path.join(install,'electron.exe'),path.join(install,'X-ray Report Studio.exe'));
 await fs.mkdir(path.join(install,'resources','app'),{recursive:true});
 await fs.cp(appSource,path.join(install,'resources','app'),{recursive:true});
 const result=await smokeTestInstalledApp({executable:path.join(install,'X-ray Report Studio.exe'),timeoutMs:45000});
 assert.deepEqual(result,{ready:true,version:'0.4.55'});
 console.log('PASS: extracted candidate Setup ZIP launches the packaged Stable 0.4.55 Electron editor with an isolated synthetic profile.');
}finally{await fs.rm(temporary,{recursive:true,force:true});}
