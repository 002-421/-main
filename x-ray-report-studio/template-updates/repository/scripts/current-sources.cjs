'use strict';
const p=require('./lib/template-protocol.cjs');
const {fetchBytes}=require('./lib/template-transport.cjs');
const PREFIX='https://github.com/002-421/XRS-Templates/releases/';
async function applyPublishedSources(raw,root,channel,sources,baseline){
 const auth=p.parse(raw),manifest=p.verify(auth,root,channel);p.validateManifest(manifest,{channel,appVersion:'0.4.84'});
 const result=new Map(sources);for(const entry of manifest.packages){const bytes=await fetchBytes(entry.url,entry.size,{allowedPrefixes:[PREFIX]});const t=p.readPackage(bytes,entry,root,{channel,appVersion:'0.4.84',allowedImages:baseline.allowedImages});const base=sources.get(t.id);if(base){p.continuity(base,t);p.check(p.compare(t.templateVersion,base.templateVersion)>=0,'TEMPLATE_DOWNGRADE');}else p.check(entry.action==='add'||manifest.revisions?.some(r=>r.templateId===t.id&&r.action==='add'),'UNKNOWN_TEMPLATE');result.set(t.id,t);}return {sources:result,manifest};
}
async function publicManifest(channel){
 if(channel==='stable')return fetchBytes(PREFIX+'latest/download/manifest.json',p.LIMITS.json,{allowedPrefixes:[PREFIX]});
 const response=await fetch('https://api.github.com/repos/002-421/XRS-Templates/releases?per_page=100',{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(30000)});p.check(response.ok,'SOURCE_NOT_FOUND');const rows=await response.json();p.check(Array.isArray(rows)&&rows.length<=100,'SOURCE_INDEX');const tags=rows.filter(r=>!r.draft&&/^test-catalog-v\d+\.\d+\.\d+$/.test(r.tag_name));tags.sort((a,b)=>p.compare(b.tag_name.slice(14),a.tag_name.slice(14)));p.check(tags.length,'SOURCE_NOT_FOUND');return fetchBytes(PREFIX+'download/'+tags[0].tag_name+'/manifest.json',p.LIMITS.json,{allowedPrefixes:[PREFIX]});
}
module.exports={applyPublishedSources,publicManifest};
