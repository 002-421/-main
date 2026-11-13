import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const {CURRENT_DATA_SCHEMA,ensureDataSchema,writeJsonAtomic,canRollback}=require('../electron/install-state.cjs');
const {CURRENT_DATA_CONTRACT}=require('../electron/data-compatibility.cjs');
const {applicationSupportsDataContract}=require('../electron/data-compatibility.cjs');

test('0.4.54 keeps the existing profile contract because Undo history is optional and stored separately',()=>{
 assert.equal(applicationSupportsDataContract('0.4.53',CURRENT_DATA_CONTRACT,1),true);
 assert.equal(applicationSupportsDataContract('0.4.54',CURRENT_DATA_CONTRACT,1),true);
 assert.equal(applicationSupportsDataContract('0.4.55',CURRENT_DATA_CONTRACT,1),true,'the local upgrade uses the same persisted contract');
 assert.equal(applicationSupportsDataContract('0.4.53','xrs-local-undo-history-v1',1),false);
});

test('install metadata uses atomic replacement and records the stable data schema',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'xrs-install-state-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.join(root,'profile','install-state.json');
 const state=await ensureDataSchema(file);
 assert.equal(state.schemaVersion,CURRENT_DATA_SCHEMA);
 assert.equal(state.dataContract,CURRENT_DATA_CONTRACT);
 await writeJsonAtomic(file,{version:'0.4.54'});
 assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),{version:'0.4.54'});
 assert.deepEqual(await fs.readdir(path.dirname(file)),['install-state.json']);
});

test('manual rollback is available only when the previous install supports the current data schema',()=>{
 const currentRoot=path.resolve('/safe/App_0.4.54');
 const installState={status:'stable',current:{version:'0.4.54',root:currentRoot},previous:{version:'0.4.53',root:'/safe/App_0.4.53',executable:'/safe/App_0.4.53/X-ray Report Studio.exe',dataSchemaVersion:1}};
 const compatibleData={schemaVersion:1,dataContract:CURRENT_DATA_CONTRACT};
 assert.equal(canRollback({installState,dataState:compatibleData,currentRoot}).available,true);
 assert.equal(canRollback({installState:{...installState,status:'pending-first-start'},dataState:compatibleData,currentRoot}).available,false);
 const incompatible=canRollback({installState,dataState:{schemaVersion:2,dataContract:CURRENT_DATA_CONTRACT},currentRoot});
 assert.equal(incompatible.available,false);
 assert.match(incompatible.reason,/Формат данных/);
 assert.equal(canRollback({installState,dataState:{schemaVersion:1},currentRoot:'/other/App'}).available,false);
 assert.equal(canRollback({installState,dataState:{...compatibleData,dataContract:'xrs-local-data-v2'},currentRoot}).available,false,'matching schema numbers do not prove reader compatibility');
 assert.equal(canRollback({installState:{...installState,previous:{...installState.previous,version:'0.4.52'}},dataState:compatibleData,currentRoot}).available,false,'unknown application versions are not assumed compatible');
});

test('corrupt data compatibility metadata blocks rollback',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'xrs-schema-corrupt-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.join(root,'data-schema.json');await fs.writeFile(file,'{');
 await assert.rejects(ensureDataSchema(file),/повреждён/);
});
