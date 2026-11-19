import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// No cmdlet or module discovery is allowed on the readiness/release path.
// In particular ConvertTo-Json used to run after acquiring the lock but before
// ready.json existed; its first-use module loading was invisible to the parent.
const script=String.raw`
$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$utf8=[System.Text.UTF8Encoding]::new($false)
$clock=[System.Diagnostics.Stopwatch]::StartNew()
function Record-FixtureEvent([string]$name,[string]$extra='') {
  $json='{"event":"'+$name+'","pid":'+$PID+',"elapsedMs":'+$clock.ElapsedMilliseconds+',"utc":"'+[DateTime]::UtcNow.ToString('o')+'"'+$extra+'}'
  [System.IO.File]::AppendAllText($env:XRS_TEST_LOCK_EVENTS,$json+[Environment]::NewLine,$utf8)
}
$f=$null
$code=0
try {
  Record-FixtureEvent 'script-start'
  Record-FixtureEvent 'open-start'
  $f=[System.IO.File]::Open($env:XRS_TEST_LOCK_FILE,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None)
  Record-FixtureEvent 'lock-acquired'
  $ready='{"event":"LOCKED","nonce":"'+$env:XRS_TEST_LOCK_NONCE+'","pid":'+$PID+'}'
  [System.IO.File]::WriteAllText($env:XRS_TEST_LOCK_READY+'.tmp',$ready,$utf8)
  [System.IO.File]::Move($env:XRS_TEST_LOCK_READY+'.tmp',$env:XRS_TEST_LOCK_READY)
  Record-FixtureEvent 'ready-published'
  [Console]::Out.WriteLine($ready)
  [Console]::Out.Flush()
  $deadline=[DateTime]::UtcNow.AddSeconds(60)
  while (-not [System.IO.File]::Exists($env:XRS_TEST_LOCK_RELEASE)) {
    if ([DateTime]::UtcNow -ge $deadline) { throw 'Fixture release was not requested within 60 seconds' }
    [System.Threading.Thread]::Sleep(25)
  }
  if ([System.IO.File]::ReadAllText($env:XRS_TEST_LOCK_RELEASE) -ne $env:XRS_TEST_LOCK_NONCE) { throw 'Fixture release nonce mismatch' }
  Record-FixtureEvent 'release-received'
} catch {
  $code=1
  Record-FixtureEvent 'script-error' (',"exceptionType":"'+$_.Exception.GetType().FullName+'","hresult":'+$_.Exception.HResult)
  [Console]::Error.WriteLine($_.Exception.GetType().FullName+': '+$_.Exception.HResult)
} finally {
  if ($null -ne $f) { $f.Dispose(); Record-FixtureEvent 'lock-disposed' }
  Record-FixtureEvent 'script-exit' (',"code":'+$code)
}
exit $code
`;

