import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const script=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$utf8=[System.Text.UTF8Encoding]::new($false)
$f=$null
try {
  $f=[System.IO.File]::Open($env:XRS_TEST_LOCK_FILE,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None)
  $ready=@{event='LOCKED';nonce=$env:XRS_TEST_LOCK_NONCE;pid=$PID}|ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($env:XRS_TEST_LOCK_READY,$ready,$utf8)
  [Console]::Out.WriteLine($ready)
  [Console]::Out.Flush()
  $deadline=[DateTime]::UtcNow.AddSeconds(60)
  while (-not [System.IO.File]::Exists($env:XRS_TEST_LOCK_RELEASE)) {
    if ([DateTime]::UtcNow -ge $deadline) { throw 'Fixture release was not requested within 60 seconds' }
    Start-Sleep -Milliseconds 25
  }
  if ([System.IO.File]::ReadAllText($env:XRS_TEST_LOCK_RELEASE) -ne $env:XRS_TEST_LOCK_NONCE) { throw 'Fixture release nonce mismatch' }
} catch {
  [Console]::Error.WriteLine($_.Exception.ToString())
  exit 1
} finally {
  if ($null -ne $f) { $f.Dispose() }
}
`;

/** Test-only FileShare.None holder. No PowerShell host and Console.In compete for stdin. */
export async function holdWindowsFile(filename,root) {
  const nonce=randomUUID(),control=path.join(root,'fixture-'+nonce);
  await fs.mkdir(control);
  const readyPath=path.join(control,'ready.json'),releasePath=path.join(control,'release');
  const diagnostic={file:path.relative(root,filename),transport:'UTF-16LE EncodedCommand; Unicode environment path; readiness file + actual open denial',events:[],stdout:'',stderr:''};
  const started=Date.now(),record=(event,extra={})=>diagnostic.events.push({event,elapsedMs:Date.now()-started,...extra});
  const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{
    windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,XRS_TEST_LOCK_FILE:filename,XRS_TEST_LOCK_NONCE:nonce,XRS_TEST_LOCK_READY:readyPath,XRS_TEST_LOCK_RELEASE:releasePath},
  });
  let ended=false,exit;
  {
    child.on('spawn',()=>record('spawn',{pid:child.pid}));
    child.on('error',error=>record('spawn-error',{code:error.code,message:error.message}));
    child.on('close',(code,signal)=>{ended=true;exit={code,signal};record('close',exit);});
  }
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{diagnostic.stdout+=chunk;});child.stderr.on('data',chunk=>{diagnostic.stderr+=chunk;});
  async function save(){
    if(!process.env.XRS_LOCK_DIAGNOSTICS_DIR)return;
    await fs.mkdir(process.env.XRS_LOCK_DIAGNOSTICS_DIR,{recursive:true});
    await fs.writeFile(path.join(process.env.XRS_LOCK_DIAGNOSTICS_DIR,nonce+'.json'),JSON.stringify(diagnostic,null,2));
  }
  async function waitForClose(){const deadline=Date.now()+5000;while(!ended&&Date.now()<deadline)await pause(25);}
  let released=false;
  async function release(){
    if(released)return;released=true;
    try{
      if(!ended){record('release-request');await fs.writeFile(releasePath,nonce);await waitForClose();}
      if(!ended){record('forced-fixture-stop');child.kill();await waitForClose();}
      if(!ended)throw new Error('Synthetic PowerShell lock holder did not terminate');
      const file=await fs.open(filename,'r+');await file.close();record('unlock-verified');
      if(exit?.code!==0)throw new Error('Synthetic PowerShell lock holder exited unsuccessfully: '+JSON.stringify(exit));
    }finally{await save();}
  }
  try{
    const deadline=started+10000;let ready;
    while(Date.now()<deadline&&!ended){
      try{ready=JSON.parse(await fs.readFile(readyPath,'utf8'));break;}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
      await pause(25);
    }
    if(!ready)throw new Error('PowerShell lock readiness was not received: '+JSON.stringify({exit,elapsedMs:Date.now()-started,stdout:diagnostic.stdout,stderr:diagnostic.stderr}));
    if(ready.event!=='LOCKED'||ready.nonce!==nonce||ready.pid!==child.pid)throw new Error('Synthetic lock readiness identity mismatch');
    let lockCode;
    try{const file=await fs.open(filename,'r+');await file.close();}catch(error){lockCode=error.code;}
    if(!['EBUSY','EPERM','EACCES'].includes(lockCode))throw new Error('PowerShell announced readiness without a real exclusive file lock: '+lockCode);
    record('lock-verified',{code:lockCode,pid:ready.pid});await save();
    return {ready,lockCode,release};
  }catch(error){
    record('fixture-error',{message:error.message});
    try{await release();}catch(cleanup){record('cleanup-error',{message:cleanup.message});await save();}
    throw error;
  }
}
