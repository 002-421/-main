import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import p from '../electron/template-protocol.cjs';import {TemplateTrustStore} from '../electron/template-trust-store.cjs';import {TemplateCatalogStore} from '../electron/template-catalog-store.cjs';import {fixture} from './helpers/template-fixture.mjs';
import {createTemplateUpdateService} from '../electron/template-update-service.cjs';
test('trusted root delivery survives restart, enforces old/new signatures, expiry, rollback and equivocation',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'xrs-root-chain-'));t.after(()=>rm(directory,{recursive:true,force:true}));const a=fixture(),b=fixture();const next={...b.root,version:2,revoked:[a.id]};const store=new TemplateTrustStore({directory,anchor:a.root,now:a.now});await store.load();
 const wire=envelopes=>p.bytes({schemaVersion:1,type:'xrs-template-root-chain',envelopes});
 await assert.rejects(()=>store.update(wire([p.envelope(next,[b.key])])),/SIGNATURE/);
 await store.update(wire([p.envelope(next,[a.key,b.key])]));assert.equal(store.root.version,2);assert.throws(()=>p.verify(p.envelope({safe:true},[a.key]),store.root,'test'),/SIGNATURE/);
 const restarted=new TemplateTrustStore({directory,anchor:a.root,now:a.now});await restarted.load();assert.equal(restarted.root.version,2);
 await assert.rejects(()=>restarted.update(wire([])),/ROOT_REPLAY|ROOT_EQUIVOCATION/);
 await assert.rejects(()=>restarted.update(wire([p.envelope({...next,expiresAt:'2020-01-01T00:00:00.000Z'},[a.key,b.key])])),/ROOT_EXPIRED|ROOT_EQUIVOCATION/);
});
test('revoked signer cannot supply a new catalog; accepted cached data stay readable offline after root rotation',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'xrs-root-cache-'));t.after(()=>rm(directory,{recursive:true,force:true}));const a=fixture(),b=fixture();const trust=new TemplateTrustStore({directory:path.join(directory,'trust'),anchor:a.root,now:a.now});await trust.load();
 const store=new TemplateCatalogStore({directory:path.join(directory,'catalog'),baseline:[a.template()],trust:a.root,channel:'test',appVersion:'0.4.86',now:a.now,historicalTrust:(auth,role)=>trust.historical(auth,role),fetchBytes:async url=>a.files.get(url)});
 const plan=await store.check(a.manifest([a.template(undefined,'0.0.2')]));await store.install(plan.planId,true);
 await trust.update(p.bytes({schemaVersion:1,type:'xrs-template-root-chain',envelopes:[p.envelope({...b.root,version:2,revoked:[a.id]},[a.key,b.key])]}));store.trust=trust.root;
 assert.equal((await store.load()).templates[0].templateVersion,'0.0.2');await assert.rejects(()=>store.check(a.manifest([a.template(undefined,'0.0.3')],2)),/SIGNATURE/);
});
test('concurrent root refresh cannot overwrite a newer accepted root with an older response',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'xrs-root-race-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const a=fixture(),b=fixture(),c=fixture(),store=new TemplateTrustStore({directory,anchor:a.root,now:a.now});await store.load();
 const second={...b.root,version:2},third={...c.root,version:3};const v2=p.envelope(second,[a.key,b.key]),v3=p.envelope(third,[b.key,c.key]);
 const wire=envelopes=>p.bytes({schemaVersion:1,type:'xrs-template-root-chain',envelopes});
 const results=await Promise.allSettled([store.update(wire([v2,v3])),store.update(wire([v2]))]);
 assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');assert.match(results[1].reason.code,/ROOT_REPLAY|ROOT_EQUIVOCATION/);
 const restarted=new TemplateTrustStore({directory,anchor:a.root,now:a.now});await restarted.load();assert.equal(restarted.root.version,3);
});
test('background root refresh waits until the pending signed installation completes',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'xrs-trust-install-'));t.after(()=>rm(directory,{recursive:true,force:true}));const f=fixture();
 const manifest=f.manifest([f.template(undefined,'0.0.2')]),prefix='https://example.invalid/releases/';let rootRequests=0,releaseDownload,downloadEntered;
 const entered=new Promise(resolve=>{downloadEntered=resolve;}),held=new Promise(resolve=>{releaseDownload=resolve;});
 const service=createTemplateUpdateService({userData:directory,appVersion:'0.4.86',baseline:{templates:[f.template()],allowedImages:[]},source:{enabled:true,channel:'test',root:f.root,manifestUrl:prefix+'manifest.json',rootUpdatesUrl:prefix+'root-chain.json',allowedPrefixes:[prefix]},fetchImpl:async url=>{
  if(url.endsWith('root-chain.json')){rootRequests++;return new Response(p.bytes({schemaVersion:1,type:'xrs-template-root-chain',envelopes:[]}));}
  if(url.endsWith('manifest.json'))return new Response(manifest);
  downloadEntered();await held;return new Response(f.files.get(url));
 }});
 const plan=await service.check(),installation=service.install(plan.planId,true);await entered;const background=service.check();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(rootRequests,1,'refresh cannot revoke/change the trust root midway through package verification and activation');releaseDownload();
 assert.equal((await installation).version,'1.0.1');assert.equal((await background).upToDate,true);assert.equal(rootRequests,2);
});
