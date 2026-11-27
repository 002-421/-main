// Actual Electron safeStorage + browser handoff; OAuth/GitHub responses are fixtures.
import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {_electron} from 'playwright-core';
const root=await mkdtemp(path.join(os.tmpdir(),'xrs-desktop-oauth-'));const windows=process.platform==='win32';
try{
 await writeFile(path.join(root,'main.cjs'),"const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{new BrowserWindow({show:false});});");
 for(let i=0;i<2;i++){
 const app=await _electron.launch({executablePath:process.env.ELECTRON_PATH||path.resolve('node_modules/electron/dist',windows?'electron.exe':'electron'),args:[path.join(root,'main.cjs'),'--user-data-dir='+path.join(root,'profile-'+i),'--no-sandbox','--ozone-platform=headless'],env:{...process.env,PATH:windows?'C:\\Windows\\System32':'/usr/bin'}});
 try{const result=await app.evaluate(async({app,safeStorage},{modulePath,directory})=>{
  const fs=require('node:fs/promises'),path=require('node:path'),opened=[],token='synthetic-token-not-real',calls=[];
  const fetchImpl=async(url,options={})=>{calls.push(url);let value;if(url.endsWith('/login/device/code'))value={device_code:'fixture',user_code:'ABCD-EFGH',verification_uri:'https://github.com/login/device',expires_in:900,interval:5};else if(url.endsWith('/login/oauth/access_token'))value={access_token:token,token_type:'bearer'};else if(url.endsWith('/user'))value={login:'002-421',id:210672295,type:'User'};else if(url.endsWith('/repos/002-421/XRS-Templates'))value={full_name:'002-421/XRS-Templates',permissions:{push:true}};else throw Error('unexpected endpoint');return new Response(JSON.stringify(value));};
  const options={directory,clientId:'0123456789abcdef',safeStorage,openExternal:async url=>opened.push(url),fetchImpl,wait:async()=>{}};
  const factory=require(modulePath).createDesktopAuth;
  if(process.platform!=='win32')return {windows:false};
  const auth=factory(options),flow=await auth.begin();await auth.complete(flow.id);const bytes=await fs.readFile(path.join(directory,'github-authorization.dat'));if(bytes.includes(Buffer.from(token)))throw Error('plaintext credential');const reopened=factory(options);await reopened.transport.authorize();return {windows:true,connected:(await reopened.status()).connected,browser:opened[0],calls:calls.length};
 },{modulePath:path.resolve('electron/github-desktop-auth.cjs'),directory:path.join(root,'vault-'+i)});
 if(windows){assert.equal(result.connected,true);assert.equal(result.browser,'https://github.com/login/device');assert.ok(result.calls>=5);console.log('PASS independent admin '+i+' real Electron DPAPI, simulated OAuth, no CLI');}else console.log('SKIP Windows DPAPI on '+process.platform);
 }finally{await app.close();}
 }
}finally{await rm(root,{recursive:true,force:true});}