/** Real Windows FileShare.None lock, with a nonce-bound atomic ready file. */
export async function holdWindowsFile(filename,root) {
  if(process.platform!=='win32')throw new Error('Windows file-lock fixture requires Windows');
  const nonce=randomUUID(),control=path.join(root,'fixture-'+nonce);
  await fs.mkdir(control);
  const readyPath=path.join(control,'ready.json'),releasePath=path.join(control,'release'),eventsPath=path.join(control,'events.jsonl');
  const diagnostic={testPid:process.pid,startedAt:new Date().toISOString(),file:path.relative(root,filename),transport:'UTF-16LE EncodedCommand; Unicode environment; atomic readiness; .NET-only, module auto-loading disabled',readinessTimeoutMs:10000,environment:{psModulePathPresent:Boolean(process.env.PSModulePath),psModulePathEntries:(process.env.PSModulePath??'').split(path.delimiter).filter(Boolean).length},events:[],childEvents:[],stdout:'',stderr:''};
  const started=Date.now(),safe=value=>String(value).replaceAll(root,'<synthetic-temp>'),record=(event,extra={})=>diagnostic.events.push({event,elapsedMs:Date.now()-started,at:new Date().toISOString(),...extra});
  const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{
    windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,XRS_TEST_LOCK_FILE:filename,XRS_TEST_LOCK_NONCE:nonce,XRS_TEST_LOCK_READY:readyPath,XRS_TEST_LOCK_RELEASE:releasePath,XRS_TEST_LOCK_EVENTS:eventsPath},
  });
  let ended=false,exit;
  child.on('spawn',()=>{diagnostic.childPid=child.pid;record('spawn',{pid:child.pid});});
  child.on('error',error=>record('spawn-error',{code:error.code}));
  child.on('exit',(code,signal)=>{diagnostic.exit={code,signal};record('exit',{code,signal});});
  child.on('close',(code,signal)=>{ended=true;exit={code,signal};record('close',exit);});
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{diagnostic.stdout=(diagnostic.stdout+safe(chunk)).slice(-65536);});child.stderr.on('data',chunk=>{diagnostic.stderr=(diagnostic.stderr+safe(chunk)).slice(-65536);});
  async function childEvents(){
    try{return(await fs.readFile(eventsPath,'utf8')).trim().split(/\r?\n/).filter(Boolean).flatMap(line=>{try{return[JSON.parse(line)];}catch{return[];}});}catch(error){if(error.code==='ENOENT')return[];throw error;}
  }
  async function save(){
    diagnostic.childEvents=await childEvents();
    const output=process.env.XRS_LOCK_DIAGNOSTICS_DIR??path.resolve('test-output/windows-backup-lock/holders');
    await fs.mkdir(output,{recursive:true});
    await fs.writeFile(path.join(output,nonce+'.json'),JSON.stringify(diagnostic,null,2));
  }
  async function waitForClose(){const deadline=Date.now()+5000;while(!ended&&Date.now()<deadline)await pause(25);}
  let released=false;
  async function release(){
    if(released)return;released=true;
    try{
      if(!ended){record('release-request');await fs.writeFile(releasePath,nonce);await waitForClose();}
      if(!ended){record('forced-fixture-stop',{pid:child.pid});child.kill();await waitForClose();}
      if(!ended)throw new Error('Synthetic PowerShell lock holder did not terminate');
      const file=await fs.open(filename,'r+');await file.close();record('unlock-verified');
      if(exit?.code!==0)throw new Error('Synthetic PowerShell lock holder exited unsuccessfully: '+JSON.stringify(exit));
    }finally{await save();}
  }
  try{
    const deadline=started+diagnostic.readinessTimeoutMs;let ready;
    while(Date.now()<deadline&&!ended){
      try{ready=JSON.parse(await fs.readFile(readyPath,'utf8'));record('ready-observed',{pid:ready.pid});break;}catch(error){if(error.code!=='ENOENT')throw error;}
      await pause(25);
    }
    if(!ready){
      const phases=await childEvents(),last=phases.at(-1)?.event??'before-script-start';diagnostic.timeoutReason=ended?'child-exited-before-ready':'no-ready-after-'+last;
      throw new Error('PowerShell lock readiness was not received: '+JSON.stringify({reason:diagnostic.timeoutReason,testPid:process.pid,childPid:child.pid,exit,elapsedMs:Date.now()-started,lastChildPhase:last,stdout:diagnostic.stdout,stderr:diagnostic.stderr}));
    }
    if(ready.event!=='LOCKED'||ready.nonce!==nonce||ready.pid!==child.pid)throw new Error('Synthetic lock readiness identity mismatch');
    let lockCode;
    try{const file=await fs.open(filename,'r+');await file.close();}catch(error){lockCode=error.code;}
    if(!['EBUSY','EPERM','EACCES'].includes(lockCode))throw new Error('PowerShell announced readiness without a real exclusive file lock: '+lockCode);
    record('lock-verified',{code:lockCode,pid:ready.pid});await save();
    return {ready,lockCode,release};
  }catch(error){
    record('fixture-error',{message:safe(error.message)});
    try{await release();}catch(cleanup){record('cleanup-error',{message:safe(cleanup.message)});await save();}
    throw error;
  }
}
