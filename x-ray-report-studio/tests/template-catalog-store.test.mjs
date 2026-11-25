import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fixture} from './helpers/template-fixture.mjs';
import p from '../electron/template-protocol.cjs';
import {TemplateCatalogStore} from '../electron/template-catalog-store.cjs';
const rejects=(fn,code)=>assert.rejects(fn,e=>e.code===code);
async function setup(t){const f=fixture(),directory=await mkdtemp(path.join(os.tmpdir(),'xrs-template-store-'));t.after(()=>rm(directory,{recursive:true,force:true}));let downloads=0;const options={directory,baseline:[f.template()],trust:f.root,channel:'test',appVersion:'0.4.84',now:f.now,fetchBytes:async(url,size)=>{downloads++;const file=f.files.get(url);if(!file)throw new Error('SYNTHETIC_NETWORK');assert.equal(file.length,size);return file;}};return {f,options,store:new TemplateCatalogStore(options),downloads:()=>downloads};}
async function update(store,raw){const plan=await store.check(raw);return store.install(plan.planId,true);}
test('two independent stores get identical signed version/hash/IDs; rollback on one preserves other and saved documents',async t=>{
 const a=await setup(t),b=await setup(t);b.options.trust=a.f.root;b.options.fetchBytes=a.options.fetchBytes;const second=new TemplateCatalogStore(b.options);
 const savedReport={text:'Исходный синтетический отчёт',version:'old'},snapshot=JSON.stringify(savedReport);const raw=a.f.manifest([a.f.template(undefined,'0.0.2','Изменённый синтетический текст')]);
 const first=await update(a.store,raw),other=await update(second,raw);assert.deepEqual(first.templates,other.templates);assert.equal(first.state.active,other.state.active);assert.equal(first.templates[0].templateVersion,'0.0.2');assert.equal(JSON.stringify(savedReport),snapshot);
 await a.store.rollback(true);assert.deepEqual((await a.store.load()).templates,[]);assert.equal((await second.load()).templates[0].templateVersion,'0.0.2');assert.equal(JSON.stringify(savedReport),snapshot);
 const again=await update(a.store,raw);assert.equal(again.templates[0].templateVersion,'0.0.2');
});
test('check alone never changes catalog; explicit consent, expiring plan and stale plan are enforced',async t=>{
 const {f,store}=await setup(t),raw=f.manifest([f.template(undefined,'0.0.2')]);const plan=await store.check(raw);assert.deepEqual((await store.load()).templates,[]);await rejects(()=>store.install(plan.planId,false),'CONFIRMATION_REQUIRED');assert.equal((await store.state()).sequence,0);
 await update(store,raw);await rejects(()=>store.install(plan.planId,true),'PLAN_EXPIRED');assert.equal((await store.check(raw)).upToDate,true);
});
test('eight-template update is one atomic generation; repeat check and cached packages do not duplicate data',async t=>{
 const {f,store,downloads}=await setup(t);const templates=Array.from({length:8},(_,i)=>f.template('synthetic-'+i,'0.0.1'));const actions=Object.fromEntries(templates.map(t=>[t.id,'add']));const raw=f.manifest(templates,1,'test',actions);const state=await update(store,raw);assert.equal(state.templates.length,8);assert.equal(downloads(),8);assert.equal((await store.check(raw)).upToDate,true);assert.equal(downloads(),8);
 await store.rollback(true);await update(store,raw);assert.equal(downloads(),8);
});
test('all bad downloads leave previous catalog active and report safe codes',async t=>{
 const {f,store}=await setup(t);await update(store,f.manifest([f.template(undefined,'0.0.2')]));const old=(await store.state()).active;
 const raw=f.manifest([f.template(undefined,'0.0.3')],2),m=p.parse(raw).signed;f.files.set(m.packages[0].url,Buffer.from('corrupt'));await assert.rejects(()=>update(store,raw));assert.equal((await store.load()).state.active,old);
 store.fetchBytes=async()=>{throw new Error('SYNTHETIC_NETWORK')};await assert.rejects(()=>update(store,raw),/SYNTHETIC_NETWORK/);assert.equal((await store.load()).state.active,old);
});
test('wrong signatures, incompatible XRS and replay/equivocation do not write catalog',async t=>{
 const {f,store}=await setup(t),raw=f.manifest([f.template(undefined,'0.0.2')]);await update(store,raw);const old=(await store.state()).active;
 const auth=p.parse(raw);auth.signed.catalogVersion='1.0.99';await rejects(()=>store.check(p.bytes(auth)),'SIGNATURE');
 const newer=f.manifest([f.template(undefined,'0.0.3')],2);await update(store,newer);await rejects(()=>store.check(raw),'REPLAY');
 const conflicting=p.parse(newer).signed;conflicting.packages[0].summary='Другой выпуск с тем же номером';await rejects(()=>store.check(p.bytes(p.envelope(conflicting,[f.key]))),'EQUIVOCATION');
 const incompatible=p.parse(f.manifest([f.template(undefined,'0.0.4')],3)).signed;incompatible.minimumXrsVersion='0.5.0';await rejects(()=>store.check(p.bytes(p.envelope(incompatible,[f.key]))),'XRS_VERSION_REQUIRED');assert.notEqual((await store.state()).active,old);
});
test('field loss, same-version content change and omitted previous template are blocked before activation',async t=>{
 const {f,store}=await setup(t);await update(store,f.manifest([f.template(undefined,'0.0.2')]));const old=(await store.state()).active;
 const bad=f.template(undefined,'0.0.3');bad.doc.content[0].content.shift();await rejects(()=>update(store,f.manifest([bad],2)),'SERVICE_FIELDS');assert.equal((await store.load()).state.active,old);
 await rejects(()=>update(store,f.manifest([f.template(undefined,'0.0.2','Изменение без повышения версии')],2)),'VERSION_EQUIVOCATION');
 await rejects(()=>update(store,f.manifest([],2)),'MISSING_CATALOG_ENTRY');assert.equal((await store.load()).state.active,old);
});
test('new embedded version wins over an older signed overlay; incompatible equal version is rejected',async t=>{
 const {f,options}=await setup(t),store=new TemplateCatalogStore({...options,baseline:[f.template(undefined,'0.0.4')]});
 const result=await update(store,f.manifest([f.template(undefined,'0.0.2')]));assert.deepEqual(result.templates,[]);
 await rejects(()=>update(store,f.manifest([f.template(undefined,'0.0.4','Different')],2)),'VERSION_EQUIVOCATION');
});
test('multiple prior catalogs remain readable; rollback preserves high-water replay protection and native IDs',async t=>{
 const {f,store}=await setup(t);const first=f.manifest([f.template(undefined,'0.0.2')]);for(let i=1;i<=4;i++)await update(store,i===1?first:f.manifest([f.template(undefined,'0.0.'+(i+1))],i));
 const s=await store.state();assert.ok(s.previous.length>=2);for(const id of s.previous)await store.generation(id);await store.rollback(true);await store.rollback(true);assert.equal((await store.load()).templates[0].templateVersion,'0.0.3');assert.equal((await store.state()).sequence,4);await rejects(()=>store.check(first),'REPLAY');
});
test('faults before activation leave old state; after activation new state is complete on restart',async t=>{
 for(const stage of ['package-verified','generation-verified','before-activation','after-activation']){
 const {f,store,options}=await setup(t);await update(store,f.manifest([f.template(undefined,'0.0.2')]));const old=(await store.state()).active;store.fault=async actual=>{if(actual===stage)throw new Error('SYNTHETIC_POWER_FAILURE')};await assert.rejects(()=>update(store,f.manifest([f.template(undefined,'0.0.3')],2)),/POWER_FAILURE/);
 const restarted=new TemplateCatalogStore(options),result=await restarted.load();if(stage==='after-activation')assert.equal(result.templates[0].templateVersion,'0.0.3');else assert.equal(result.state.active,old);
 }
});
test('concurrent writer is rejected; no workspace or profile files are ever written by store',async t=>{
 const {f,store,options}=await setup(t);let release;const held=new Promise(r=>release=r),entered=new Promise(resolve=>{store.fault=async stage=>{if(stage==='package-verified'){resolve();await held;}}});
 const operation=update(store,f.manifest([f.template(undefined,'0.0.2')]));await entered;
 const other=new TemplateCatalogStore(options);await rejects(()=>other.rollback(true),'BUSY');release();await operation;
 const names=await import('node:fs/promises').then(fs=>fs.readdir(options.directory));assert.ok(names.every(n=>['locks','packages','generations','state.json','state-before.json'].includes(n)));
});
test('without publisher trust there is no network or silent update',async t=>{
 const {options,f}=await setup(t);const store=new TemplateCatalogStore({...options,trust:null,fetchBytes:async()=>assert.fail('must not download')});assert.deepEqual((await store.load()).templates,[]);await rejects(()=>store.check(f.manifest([f.template()])),'TRUST_NOT_CONFIGURED');
});
test('new template IDs remain resolvable but retired after rollback and cold restart',async t=>{
 const {f,store,options}=await setup(t),item=f.template('new-test-template','0.0.1');await update(store,f.manifest([item],1,'test',{[item.id]:'add'}));await store.rollback(true);
 const restarted=await new TemplateCatalogStore(options).load();assert.equal(restarted.templates[0].id,item.id);assert.equal(restarted.templates[0].retired,true);assert.deepEqual(p.structure(restarted.templates[0].doc),p.structure(item.doc));
});
test('explicit signed removal retains native contract and is reversible',async t=>{
 const {f,store}=await setup(t);await update(store,f.manifest([f.template(undefined,'0.0.2')]));const removed={...f.template(undefined,'0.0.3'),retired:true};const result=await update(store,f.manifest([removed],2,'test',{[removed.id]:'remove'}));assert.equal(result.templates[0].retired,true);await store.rollback(true);assert.equal((await store.load()).templates[0].retired,undefined);
});
test('real process exit at each commit boundary recovers complete generation and stale writer lease',async t=>{
 const {spawnSync}=await import('node:child_process');for(const crashAt of ['package-verified','generation-verified','before-activation','after-activation']){
 const {f,store,options}=await setup(t);await update(store,f.manifest([f.template(undefined,'0.0.2')]));const old=(await store.state()).active,raw=f.manifest([f.template(undefined,'0.0.3')],2),fixtures=path.join(options.directory,'synthetic-fixtures');await mkdir(fixtures);const entry=p.parse(raw).signed.packages[0];await writeFile(path.join(fixtures,p.sha256(Buffer.from(entry.url))+'.zip'),f.files.get(entry.url));const manifest=path.join(fixtures,'manifest.json');await writeFile(manifest,raw);const config=path.join(fixtures,'config.json');await writeFile(config,JSON.stringify({directory:options.directory,baseline:options.baseline,trust:f.root,channel:'test',appVersion:'0.4.84',fixtures,manifest,crashAt}));
 const child=spawnSync(process.execPath,['tests/helpers/template-crash-worker.cjs',config],{encoding:'utf8',timeout:20000});assert.equal(child.status,73,child.stderr);const restarted=new TemplateCatalogStore(options),loaded=await restarted.load();if(crashAt==='after-activation')assert.equal(loaded.templates[0].templateVersion,'0.0.3');else assert.equal(loaded.state.active,old);await update(restarted,f.manifest([f.template(undefined,'0.0.4')],3));assert.equal((await restarted.load()).templates[0].templateVersion,'0.0.4');
 }
});
test('after an app update an equal-version embedded template takes precedence without losing unrelated downloaded identities',async t=>{
 const {f,store,options}=await setup(t),added=f.template('introduced-by-catalog','0.0.1');await update(store,f.manifest([f.template(undefined,'0.0.2'),added],1,'test',{[added.id]:'add'}));
 const nextBase=f.template(undefined,'0.0.2','New app embedded formatting');const upgraded=await new TemplateCatalogStore({...options,baseline:[nextBase]}).load();assert.ok(!upgraded.templates.some(row=>row.id===nextBase.id));assert.ok(upgraded.templates.some(row=>row.id===added.id&&!row.retired));
});
