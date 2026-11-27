'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const p=require('./template-protocol.cjs');
const {atomic,boundedRead}=require('./template-catalog-store.cjs');
function createTemplatePublicationService({directory,bridge,admin,source,now=()=>Date.now(),log=()=>{}}){
 let queue=Promise.resolve();const serial=fn=>{const pending=queue.then(fn,fn);queue=pending.catch(()=>{});return pending;};
 const file=id=>{p.check(typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id),'OPERATION_ID');return path.join(directory,id+'.json');};
 const save=async row=>{await fs.mkdir(directory,{recursive:true});await atomic(file(row.id),p.bytes(row));};
 const read=async id=>p.parse(await boundedRead(file(id),p.LIMITS.json+64000));
 const view=row=>({id:row.id,status:row.status,channel:row.request.channel,catalogVersion:row.catalogVersion,changes:row.request.proposals.map(x=>({id:x.template.id,version:x.template.templateVersion,summary:x.summary,action:x.template.retired?'remove':x.baseVersion==='0.0.0'?'add':'update'})),createdAt:row.createdAt,publishedAt:row.receipt?.publishedAt??null,sha256:row.staged?.hash??p.sha256(p.bytes(row.request)),runId:row.run?.runId??null,url:row.receipt?.url??row.run?.url??null,error:row.error??null});
 const requirePublisher=()=>p.check(source.publisher?.enabled===true&&source.enabled&&source.root,'PUBLISHER_NOT_CONFIGURED');
 const requireChannel=channel=>{p.check(['test','stable'].includes(channel),'CHANNEL');if(channel==='stable')p.check(source.publisher?.stableEnabled===true,'STABLE_PUBLICATION_LOCKED');};
 async function status(){try{requirePublisher();const capabilities=await bridge.call({operation:'capabilities'});return {configured:true,canPublish:true,stableEnabled:source.publisher?.stableEnabled===true&&capabilities.stableEnabled===true};}catch(error){return {configured:false,canPublish:false,stableEnabled:false,error:error.code??'PUBLISHER_NOT_CONFIGURED'};}}
 async function prepare(token,owner,draftIds,channel){admin.require(token,owner);requirePublisher();requireChannel(channel);if(channel==='stable')p.check((await bridge.call({operation:'capabilities'})).stableEnabled===true,'STABLE_PUBLICATION_LOCKED');p.check(Array.isArray(draftIds)&&draftIds.length>0&&draftIds.length<=50&&new Set(draftIds).size===draftIds.length,'DRAFT_IDS');
  const proposals=[];for(const id of draftIds){const proposal=await admin.preparePublication(token,owner,id);p.check(proposal.channel===channel,'CHANNEL');p.check(p.sha256(p.bytes({...proposal.template,templateVersion:proposal.baseVersion}))!==proposal.baseSha256,'NO_CONTENT_CHANGE');proposals.push(proposal);}
  p.check(new Set(proposals.map(x=>x.template.id)).size===proposals.length,'DUPLICATE_ID');p.check(proposals.filter(x=>x.template.retired).length<=1,'MASS_REMOVAL_BLOCKED');
  const base=await bridge.call({operation:'inspect',channel});const parts=base.version.split('.').map(Number);if(base.sequence===0)parts.splice(0,3,1,0,0);else parts[2]++;
  const catalogVersion=parts.join('.');p.version(catalogVersion);const id=crypto.randomUUID(),createdAt=new Date(now()).toISOString();
  const request={schemaVersion:1,type:'xrs-template-publication-request',requestId:id,channel,createdAt,expiresAt:new Date(now()+86400000).toISOString(),publisher:{login:'002-421',id:210672295},expectedCatalog:{version:base.version,sequence:base.sequence,manifestSha256:base.manifestSha256},proposals};
  const row={id,status:'VALIDATED',createdAt,catalogVersion,request,confirmed:false};await save(row);log({event:'template-publication',operation:'prepare',result:'success',operationId:id,channel,count:proposals.length});return view(row);
 }
 async function start(token,owner,id,confirmation){admin.require(token,owner);requirePublisher();return serial(async()=>{const row=await read(id);requireChannel(row.request.channel);if(row.request.channel==='stable')p.check((await bridge.call({operation:'capabilities'})).stableEnabled===true,'STABLE_PUBLICATION_LOCKED');p.check(confirmation?.confirmed===true&&confirmation.channel===row.request.channel&&confirmation.catalogVersion===row.catalogVersion&&confirmation.sha256===p.sha256(p.bytes(row.request)),'PUBLICATION_CONFIRMATION_REQUIRED');
   p.check(row.status==='VALIDATED'||row.confirmed,'PUBLICATION_STATE');row.confirmed=true;await save(row);
   try{if(!row.staged){row.staged=await bridge.call({operation:'stage',request:row.request,publicUploadConfirmed:true});row.status='PREPARED';await save(row);}
    if(!row.run){row.run=await bridge.call({operation:'dispatch',staged:row.staged,confirmation:{confirmed:true,stableConfirmed:row.request.channel==='stable'}});row.status='SUBMITTED';await save(row);}
   }catch(error){row.error=error.code??'PUBLICATION_FAILED';row.status=row.error==='DISPATCH_STATUS_UNKNOWN'?'UNKNOWN_REQUIRES_RECONCILIATION':'FAILED';await save(row);}
   return view(row);
  });}
 async function poll(token,owner,id){admin.require(token,owner);requirePublisher();return serial(async()=>{const row=await read(id);if(row.status==='PUBLISHED'&&!row.cleaned){try{await bridge.call({operation:'cleanup',staged:{...row.staged,request:row.request}});row.cleaned=true;await save(row);}catch{ /* Keep signed receipt; cleanup can be retried after reconnect. */ }}if(['PUBLISHED','FAILED','VALIDATED'].includes(row.status))return view(row);p.check(row.staged&&row.confirmed,'PUBLICATION_STATE');
   try{const remote=await bridge.call({operation:'status',staged:row.staged});row.run=remote;
    if(remote.status==='failed'){row.status='FAILED';row.error='WORKFLOW_FAILED';}
    else if(remote.status==='workflow-succeeded'||remote.status==='not-started'){
     if(remote.status==='not-started')row.status='UNKNOWN_REQUIRES_RECONCILIATION';
     const receipt=await bridge.call({operation:'verify',staged:{...row.staged,request:row.request}});p.check(receipt.status==='published'&&receipt.catalogVersion===row.catalogVersion&&receipt.requestId===row.id&&receipt.channel===row.request.channel&&/^[a-f0-9]{64}$/.test(receipt.manifestSha256),'PUBLICATION_BINDING');row.receipt=receipt;row.status='PUBLISHED';row.error=null;await save(row);
     try{await bridge.call({operation:'cleanup',staged:{...row.staged,request:row.request}});row.cleaned=true;}catch{row.cleaned=false;}
    }else{row.status='RUNNING';if(row.approvedRun!==remote.runId){try{await bridge.call({operation:'approve',staged:row.staged,confirmation:{confirmed:true,runId:remote.runId,workflowSha:remote.workflowSha,hash:row.staged.hash,channel:row.request.channel,catalogVersion:row.catalogVersion}});row.approvedRun=remote.runId;}catch(error){if(!['VALIDATION_REQUIRED','ENVIRONMENT_REVIEW_UNAVAILABLE'].includes(error.code))throw error;row.status='AWAITING_APPROVAL';}}}
   }catch(error){row.error=error.code??'PUBLICATION_FAILED';if(row.status!=='PUBLISHED')row.status='UNKNOWN_REQUIRES_RECONCILIATION';}
   await save(row);log({event:'template-publication',operation:'poll',operationId:id,status:row.status,code:row.error??undefined});return view(row);
  });}
 async function history(token,owner){admin.require(token,owner);let names;try{names=await fs.readdir(directory);}catch(error){if(error.code==='ENOENT')return [];throw error;}const rows=[];for(const name of names.filter(x=>/^[a-f0-9-]{36}\.json$/.test(x)).slice(-100))rows.push(view(await read(name.slice(0,-5))));return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 const templateSource=async(token,owner,channel,id,version)=>{admin.require(token,owner);requirePublisher();p.check(['test','stable'].includes(channel),'CHANNEL');return bridge.call({operation:'source',channel,id,...(version?{version}:{})});};
 return {status,prepare,start,poll,history,templateSource};
}
module.exports={createTemplatePublicationService};
