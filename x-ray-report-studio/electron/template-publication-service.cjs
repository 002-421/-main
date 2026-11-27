'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const p=require('./template-protocol.cjs'),{atomic,boundedRead}=require('./template-catalog-store.cjs');
function createTemplatePublicationService({directory,bridge,admin,source,now=()=>Date.now(),log=()=>{}}){
 let queue=Promise.resolve();const serial=fn=>{const pending=queue.then(fn,fn);queue=pending.catch(()=>{});return pending;};
 const configured=()=>p.check(source.format==='https-sha256-v1'&&source.enabled&&source.publisher?.enabled,'PUBLISHER_NOT_CONFIGURED');
 const save=async row=>{await fs.mkdir(directory,{recursive:true});await atomic(path.join(directory,row.id+'.json'),p.bytes(row));};
 const read=async name=>p.parse(await boundedRead(path.join(directory,name),p.LIMITS.archive+64000),p.LIMITS.archive+64000);
 const view=row=>({id:row.id,status:row.status,catalogVersion:row.receipt?.catalogVersion??row.request?.catalogVersion??null,createdAt:row.createdAt,publishedAt:row.receipt?.publishedAt??null,sha256:row.receipt?.sha256??null,url:row.receipt?.url??null,changed:row.receipt?.changed??0,error:row.error??null});
 async function status(){try{configured();await bridge.call({operation:'authorize'});const remote=await bridge.call({operation:'inspect'});return {configured:true,canPublish:true,version:remote.version,count:remote.count};}catch(error){return {configured:source.format==='https-sha256-v1',canPublish:false,error:error.code??'GITHUB_LOGIN_REQUIRED'};}}
 async function publish(owner,pin){return serial(async()=>{configured();await admin.authorizePublication(pin);await bridge.call({operation:'authorize'});let row;
  try{const pending=await read('pending.json');p.check(/^[a-f0-9-]{36}$/.test(pending.id),'OPERATION_ID');row=await read(pending.id+'.json');if(['PUBLISHED','UP_TO_DATE'].includes(row.status)){await fs.rm(path.join(directory,'pending.json'),{force:true}).catch(()=>{});return view(row);}}catch(error){if(error.code!=='ENOENT')throw error;row={id:crypto.randomUUID(),createdAt:new Date(now()).toISOString(),status:'PREPARED',request:null};}
  try{if(!row.request){const prepared=await bridge.call({operation:'prepare',id:row.id,approved:await admin.approved()});if(prepared.status==='up-to-date'){row.status='UP_TO_DATE';row.receipt=prepared;await save(row);return view(row);}p.check(prepared.status==='prepared'&&prepared.request?.id===row.id,'PUBLICATION_BINDING');row.request=prepared.request;await save(row);await atomic(path.join(directory,'pending.json'),p.bytes({id:row.id}));}
   row.status='UPLOADING';await save(row);const receipt=await bridge.call({operation:'publish',request:row.request});p.check(receipt.status==='published'&&receipt.publicationId===row.id&&receipt.catalogVersion===row.request.catalogVersion&&/^[a-f0-9]{64}$/.test(receipt.sha256),'PUBLICATION_BINDING');row.receipt=receipt;row.status='PUBLISHED';row.error=null;await save(row);await fs.rm(path.join(directory,'pending.json'),{force:true}).catch(()=>{});
  }catch(error){row.status=['VERSION_CONFLICT','CATALOG_BASE_CONFLICT','BASE_CONFLICT'].includes(error.code)?'FAILED':'UNKNOWN_REQUIRES_RECONCILIATION';if(row.status==='FAILED')await fs.rm(path.join(directory,'pending.json'),{force:true}).catch(()=>{});row.error=error.code??'PUBLICATION_FAILED';await save(row);throw error;}
  log({event:'template-publication',operationId:row.id,result:row.status,version:row.receipt.catalogVersion});return view(row);
 });}
 async function history(token,owner){admin.require(token,owner);let names;try{names=await fs.readdir(directory);}catch(e){if(e.code==='ENOENT')return [];throw e;}const rows=[];for(const name of names.filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)))rows.push(view(await read(name)));return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100);}
 const templateSource=async(token,owner,_channel,id,version)=>{admin.require(token,owner);configured();return bridge.call({operation:'source',id,...(version?{version}:{})});};
 return {status,publish,history,templateSource};
}
module.exports={createTemplatePublicationService};
