'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const p=require('./template-protocol.cjs');
const MAX_STORE=128*1024*1024;
const emptyState=()=>({schemaVersion:1,active:null,previous:[],known:[],sequence:0,manifestSha256:null,catalogVersion:'0.0.0',lastSuccess:null,history:[]});
const isHash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
async function boundedRead(file,max){const stat=await fs.lstat(file);p.check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=max,'LOCAL_SIZE');return fs.readFile(file);}
async function atomic(file,data){
 const tmp=file+'.'+crypto.randomUUID()+'.tmp';let handle;try{handle=await fs.open(tmp,'wx',0o600);await handle.writeFile(data);await handle.sync();await handle.close();handle=null;await fs.rename(tmp,file);
 if(process.platform!=='win32'){const dir=await fs.open(path.dirname(file),'r');try{await dir.sync();}finally{await dir.close();}}
 }finally{if(handle)await handle.close();await fs.rm(tmp,{force:true});}
}
function checkState(s){p.keys(s,['schemaVersion','active','previous','known','sequence','manifestSha256','catalogVersion','lastSuccess','history']);p.check(s.schemaVersion===1&&(s.active===null||isHash(s.active))&&Array.isArray(s.previous)&&s.previous.length<=50&&s.previous.every(v=>v===null||isHash(v))&&Array.isArray(s.known)&&s.known.length<=500&&s.known.every(isHash)&&Number.isSafeInteger(s.sequence)&&s.sequence>=0&&(s.manifestSha256===null||isHash(s.manifestSha256))&&Array.isArray(s.history)&&s.history.length<=100,'LOCAL_STATE');p.version(s.catalogVersion);return s;}
class TemplateCatalogStore{
 constructor({directory,baseline,trust,channel='stable',appVersion,fetchBytes,allowedImages=[],now=()=>Date.now(),fault=async()=>{},historicalTrust,codec}){
 this.directory=directory;this.baseline=new Map(baseline.map(t=>[t.id,structuredClone(t)]));this.trust=trust;this.channel=channel;this.appVersion=appVersion;this.fetchBytes=fetchBytes;this.allowedImages=allowedImages;this.now=now;this.fault=fault;this.plans=new Map();this.historicalTrust=historicalTrust;this.codec=codec;
 }
 get(file){return path.join(this.directory,file);}
 readPackage(raw,entry){if(this.codec)return this.codec.readPackage(raw,entry);p.check(raw.length===entry.size&&p.sha256(raw)===entry.sha256,'PACKAGE_HASH');const root=this.historicalTrust?this.historicalTrust(p.parse(p.unzip(raw)['package.json']),this.channel):this.trusted();return p.readPackage(raw,entry,root,{appVersion:this.appVersion,allowedImages:this.allowedImages,channel:this.channel});}
 async lock(action){
 await fs.mkdir(this.directory,{recursive:true});const locks=this.get('locks');await fs.mkdir(locks,{recursive:true});
 const name=String(process.pid)+'.'+crypto.randomUUID()+'.json',file=path.join(locks,name);
 await atomic(this.get('lease-'+name),p.bytes({pid:process.pid}));await fs.rename(this.get('lease-'+name),file);
 try{for(const candidate of await fs.readdir(locks)){
 if(candidate===name)continue;p.check(/^\d+\.[a-f0-9-]{36}\.json$/.test(candidate),'LOCK');
 const pid=Number(candidate.split('.')[0]);p.check(Number.isSafeInteger(pid)&&pid>0,'LOCK');
 let alive=true;try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')alive=false;else throw error;}
 p.check(!alive,'BUSY');await fs.rm(path.join(locks,candidate),{force:true});
 }return await action();}finally{await fs.rm(file,{force:true});}
 }
 async state(){try{return checkState(p.parse(await boundedRead(this.get('state.json'),256000)));}catch(e){if(e.code==='ENOENT')return emptyState();throw e;}}
 manifest(raw,expiry=false){if(this.codec)return this.codec.manifest(raw,{appVersion:this.appVersion,channel:this.channel,now:this.now(),expiry});const auth=p.parse(raw),root=this.historicalTrust&&!expiry?this.historicalTrust(auth,this.channel):this.trusted();if(expiry)p.validateRoot(root,this.now());const m=p.verify(auth,root,this.channel);p.validateManifest(m,{channel:this.channel,appVersion:this.appVersion,now:this.now(),expiry});p.check(root.roles[this.channel].keyIds.includes(m.publisher.keyId)&&auth.signatures.some(s=>s.keyId===m.publisher.keyId),'PUBLISHER');return m;}
 trusted(){p.check(this.trust,'TRUST_NOT_CONFIGURED');p.validateRoot(this.trust,this.now(),false);return this.trust;}
 async generation(id){
 if(id===null)return {version:'builtin',templates:[]};p.check(isHash(id),'LOCAL_PATH');const dir=this.get('generations/'+id),raw=await boundedRead(path.join(dir,'manifest.json'),p.LIMITS.json);p.check(p.sha256(raw)===id,'LOCAL_HASH');
 const m=this.manifest(raw);
 const templates=[],bundles=new Map();for(const entry of m.packages){let data=bundles.get(entry.sha256);if(!data){data=await boundedRead(this.get('packages/'+entry.sha256+'.xrszip'),p.LIMITS.archive);bundles.set(entry.sha256,data);if(bundles.size>4)bundles.delete(bundles.keys().next().value);}templates.push(this.readPackage(data,entry));}
 return {version:m.catalogVersion,templates,manifest:m};
 }
 async load(){
 this.compatibilityWarnings=[];const s=await this.state(),retained=new Map();
 // Preserve identities of newly introduced templates across rollback/restart.
 // They remain unavailable for new reports; saved documents can still resolve
 // their template ID. Every retained entry is read from a signed generation.
 for(const id of s.known){const g=await this.generation(id);for(const t of g.templates)if(!this.baseline.has(t.id))retained.set(t.id,{...t,retired:true});}
 const active=s.active===null?[]:this.effective((await this.generation(s.active)).templates);
 for(const t of active)retained.delete(t.id);
 return {state:s,templates:[...retained.values(),...active]};
 }
 effective(templates,{installing=false}={}){
 return templates.filter(t=>{const base=this.baseline.get(t.id);if(!base)return true;
 const cmp=p.compare(t.templateVersion,base.templateVersion);if(cmp<0){this.compatibilityWarnings?.push({templateId:t.id,code:'BUILTIN_NEWER'});return false;}
 if(cmp===0){const equal=p.sha256(p.bytes(t))===(base.sha256??p.sha256(p.bytes(base)));if(installing)p.check(equal,'VERSION_EQUIVOCATION');else if(!equal)this.compatibilityWarnings?.push({templateId:t.id,code:'BUILTIN_SAME_VERSION_CONFLICT'});return false;}try{p.continuity(base,t);}catch(error){if(installing)throw error;this.compatibilityWarnings?.push({templateId:t.id,code:'BUILTIN_STRUCTURE_CHANGED'});return false;}return true;});
 }
 async check(raw){
 const m=this.manifest(raw,true);
 const s=await this.state(),hash=p.sha256(raw);p.check(m.sequence>=s.sequence,'REPLAY');if(m.sequence===s.sequence)p.check(hash===s.manifestSha256,'EQUIVOCATION');else p.check(p.compare(m.catalogVersion,s.catalogVersion)>0,'VERSION_REPLAY');
 if(s.manifestSha256){const before=(await this.generation(s.manifestSha256)).manifest;if([2,3].includes(before?.schemaVersion)){p.check(m.schemaVersion===before.schemaVersion,'REVISION_DOWNGRADE');for(const old of before.revisions){const next=m.revisions.find(r=>r.templateId===old.templateId&&r.templateVersion===old.templateVersion);p.check(next,'REVISION_IMMUTABLE');const {status:oldStatus,...oldData}=old,{status:nextStatus,...nextData}=next;p.check(p.canonical(oldData)===p.canonical(nextData),'REVISION_IMMUTABLE');p.check(old.status!=='Revoked'||next.status==='Revoked','REVOCATION_REPLAY');}}}
 if(s.active===hash)return {upToDate:true,catalogVersion:m.catalogVersion,changes:[]};
 const current=await this.generation(s.active),previous=new Map(current.templates.map(t=>[t.id,t]));const changes=m.packages.filter(entry=>!previous.has(entry.templateId)||previous.get(entry.templateId).templateVersion!==entry.templateVersion).map(entry=>({id:entry.templateId,version:entry.templateVersion,action:entry.action,summary:entry.summary}));
 const existing=[...this.plans.entries()].find(([,plan])=>plan.raw.equals(Buffer.from(raw))&&plan.stateHash===p.sha256(p.bytes(s))&&this.now()-plan.createdAt<15*60000);const token=existing?.[0]??crypto.randomUUID();this.plans.clear();this.plans.set(token,{raw:Buffer.from(raw),manifest:m,stateHash:p.sha256(p.bytes(s)),createdAt:this.now()});return {upToDate:false,planId:token,catalogVersion:m.catalogVersion,changes,downloadBytes:m.packages.reduce((n,e)=>n+e.size,0)};
 }
 async install(planId,confirmed){p.check(confirmed===true,'CONFIRMATION_REQUIRED');const plan=this.plans.get(planId);p.check(plan&&this.now()-plan.createdAt<15*60000,'PLAN_EXPIRED');return this.lock(async()=>{
 const old=await this.state();p.check(plan.stateHash===p.sha256(p.bytes(old)),'STALE_PLAN');this.manifest(plan.raw,true);
 await fs.mkdir(this.get('packages'),{recursive:true});await fs.mkdir(this.get('generations'),{recursive:true});
 const active=await this.generation(old.active),previous=new Map([...this.baseline.values(),...active.templates].map(t=>[t.id,t]));const candidate=[];
 let usage=await this.diskUsage();let needed=plan.raw.length+64000;const requiredHashes=new Set();for(const entry of plan.manifest.packages){if(requiredHashes.has(entry.sha256))continue;requiredHashes.add(entry.sha256);try{await fs.access(this.get('packages/'+entry.sha256+'.xrszip'));}catch(error){if(error.code!=='ENOENT')throw error;needed+=entry.size;}}p.check(usage+needed<=MAX_STORE,'STORAGE_QUOTA');
 const archives=(plan.manifest.revisions??[]).filter(r=>r.status==='Archived'&&!plan.manifest.packages.some(e=>e.sha256===r.sha256));for(const entry of archives){if(requiredHashes.has(entry.sha256))continue;requiredHashes.add(entry.sha256);try{await fs.access(this.get('packages/'+entry.sha256+'.xrszip'));}catch(e){if(e.code!=='ENOENT')throw e;needed+=entry.size;}}p.check(usage+needed<=MAX_STORE,'STORAGE_QUOTA');
 const verifiedArchives=new Map();for(const entry of [...plan.manifest.packages,...archives]){let raw=verifiedArchives.get(entry.sha256),needsWrite=false;const target=this.get('packages/'+entry.sha256+'.xrszip');if(!raw){try{raw=await boundedRead(target,p.LIMITS.archive);}catch(e){if(e.code!=='ENOENT')throw e;raw=await this.fetchBytes(entry.url,entry.size);needsWrite=true;}}
 const t=this.readPackage(raw,entry);
 const before=previous.get(t.id);if(before){p.continuity(before,t);const cmp=p.compare(t.templateVersion,before.templateVersion);if(cmp===0)p.check(p.sha256(p.bytes(t))===(before.sha256??p.sha256(p.bytes(before))),'VERSION_EQUIVOCATION');else if(cmp<0&&plan.manifest.packages.some(e=>e.sha256===entry.sha256)){const base=this.baseline.get(t.id);p.check(base&&p.compare(base.templateVersion,t.templateVersion)>0,'TEMPLATE_DOWNGRADE');}}
 else p.check(entry.action==='add'||plan.manifest.revisions?.some(r=>r.templateId===t.id&&r.action==='add'),'UNKNOWN_TEMPLATE');if(plan.manifest.packages.some(e=>e.sha256===entry.sha256))candidate.push(t);if(needsWrite)await atomic(target,raw);verifiedArchives.set(entry.sha256,raw);if(verifiedArchives.size>4)verifiedArchives.delete(verifiedArchives.keys().next().value);await this.fault('package-verified');}
 for(const previousTemplate of active.templates)p.check(candidate.some(t=>t.id===previousTemplate.id),'MISSING_CATALOG_ENTRY');
 this.effective(candidate,{installing:true});const id=p.sha256(plan.raw),dir=this.get('generations/'+id);await fs.mkdir(dir,{recursive:true});await atomic(path.join(dir,'manifest.json'),plan.raw);await this.generation(id);await this.fault('generation-verified');
 p.check(old.known.includes(id)||old.known.length<500,'STORAGE_QUOTA');
 const next={...old,active:id,known:[...new Set([...old.known,id])],previous:[old.active,...old.previous].filter((v,i,a)=>v!==id&&a.indexOf(v)===i).slice(0,50),sequence:Math.max(old.sequence,plan.manifest.sequence),manifestSha256:id,catalogVersion:plan.manifest.catalogVersion,lastSuccess:new Date(this.now()).toISOString(),history:[{at:new Date(this.now()).toISOString(),operation:'install',version:plan.manifest.catalogVersion,sha256:id,channel:this.channel,changes:plan.manifest.packages.filter(entry=>!previous.has(entry.templateId)||previous.get(entry.templateId).templateVersion!==entry.templateVersion).length},...old.history].slice(0,100)};
 await atomic(this.get('state-before.json'),p.bytes(old));await this.fault('before-activation');await atomic(this.get('state.json'),p.bytes(next));await this.fault('after-activation');
 try{await this.load();}catch(e){await atomic(this.get('state.json'),p.bytes(old));throw e;}
 this.plans.clear();return this.load();
 });}
 async rollback(confirmed){p.check(confirmed===true,'CONFIRMATION_REQUIRED');return this.lock(async()=>{const old=await this.state();p.check(old.previous.length>0,'NO_PREVIOUS_CATALOG');const [active,...rest]=old.previous;await this.generation(active);const next={...old,active,previous:rest,history:[{at:new Date(this.now()).toISOString(),operation:'rollback',version:(await this.generation(active)).version,sha256:active,channel:this.channel},...old.history].slice(0,100)};
 await atomic(this.get('state-before.json'),p.bytes(old));await atomic(this.get('state.json'),p.bytes(next));await this.load();this.plans.clear();return this.load();});}
 async diskUsage(){let n=0;const walk=async directory=>{for(const file of await fs.readdir(directory,{withFileTypes:true})){const target=path.join(directory,file.name);p.check(!file.isSymbolicLink(),'LOCAL_SYMLINK');if(file.isDirectory())await walk(target);else if(file.isFile())n+=(await fs.stat(target)).size;}};await walk(this.directory);return n;}
}
module.exports={TemplateCatalogStore,atomic,boundedRead,MAX_STORE};
