'use strict';
const path=require('node:path');
const p=require('./template-protocol.cjs');
const {TemplateCatalogStore}=require('./template-catalog-store.cjs');
const {TemplateTrustStore}=require('./template-trust-store.cjs');
const {revisionIndex,readRevision}=require('./template-revisions.cjs');
const {fetchBytes}=require('./template-transport.cjs');
function createTemplateUpdateService({userData,appVersion,source,baseline,fetchImpl,log=()=>{}}){
 const simple=source.format==='https-sha256-v1',configured=Boolean(source.enabled&&(simple||source.root));
 const simpleProtocol=simple?require('./template-simple-catalog.cjs'):null;
 const trust=new TemplateTrustStore({directory:path.join(userData,'template-trust-v1'),anchor:source.root});
 const download=(url,size)=>fetchBytes(url,size,{allowedPrefixes:source.allowedPrefixes,fetchImpl});
 const store=new TemplateCatalogStore({codec:simple?{manifest:(raw,options)=>simpleProtocol.manifest(raw,options),readPackage:simpleProtocol.packageReader({allowedImages:baseline.allowedImages,appVersion})}:undefined,directory:path.join(userData,simple?'template-catalog-v2':'template-catalog-v1'),baseline:baseline.templates,trust:configured?source.root:null,channel:source.channel,appVersion,allowedImages:baseline.allowedImages,fetchBytes:download,historicalTrust:configured?(auth,role)=>trust.historical(auth,role):undefined});
 let initialization,operation=Promise.resolve();
 const serial=run=>{const pending=operation.then(run,run);operation=pending.catch(()=>{});return pending;};
 const ready=()=>initialization??=(async()=>{if(configured&&!simple)store.trust=await trust.load();})();
 const refresh=async()=>{await ready();p.check(configured,simple?'SOURCE_NOT_CONFIGURED':'TRUST_NOT_CONFIGURED');if(!simple&&source.rootUpdatesUrl){const raw=await download(source.rootUpdatesUrl,p.LIMITS.json);store.trust=await trust.update(raw);}if(!simple)p.validateRoot(store.trusted());};
 const safe=async(operation,run)=>{const start=Date.now();try{const result=await run();log({event:'template-update',operation,result:'success',elapsedMs:Date.now()-start});return result;}catch(error){const code=error.name==='TemplateProtocolError'?error.code:['EACCES','EPERM','EBUSY','ENOSPC','ENOENT'].includes(error.code)?error.code:'TEMPLATE_OPERATION_FAILED';log({event:'template-update',operation,result:'failed',code,elapsedMs:Date.now()-start});throw Error(code);}};
 const state=async()=>{await ready();let loaded;try{loaded=await store.load();}catch(error){return {configured,error:error.name==='TemplateProtocolError'?error.code:'LOCAL_CATALOG_UNAVAILABLE',version:'builtin',count:baseline.templates.length,templates:[],history:[],canRollback:false};}
  const generation=loaded.state.active?await store.generation(loaded.state.active):null;
  const latest=loaded.state.manifestSha256?await store.generation(loaded.state.manifestSha256):null;
  return {configured,version:generation?.version??'builtin',count:baseline.templates.length+loaded.templates.filter(t=>!store.baseline.has(t.id)&&!t.retired).length-loaded.templates.filter(t=>store.baseline.has(t.id)&&t.retired).length,lastSuccess:loaded.state.lastSuccess,history:loaded.state.history,canRollback:loaded.state.previous.length>0,templates:loaded.templates,activeTemplates:latest?.templates??loaded.templates,warnings:store.compatibilityWarnings??[],revisions:await revisionIndex(store),manifestSha256:loaded.state.active,channel:source.channel,publication:generation?.manifest?.publication??null,rootVersion:trust.root?.version??null};
 };
 return {
  revision:(id,version)=>safe('revision',async()=>{await ready();return readRevision(store,id,version);}),
  state:()=>safe('state',state),
  check:()=>serial(()=>safe('check',async()=>{await refresh();return store.check(await download(source.manifestUrl,p.LIMITS.json));})),
  install:(planId,confirmed)=>serial(()=>safe('install',async()=>{await ready();await store.install(planId,confirmed);return state();})),
  rollback:confirmed=>serial(()=>safe('rollback',async()=>{await ready();await store.rollback(confirmed);return state();})),
  trust:()=>safe('trust',async()=>{await ready();return {root:configured?trust.root:null,roots:configured?trust.roots:[],appVersion,channel:source.channel};}),
 };
}
module.exports={createTemplateUpdateService};
