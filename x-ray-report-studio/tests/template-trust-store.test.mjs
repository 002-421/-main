import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import p from '../electron/template-protocol.cjs';import {TemplateTrustStore} from '../electron/template-trust-store.cjs';import {TemplateCatalogStore} from '../electron/template-catalog-store.cjs';import {fixture} from './helpers/template-fixture.mjs';
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
