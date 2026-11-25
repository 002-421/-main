'use strict';
// Local preparation only. No GitHub credentials, uploads, patient workspaces or
// signing keys are accepted by this server. It serves approved template sources.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const p=require('./lib/template-protocol.cjs');
const ROOT=path.resolve(__dirname,'..');
async function sources(){const dir=path.join(ROOT,'sources');const rows=[];for(const name of(await fs.readdir(dir)).sort()){if(!/^[A-Za-z0-9_.:-]+\.json$/.test(name))continue;const t=p.parse(await fs.readFile(path.join(dir,name)));if(t.id)rows.push(t);}return rows;}
function makeProposal(before,after,summary,reference,options={}){
 p.validateTemplate(before,options);p.validateTemplate(after,options);if(before.id!==after.id){p.check(options.allowNew===true,'NEW_TEMPLATE_CONFIRMATION_REQUIRED');}else p.continuity(before,after);p.check(before.id!==after.id||p.compare(after.templateVersion,before.templateVersion)>0,'VERSION_NOT_INCREASED');p.string(summary,2000);p.string(reference,200);p.check(summary.trim()&&reference.trim(),'APPROVAL_REQUIRED');
 p.check(p.canonical({...before,templateVersion:after.templateVersion})!==p.canonical(after),'NO_CONTENT_CHANGE');
 return {schemaVersion:1,type:'xrs-template-proposal',channel:options.channel??'stable',baseVersion:before.id===after.id?before.templateVersion:'0.0.0',baseSha256:before.id===after.id?p.sha256(p.bytes(before)):'0'.repeat(64),template:after,summary,medicalApproval:{approved:true,reference}};
}
async function start(){let rows=await sources();const channel=process.argv.includes('--test')?'test':'stable',baseline=p.parse(await fs.readFile(path.join(ROOT,'baseline.json')));let sourceStatus='Локальный исходный каталог. Публикация заново проверит исходную редакцию.';
 try{const root=p.parse(await fs.readFile(path.join(ROOT,'trust/root.json')));p.validateRoot(root);const {applyPublishedSources,publicManifest}=require('./current-sources.cjs');const current=await applyPublishedSources(await publicManifest(channel),root,channel,new Map(rows.map(t=>[t.id,t])),baseline);rows=[...current.sources.values()];sourceStatus='Проверенный опубликованный каталог '+current.manifest.catalogVersion;}catch(e){if(e.code!=='ENOENT'&&e.code!=='SOURCE_NOT_FOUND')throw e;}
const server=http.createServer(async(req,res)=>{
 try{const host=req.headers.host;if(!host||host!==`127.0.0.1:${server.address().port}`)return res.writeHead(403).end();
 const origin=req.headers.origin;if(origin&&origin!==`http://${host}`)return res.writeHead(403).end();
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
 if(req.method==='GET'&&req.url==='/api/status'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({channel,sourceStatus}));}
 if(req.method==='GET'&&req.url==='/api/sources'){res.setHeader('Content-Type','application/json; charset=utf-8');return res.end(p.bytes(rows));}
 if(req.method==='POST'&&req.url==='/api/proposal'){
 p.check(req.headers['content-type']==='application/json','CONTENT_TYPE');let total=0;const chunks=[];for await(const c of req){total+=c.length;p.check(total<=p.LIMITS.json,'SIZE');chunks.push(c);}const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));p.keys(input,['template','summary','reference','sourceId'],['template','summary','reference']);const before=rows.find(t=>t.id===(input.sourceId??input.template.id));p.check(before,'UNKNOWN_TEMPLATE');p.check(before.id===input.template.id||!rows.some(t=>t.id===input.template.id),'DUPLICATE_ID');const proposal=makeProposal(before,input.template,input.summary,input.reference,{allowedImages:baseline.allowedImages,channel,allowNew:Boolean(input.sourceId&&input.sourceId!==input.template.id)});res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition','attachment; filename="approved-template.xrsproposal"');return res.end(p.bytes(proposal));
 }
 const allowed={'/':'admin.html','/admin.js':'admin.js','/admin.css':'admin.css'};const file=allowed[req.url];if(req.method!=='GET'||!file)return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(await fs.readFile(path.join(ROOT,'admin',file)));
 }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.code??'PREPARATION_FAILED'}));}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));console.log(`Локальный редактор: http://127.0.0.1:${server.address().port}/`);console.log('Сервер доступен только на этом компьютере. Ctrl+C — завершить.');return server;}
if(require.main===module)start().catch(e=>{console.error(e.code??'ADMIN_START_FAILED');process.exitCode=1;});
module.exports={makeProposal,start};
