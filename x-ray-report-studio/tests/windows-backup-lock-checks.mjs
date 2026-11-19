import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

if(process.platform!=='win32')throw new Error('This acceptance runner requires real Windows file sharing locks');
const moduleReadiness=process.argv.includes('--module-readiness');
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

// Diagnostic-only reconstruction of the old EncodedCommand readiness path.
// It never substitutes for the required real-lock/backup tests below.
async function probeModuleReadiness(){
 const results=[];
 for(let attempt=1;attempt<=2;attempt++){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'xrs-module-readiness-'));
  const filename=path.join(root,"Синтетический файл ' Unicode.ldb"),events=path.join(root,'events.jsonl'),ready=path.join(root,'ready.json');await fs.writeFile(filename,'synthetic');
  const source=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$utf8=[System.Text.UTF8Encoding]::new($false)
$clock=[System.Diagnostics.Stopwatch]::StartNew()
function Mark([string]$phase) {
  $json='{"phase":"'+$phase+'","pid":'+$PID+',"elapsedMs":'+$clock.ElapsedMilliseconds+'}'
  [System.IO.File]::AppendAllText($env:XRS_PROBE_EVENTS,$json+[Environment]::NewLine,$utf8)
}
$f=$null
try {
  Mark 'script-start'
  $f=[System.IO.File]::Open($env:XRS_PROBE_FILE,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None)
  Mark 'lock-acquired'
  if (Get-Module Microsoft.PowerShell.Utility) { Mark 'utility-already-loaded' } else { Mark 'utility-not-loaded' }
  Mark 'before-convert-to-json'
  $value=@{event='LOCKED';pid=$PID}|ConvertTo-Json -Compress
  Mark 'after-convert-to-json'
  if (Get-Module Microsoft.PowerShell.Utility) { Mark 'utility-now-loaded' }
  [System.IO.File]::WriteAllText($env:XRS_PROBE_READY,$value,$utf8)
  Mark 'ready-written'
  [Console]::Out.WriteLine($value)
  [Console]::Out.Flush()
} catch {
  Mark 'probe-error'
  [Console]::Error.WriteLine($_.Exception.GetType().FullName+': '+$_.Exception.HResult)
  exit 1
} finally { if($null -ne $f){$f.Dispose()} }
`;
  const started=Date.now(),child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(source,'utf16le').toString('base64')],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,XRS_PROBE_FILE:filename,XRS_PROBE_EVENTS:events,XRS_PROBE_READY:ready}});
  const result={attempt,testPid:process.pid,childPid:child.pid,startedAt:new Date(started).toISOString(),stdout:'',stderr:'',timedOut:false};let ended=false;
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',s=>result.stdout+=s);child.stderr.on('data',s=>result.stderr+=s);child.on('error',error=>result.spawnError=error.code);child.on('close',(code,signal)=>{ended=true;result.exit={code,signal};});
  try{
   const deadline=started+10000;while(!ended&&Date.now()<deadline)await pause(25);
   if(!ended){result.timedOut=true;child.kill();const end=Date.now()+5000;while(!ended&&Date.now()<end)await pause(25);}
   if(!ended)throw new Error('Diagnostic PowerShell probe did not stop');
   result.elapsedMs=Date.now()-started;
   result.phases=await fs.readFile(events,'utf8').then(text=>text.trim().split(/\r?\n/).map(JSON.parse),error=>{if(error.code==='ENOENT')return[];throw error;});
   result.ready=await fs.readFile(ready,'utf8').then(JSON.parse,error=>{if(error.code==='ENOENT')return null;throw error;});
   const released=await fs.open(filename,'r+');await released.close();result.unlockVerified=true;
   results.push(result);await fs.writeFile(path.join(output,'encoded-module-readiness.json'),JSON.stringify(results,null,2));
   console.log('::warning title=EncodedCommand readiness baseline::'+JSON.stringify(result).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A'));
  }finally{await fs.rm(root,{recursive:true,force:true});}
 }
 return results;
}
if(moduleReadiness)await probeModuleReadiness();

const a='^Windows backup does not skip a locked user data file;',b='^an open Windows LevelDB LOCK does not block a verified backup$';
const file='tests/user-data-backup.test.mjs';
const scenarios=[['locked user data file',['--test','--test-name-pattern='+a,file]],['open LevelDB LOCK',['--test','--test-name-pattern='+b,file]],...Array.from({length:3},(_,i)=>['both Windows locks repetition '+(i+1),['--test','--test-name-pattern='+a+'|'+b,file]]),['release updater suite (original parallel command)',['--test','tests/update-channel.test.mjs','tests/update-version.test.mjs','tests/update-install.test.mjs','tests/install-state.test.mjs','tests/update-settings.test.mjs','tests/user-data-backup.test.mjs','tests/log-safety.test.mjs','tests/windows-integration.test.mjs']]];
if(moduleReadiness){
 const files=(await fs.readdir('tests')).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>'tests/'+name);
 scenarios.push(['full unit suite (normal parallel npm test command)',['--test',...files]]);
}else{
 // Preserve the earlier release acceptance ordering for the 0.4.74 branch.
 scenarios.unshift(scenarios.pop());
}
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
 const skipped=Number(result.stdout.match(/(?:#|ℹ)\s+skipped\s+(\d+)/u)?.[1]??-1);
 if(result.code===0&&skipped!==0)result.code=1;
 results.push({name,code:result.code,signal:result.signal,elapsedMs:Date.now()-started,counts});console.log('RESULT:',name,JSON.stringify(results.at(-1)));
 await fs.writeFile(path.join(output,'checks.log'),log);await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));
 if(result.code!==0){console.error('::error title=Windows backup lock acceptance::'+(result.stdout+result.stderr).slice(-12000).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A'));process.exitCode=1;break;}
}
const probes=moduleReadiness?[]:await Promise.all([probe('-Command',false),probe('-Command',false,true),probe('-EncodedCommand',false,true),probe('-Command',true,true),probe('-EncodedCommand',true,true)]);
await fs.writeFile(path.join(output,'legacy-transport.json'),JSON.stringify(probes,null,2));
for(const p of probes){const message=JSON.stringify(p).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A');console.log('::warning title=PowerShell lock transport diagnosis::'+message);}

if(process.env.GITHUB_STEP_SUMMARY)await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,'\n## Real Windows backup lock acceptance\n\n```json\n'+JSON.stringify(results,null,2)+'\n```\n');

if(moduleReadiness)console.log('::notice title=Windows lock acceptance results::'+JSON.stringify(results).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A'));
