'use strict';
const p=require('./template-protocol.cjs');
const {boundedRead}=require('./template-catalog-store.cjs');
/** Revision views use the existing authenticated generations/cache, not another store. */
async function revisionIndex(store){
 const state=await store.state(),rows=new Map(),current=state.manifestSha256?await store.generation(state.manifestSha256):null,active=new Map((current?.manifest?.packages??[]).filter(e=>e.action!=='remove').map(e=>[e.templateId,e.templateVersion]));
 for(const t of store.baseline.values())rows.set(t.id+'@'+t.templateVersion,{templateId:t.id,templateVersion:t.templateVersion,status:current?.manifest?.packages.some(e=>e.templateId===t.id)&&active.get(t.id)!==t.templateVersion?'Archived':'Active',publishedAt:null,approvedBy:'builtin',sha256:t.sha256??p.sha256(p.bytes(t)),builtin:true,available:true});
 for(const id of state.known){const g=await store.generation(id);for(const e of g.manifest.packages)rows.set(e.templateId+'@'+e.templateVersion,{...e,status:e.action==='remove'?'Revoked':active.get(e.templateId)===e.templateVersion?'Active':'Archived',publishedAt:g.manifest.publishedAt,approvedBy:'legacy-signed',builtin:false,available:true,catalogVersion:g.manifest.catalogVersion});}
 if(current?.manifest?.schemaVersion===2)for(const r of current.manifest.revisions){let available=true;try{await boundedRead(store.get('packages/'+r.sha256+'.xrszip'),p.LIMITS.archive);}catch(e){if(e.code==='ENOENT')available=false;else throw e;}rows.set(r.templateId+'@'+r.templateVersion,{...r,builtin:false,available,catalogVersion:current.manifest.catalogVersion});}
 return [...rows.values()].sort((a,b)=>a.templateId.localeCompare(b.templateId)||p.compare(b.templateVersion,a.templateVersion));
}
async function readRevision(store,id,version){p.string(id,120);p.version(version);const row=(await revisionIndex(store)).find(r=>r.templateId===id&&r.templateVersion===version);p.check(row,'REVISION_NOT_FOUND');p.check(row.status!=='Revoked','REVISION_REVOKED');p.check(row.available,'REVISION_NOT_CACHED');if(row.builtin)return {metadata:row,builtin:true};
 const raw=await boundedRead(store.get('packages/'+row.sha256+'.xrszip'),p.LIMITS.archive),template=p.readPackage(raw,row,store.trusted(),{appVersion:store.appVersion,allowedImages:store.allowedImages,channel:store.channel});return {metadata:row,template,builtin:false};
}
module.exports={revisionIndex,readRevision};
