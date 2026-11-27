'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const p=require('./template-protocol.cjs');
async function verifyComponent(directory=__dirname){
 const file=path.join(directory,'template-publisher-runtime.cjs'),metadata=require(path.join(directory,'template-publisher-provenance.cjs'));
 p.check(metadata.protocolVersion===2&&/^[a-f0-9]{40}$/.test(metadata.commit)&&/^[a-f0-9]{64}$/.test(metadata.sha256),'PUBLISHER_COMPONENT');
 const stat=await fs.lstat(file);p.check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=16*1024*1024,'PUBLISHER_COMPONENT');
 p.check(await fs.realpath(file)===path.join(await fs.realpath(directory),'template-publisher-runtime.cjs'),'PUBLISHER_COMPONENT');
 p.check(p.sha256(Buffer.from((await fs.readFile(file,'utf8')).replaceAll('\r\n','\n')))===metadata.sha256,'PUBLISHER_COMPONENT_HASH');return {file,metadata};
}
function createPublisherBridge({context,executable=process.execPath,spawnProcess=spawn,directory=__dirname,timeout=120000}={}){
 return {async call(command){
  const {file}=await verifyComponent(directory),operationId=crypto.randomUUID();
  const envelope={protocolVersion:2,operationId,command,context:await context()};
  const input=JSON.stringify(envelope);p.check(Buffer.byteLength(input)<=p.LIMITS.archive+64000,'SIZE');
  return new Promise((resolve,reject)=>{
   const env={...process.env,ELECTRON_RUN_AS_NODE:'1',GH_PROMPT_DISABLED:'1',GH_NO_UPDATE_NOTIFIER:'1'};delete env.GH_DEBUG;delete env.DEBUG;delete env.NODE_OPTIONS;delete env.NODE_PATH;delete env.NODE_DEBUG;
   const child=spawnProcess(executable,[file],{stdio:['pipe','pipe','pipe'],shell:false,windowsHide:true,env});const chunks=[];let size=0,done=false;
   const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(result);};
   const fail=code=>{child.kill();const error=Error(code);error.name='TemplateProtocolError';error.code=code;finish(error);};
   const timer=setTimeout(()=>fail('PUBLISHER_IPC_TIMEOUT'),timeout);
   child.on('error',()=>fail('PUBLISHER_PROCESS_FAILED'));child.stdin.on('error',()=>fail('PUBLISHER_IPC_CLOSED'));
   child.stdout.on('data',chunk=>{size+=chunk.length;if(size>12*1024*1024)return fail('PUBLISHER_IPC_SIZE');chunks.push(Buffer.from(chunk));});
   child.stderr.on('data',()=>{}); // Never forward subprocess output or credential-bearing diagnostics.
   child.on('close',code=>{if(done)return;let result;try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{return fail('PUBLISHER_IPC_RESPONSE');}
    if(result.protocolVersion!==2||result.operationId!==operationId||!['PREPARED','VALIDATED','PUBLISHED','UP_TO_DATE','FAILED'].includes(result.status))return fail('PUBLISHER_PROTOCOL_VERSION');
    if(code!==0||result.error){const errorCode=typeof result.error==='string'&&/^[A-Z0-9_]{1,100}$/.test(result.error)?result.error:'PUBLISHER_PROCESS_FAILED';return fail(errorCode);}
    finish(null,result.result);
   });child.stdin.end(input);
  });
 }};
}
module.exports={createPublisherBridge,verifyComponent};
