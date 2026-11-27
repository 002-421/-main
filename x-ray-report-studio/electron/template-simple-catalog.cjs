'use strict';
// HTTPS origin + SHA-256 is the owner-approved catalog trust model. No signatures.
const p=require('./template-protocol.cjs');
const REPOSITORY='002-421/XRS-Templates',OWNER_ID=210672295,PREFIX=`https://github.com/${REPOSITORY}/releases/download/`;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,HASH=/^[a-f0-9]{64}$/;
const tag=version=>'xrs-templates-v'+p.version(version),archiveUrl=version=>PREFIX+tag(version)+'/catalog.xrszip';
function contentHash(templates){return p.sha256(p.bytes([...templates].sort((a,b)=>a.id.localeCompare(b.id,'en'))));}
function validateTemplates(templates,options={}){
 p.check(Array.isArray(templates)&&templates.length>0&&templates.length<=500,'CATALOG_COUNT');const ids=new Set();
 for(const row of templates){p.validateTemplate(row,options);p.check(!ids.has(row.id),'DUPLICATE_ID');ids.add(row.id);}return templates;
}
function makeArchive(templates,catalogVersion,options){validateTemplates(templates,options);return p.zip({'catalog.json':p.bytes({schemaVersion:1,type:'xrs-https-catalog-data',catalogVersion:p.version(catalogVersion),templates:[...templates].sort((a,b)=>a.id.localeCompare(b.id,'en'))})},{catalog:true});}
function entry(row){
 p.keys(row,['templateId','templateVersion','action','url','sha256','size','summary','templateSha256','templateSize','archiveVersion']);p.string(row.templateId,120);p.version(row.templateVersion);p.version(row.archiveVersion);p.string(row.summary,2000);
 p.check(['add','update','remove'].includes(row.action)&&row.url===archiveUrl(row.archiveVersion)&&HASH.test(row.sha256)&&HASH.test(row.templateSha256)&&Number.isSafeInteger(row.templateSize)&&row.templateSize>0&&row.templateSize<=p.LIMITS.json&&Number.isSafeInteger(row.size)&&row.size>0&&row.size<=p.LIMITS.archive,'CATALOG_ENTRY');return row;
}
function manifest(raw,{appVersion='0.4.86',channel='stable',now=Date.now(),expiry=true}={}){
 const m=p.parse(raw);p.keys(m,['schemaVersion','type','catalogId','catalogVersion','sequence','channel','minimumXrsVersion','publishedAt','publisher','publicationId','previousVersion','previousManifestSha256','contentSha256','archive','packages','revisions']);
 p.check(m.schemaVersion===3&&m.type==='xrs-https-template-catalog'&&m.catalogId==='xrs-medical-templates'&&m.channel===channel&&channel==='stable','CATALOG_SCHEMA');p.version(m.catalogVersion);p.version(m.minimumXrsVersion);p.version(m.previousVersion);
 p.check(p.compare(appVersion,m.minimumXrsVersion)>=0,'XRS_VERSION_REQUIRED');p.check(Number.isSafeInteger(m.sequence)&&m.sequence>=1&&UUID.test(m.publicationId)&&HASH.test(m.contentSha256),'CATALOG_SCHEMA');
 p.check(typeof m.publishedAt==='string'&&Number.isFinite(Date.parse(m.publishedAt))&&(!expiry||Date.parse(m.publishedAt)<=now+300000),'DATE');
 p.keys(m.publisher,['login','id','repository']);p.check(m.publisher.login==='002-421'&&m.publisher.id===OWNER_ID&&m.publisher.repository===REPOSITORY,'PUBLISHER_IDENTITY');
 p.check(m.sequence===1?m.previousVersion==='0.0.0'&&m.previousManifestSha256===null:HASH.test(m.previousManifestSha256)&&p.compare(m.catalogVersion,m.previousVersion)>0,'CATALOG_BASE');
 p.keys(m.archive,['url','sha256','size']);p.check(m.archive.url===archiveUrl(m.catalogVersion)&&HASH.test(m.archive.sha256)&&Number.isSafeInteger(m.archive.size)&&m.archive.size>0&&m.archive.size<=p.LIMITS.archive,'CATALOG_ARCHIVE');
 p.check(Array.isArray(m.packages)&&m.packages.length>0&&m.packages.length<=500&&Array.isArray(m.revisions)&&m.revisions.length<=5000,'CATALOG_COUNT');
 const ids=new Set(),revisions=new Map();for(const row of m.revisions){p.keys(row,['templateId','templateVersion','action','url','sha256','size','summary','templateSha256','templateSize','archiveVersion','status','publishedAt','approvedBy']);const {status,publishedAt,approvedBy,...data}=row;entry(data);p.check(['Active','Archived','Revoked'].includes(status)&&typeof publishedAt==='string'&&Number.isFinite(Date.parse(publishedAt))&&approvedBy==='github:002-421','REVISION');const key=row.templateId+'@'+row.templateVersion;p.check(!revisions.has(key),'DUPLICATE_ID');revisions.set(key,row);}
 for(const row of m.packages){entry(row);p.check(!ids.has(row.templateId),'DUPLICATE_ID');ids.add(row.templateId);const found=revisions.get(row.templateId+'@'+row.templateVersion);p.check(found&&found.status===(row.action==='remove'?'Revoked':'Active'),'ACTIVE_BINDING');const {status,publishedAt,approvedBy,...data}=found;p.check(p.canonical(data)===p.canonical(row),'ACTIVE_BINDING');}
 p.check([...revisions.values()].filter(r=>r.status==='Active').every(r=>m.packages.some(e=>e.templateId===r.templateId&&e.templateVersion===r.templateVersion)),'ACTIVE_BINDING');return m;
}
function packageReader({allowedImages=[],appVersion='0.4.86'}={}){const cache=new Map();return (raw,row)=>{
 if(raw[0]===0x7b){p.check(raw.length===row.templateSize&&p.sha256(raw)===row.templateSha256,'PACKAGE_HASH');const t=p.parse(raw);p.validateTemplate(t,{allowedImages});p.check(t.id===row.templateId&&t.templateVersion===row.templateVersion&&Boolean(t.retired)===(row.action==='remove'),'PACKAGE_BINDING');p.check(p.compare(appVersion,t.minimumXrsVersion)>=0,'XRS_VERSION_REQUIRED');return t;}
 p.check(raw.length===row.size&&p.sha256(raw)===row.sha256,'PACKAGE_HASH');let data=cache.get(row.sha256);
 if(!data){const files=p.unzip(raw,{catalog:true});p.check(Object.keys(files).length===1&&files['catalog.json'],'PACKAGE_FILES');data=p.parse(files['catalog.json'],p.LIMITS.archive);p.keys(data,['schemaVersion','type','catalogVersion','templates']);p.check(data.schemaVersion===1&&data.type==='xrs-https-catalog-data','CATALOG_SCHEMA');p.version(data.catalogVersion);validateTemplates(data.templates,{allowedImages});p.check(data.templates.every(t=>p.compare(appVersion,t.minimumXrsVersion)>=0),'XRS_VERSION_REQUIRED');data={...data,byId:new Map(data.templates.map(t=>[t.id,t]))};cache.set(row.sha256,data);if(cache.size>3)cache.delete(cache.keys().next().value);}
 const template=data.byId.get(row.templateId);p.check(data.catalogVersion===row.archiveVersion&&template&&template.templateVersion===row.templateVersion&&p.sha256(p.bytes(template))===row.templateSha256&&p.bytes(template).length===row.templateSize&&Boolean(template.retired)===(row.action==='remove'),'PACKAGE_BINDING');return structuredClone(template);
};}
module.exports={REPOSITORY,OWNER_ID,PREFIX,UUID,HASH,tag,archiveUrl,contentHash,validateTemplates,makeArchive,manifest,packageReader};
