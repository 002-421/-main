import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
import p from '../electron/template-protocol.cjs';import {TemplateAdmin} from '../electron/template-admin.cjs';import {createTemplatePublicationService} from '../electron/template-publication-service.cjs';import {createPublisherBridge,verifyComponent} from '../electron/template-publisher-bridge.cjs';import {fixture} from './helpers/template-fixture.mjs';
async function setup(t){const directory=await mkdtemp(path.join(os.tmpdir(),'xrs-publication-service-'));t.after(()=>rm(directory,{recursive:true,force:true}));const f=fixture(),before=f.template(),after=f.template(undefined,'0.0.2','Синтетическая редакция. Размер 0,0 и 0,0 см.');const admin=new TemplateAdmin({directory:path.join(directory,'admin'),baseline:[before]});await admin.setup('135790','135790');const session=await admin.unlock('135790',1);const draft=await admin.draft(session.token,1,{template:after,baseVersion:before.templateVersion,baseSha256:p.sha256(p.bytes(before)),summary:'SYNTHETIC ONLY',medicalApproval:{approved:true,reference:'SYNTHETIC ONLY'},channel:'test'});let verified=false;const calls=[];
 const bridge={call:async command=>{calls.push(command.operation);switch(command.operation){case 'authorize':return {status:'authorized',publisher:{login:'002-421',id:210672295}};case 'inspect':return {status:'inspected',version:'0.0.0',sequence:0,manifestSha256:null};case 'stage':return {status:'prepared',requestId:command.request.requestId,hash:p.sha256(p.bytes(command.request)),commit:'a'.repeat(40)};case 'dispatch':return {status:'submitted'};case 'status':return {status:'workflow-succeeded',runId:99};case 'verify':if(!verified)p.fail('SIGNATURE');return {status:'published',requestId:command.staged.requestId,channel:'test',catalogVersion:'1.0.0',manifestSha256:'b'.repeat(64),publishedAt:new Date().toISOString()};case 'cleanup':return {status:'cleaned'};default:throw Error('UNEXPECTED_COMMAND');}}};
 const options={directory:path.join(directory,'operations'),bridge,admin,source:{enabled:true,root:f.root,publisher:{enabled:true,stableEnabled:false}}};return {f,admin,session,draft,calls,options,service:createTemplatePublicationService(options),setVerified:()=>{verified=true;}};
}
test('real PIN/Draft gate, explicit snapshot consent and verified receipt control publication status across restart',async t=>{
 const s=await setup(t);await assert.rejects(()=>s.service.prepare(s.session.token,2,[s.draft.id],'test'),/ADMIN_SESSION_REQUIRED/);
 const plan=await s.service.prepare(s.session.token,1,[s.draft.id],'test');assert.equal(plan.status,'VALIDATED');assert.equal(plan.changes.length,1);
 await assert.rejects(()=>s.service.start(s.session.token,1,plan.id,{confirmed:true,channel:'test',catalogVersion:'9.9.9',sha256:plan.sha256}),/PUBLICATION_CONFIRMATION_REQUIRED/);
 assert.equal(s.calls.includes('stage'),false);
 const confirmation={confirmed:true,channel:'test',catalogVersion:plan.catalogVersion,sha256:plan.sha256};assert.equal((await s.service.start(s.session.token,1,plan.id,confirmation)).status,'SUBMITTED');
 assert.equal((await s.service.poll(s.session.token,1,plan.id)).status,'UNKNOWN_REQUIRES_RECONCILIATION','successful workflow is not proof of signed publication');
 const restarted=createTemplatePublicationService(s.options);s.setVerified();assert.equal((await restarted.poll(s.session.token,1,plan.id)).status,'PUBLISHED');assert.equal((await restarted.start(s.session.token,1,plan.id,confirmation)).status,'PUBLISHED');assert.equal(s.calls.filter(x=>x==='dispatch').length,1);
 assert.equal((await restarted.history(s.session.token,1))[0].status,'PUBLISHED');
});
test('Stable is blocked in privileged process before transmission; PIN alone cannot activate an unconfigured publisher',async t=>{
 const s=await setup(t);await assert.rejects(()=>s.service.prepare(s.session.token,1,[s.draft.id],'stable'),/STABLE_PUBLICATION_LOCKED/);assert.equal(s.calls.length,0);
 const service=createTemplatePublicationService({...s.options,source:{enabled:false,root:null}});assert.equal((await service.status()).canPublish,false);await assert.rejects(()=>service.prepare(s.session.token,1,[s.draft.id],'test'),/PUBLISHER_NOT_CONFIGURED/);assert.equal(s.calls.length,0);
});
test('cleanup failure retains the verified receipt and is retried safely after restart',async t=>{
 const s=await setup(t),call=s.options.bridge.call;let cleanup=0;
 s.options.bridge.call=async command=>{if(command.operation==='cleanup'&&cleanup++===0)throw Object.assign(Error('GITHUB_REQUEST_FAILED'),{code:'GITHUB_REQUEST_FAILED'});return call(command);};
 const plan=await s.service.prepare(s.session.token,1,[s.draft.id],'test');
 await s.service.start(s.session.token,1,plan.id,{confirmed:true,channel:'test',catalogVersion:plan.catalogVersion,sha256:plan.sha256});
 s.setVerified();assert.equal((await s.service.poll(s.session.token,1,plan.id)).status,'PUBLISHED');
 const restarted=createTemplatePublicationService(s.options);assert.equal((await restarted.poll(s.session.token,1,plan.id)).status,'PUBLISHED');
 assert.equal(cleanup,2);assert.equal(s.calls.filter(x=>x==='dispatch').length,1);
});
test('packaged administrative component is hash checked and exchanges bounded versioned stdio with the real child process',async()=>{
 const component=await verifyComponent();assert.equal(component.metadata.sourceTemplates,113);
 const input={protocolVersion:999,operationId:'00000000-0000-4000-8000-000000000001',command:{operation:'authorize'},context:{trust:null,appVersion:'0.4.86'}};
 const child=spawnSync(process.execPath,[component.file],{input:JSON.stringify(input),encoding:'utf8'});assert.equal(child.status,0);assert.equal(JSON.parse(child.stdout).error,'PUBLISHER_PROTOCOL_VERSION');assert.equal(child.stderr,'');
 const bridge=createPublisherBridge({context:async()=>({trust:null,roots:[],appVersion:'0.4.86'})});await assert.rejects(()=>bridge.call({operation:'stage',request:{},publicUploadConfirmed:false}),/PUBLIC_DATA_CONFIRMATION_REQUIRED/);
});
