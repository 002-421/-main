'use strict';
const path=require('node:path');
const p=require('./template-protocol.cjs');
const {TemplateCatalogStore}=require('./template-catalog-store.cjs');
const {fetchBytes}=require('./template-transport.cjs');
function createTemplateUpdateService({userData,appVersion,source,baseline,fetchImpl,log=()=>{}}){
 const store=new TemplateCatalogStore({directory:path.join(userData,'template-catalog-v1'),baseline:baseline.templates,trust:source.enabled?source.root:null,channel:source.channel,appVersion,allowedImages:baseline.allowedImages,fetchBytes:(url,size)=>fetchBytes(url,size,{allowedPrefixes:source.allowedPrefixes,fetchImpl})});
 const safe=async(operation,run)=>{const start=Date.now();try{const result=await run();log({event:'template-update',operation,result:'success',elapsedMs:Date.now()-start});return result;}catch(error){const code=error.name==='TemplateProtocolError'?error.code:['EACCES','EPERM','EBUSY','ENOSPC','ENOENT'].includes(error.code)?error.code:'TEMPLATE_OPERATION_FAILED';log({event:'template-update',operation,result:'failed',code,syscall:typeof error.syscall==='string'?error.syscall:undefined,elapsedMs:Date.now()-start});throw Error(code);}};
 const state=async()=>{let loaded;try{loaded=await store.load();}catch(error){return {configured:Boolean(source.enabled&&source.root),error:error.name==='TemplateProtocolError'?error.code:'LOCAL_CATALOG_UNAVAILABLE',version:'builtin',count:baseline.templates.length,templates:[],history:[],canRollback:false};}
 return {configured:Boolean(source.enabled&&source.root),version:loaded.state.active?(await store.generation(loaded.state.active)).version:'builtin',count:baseline.templates.length+loaded.templates.filter(t=>!store.baseline.has(t.id)&&!t.retired).length-loaded.templates.filter(t=>store.baseline.has(t.id)&&t.retired).length,lastSuccess:loaded.state.lastSuccess,history:loaded.state.history,canRollback:loaded.state.previous.length>0,templates:loaded.templates,warnings:store.compatibilityWarnings??[]};};
 return {state:()=>safe('state',state),check:()=>safe('check',async()=>{p.check(source.enabled&&source.root,'TRUST_NOT_CONFIGURED');return store.check(await fetchBytes(source.manifestUrl,p.LIMITS.json,{allowedPrefixes:source.allowedPrefixes,fetchImpl}));}),install:(planId,confirmed)=>safe('install',async()=>{await store.install(planId,confirmed);return state();}),rollback:confirmed=>safe('rollback',async()=>{await store.rollback(confirmed);return state();})};
}
module.exports={createTemplateUpdateService};
