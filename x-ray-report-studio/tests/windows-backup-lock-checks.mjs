import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

if(process.platform!=='win32')throw new Error('This acceptance runner requires real Windows file sharing locks');
const output=path.resolve('test-output/windows-backup-lock');
await fs.mkdir(output,{recursive:true});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Preserve the failing transport as a bounded diagnostic, not as the new fixture.
async function probe(commandMode,unicode,instrumented=false){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'xrs-legacy-lock-probe-'));
 const filename=path.join(root,unicode?'Синтетический файл.ldb':'synthetic-workspace.ldb');await fs.writeFile(filename,'synthetic');
 let script='$p=[Console]::In.ReadLine();$f=[System.IO.File]::Open($p,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None);[Console]::Out.WriteLine("LOCKED");[Console]::Out.Flush();Start-Sleep -Seconds 60;$f.Dispose()';
 if(instrumented)script=script.replace('$p=[Console]::In.ReadLine();',"[Console]::Out.WriteLine('BEFORE_READ');[Console]::Out.Flush();$p=[Console]::In.ReadLine();[Console]::Out.WriteLine('AFTER_READ:'+([string]$p).Length);[Console]::Out.Flush();");
 const argument=commandMode==='-EncodedCommand'?Buffer.from(script,'utf16le').toString('base64'):script;
 const started=Date.now(),child=spawn('powershell.exe',['-NoProfile','-NonInteractive',commandMode,argument],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 const result={commandMode,unicode,instrumented,stdout:'',stderr:'',events:[]};let ended=false;
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 child.stdout.on('data',s=>result.stdout+=s);child.stderr.on('data',s=>result.stderr+=s);
 child.on('spawn',()=>result.events.push({event:'spawn',elapsedMs:Date.now()-started}));
 child.on('error',e=>result.events.push({event:'error',code:e.code}));
 child.on('close',(code,signal)=>{ended=true;result.exit={code,signal};});
 child.stdin.on('error',e=>result.events.push({event:'stdin-error',code:e.code}));child.stdin.end(filename+'\n');
 try{
  const deadline=started+10000;while(!ended&&!result.stdout.includes('LOCKED')&&Date.now()<deadline)await pause(25);
  result.readinessMs=Date.now()-started;result.announced=result.stdout.includes('LOCKED');
  if(result.announced){try{const f=await fs.open(filename,'r+');await f.close();result.actualLock=false;}catch(e){result.actualLock=['EBUSY','EPERM','EACCES'].includes(e.code);result.lockCode=e.code;}}
 }finally{
  if(!ended)child.kill();const deadline=Date.now()+5000;while(!ended&&Date.now()<deadline)await pause(25);
  if(!ended)throw new Error('Legacy diagnostic PowerShell process did not terminate');
  result.stderr=result.stderr.replaceAll(root,'<synthetic-temp>');await fs.rm(root,{recursive:true,force:true});
 }
 return result;
}
const probes=await Promise.all([probe('-Command',false),probe('-Command',false,true),probe('-EncodedCommand',false,true),probe('-Command',true,true),probe('-EncodedCommand',true,true)]);
await fs.writeFile(path.join(output,'legacy-transport.json'),JSON.stringify(probes,null,2));
for(const p of probes){const message=JSON.stringify(p).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A');console.log('::notice title=PowerShell lock transport diagnosis::'+message);}

const a='^Windows backup does not skip a locked user data file;',b='^an open Windows LevelDB LOCK does not block a verified backup$';
const file='tests/user-data-backup.test.mjs';
const scenarios=[['locked user data file',['--test','--test-name-pattern='+a,file]],['open LevelDB LOCK',['--test','--test-name-pattern='+b,file]],...Array.from({length:3},(_,i)=>['both Windows locks repetition '+(i+1),['--test','--test-name-pattern='+a+'|'+b,file]]),['release updater suite (original parallel command)',['--test','tests/update-channel.test.mjs','tests/update-version.test.mjs','tests/update-install.test.mjs','tests/install-state.test.mjs','tests/update-settings.test.mjs','tests/user-data-backup.test.mjs','tests/log-safety.test.mjs','tests/windows-integration.test.mjs']]];
const results=[];let log='';
for(const [name,args] of scenarios){
 console.log('CHECK:',name);const started=Date.now();
 const result=await new Promise(resolve=>{
  const child=spawn(process.execPath,args,{env:{...process.env,NODE_DISABLE_COLORS:'1',XRS_LOCK_DIAGNOSTICS_DIR:path.join(output,'holders')},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',s=>stdout+=s);child.stderr.on('data',s=>stderr+=s);
  child.on('error',e=>stderr+=e.message);child.on('close',(code,signal)=>resolve({code,signal,stdout,stderr}));
 });
 log+='\nCHECK: '+name+'\n'+result.stdout+result.stderr;
 const counts=[...result.stdout.matchAll(/(?:#|ℹ)\s+(tests|pass|fail|skipped)\s+(\d+)/gu)].map(m=>m[1]+': '+m[2]);
 results.push({name,code:result.code,signal:result.signal,elapsedMs:Date.now()-started,counts});console.log('RESULT:',name,JSON.stringify(results.at(-1)));
 await fs.writeFile(path.join(output,'checks.log'),log);await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));
 if(result.code!==0){console.error('::error title=Windows backup lock acceptance::'+(result.stdout+result.stderr).slice(-12000).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A'));process.exitCode=1;break;}
}
if(process.env.GITHUB_STEP_SUMMARY)await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,'\n## Real Windows backup lock acceptance\n\n```json\n'+JSON.stringify(results,null,2)+'\n```\n');
