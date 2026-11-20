import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const {CURRENT_DATA_SCHEMA,ensureDataSchema,writeJsonAtomic,canRollback}=require('../electron/install-state.cjs');

test('install metadata uses atomic replacement and records the stable data schema',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'xrs-install-state-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.join(root,'profile','install-state.json');
 const state=await ensureDataSchema(file);
 assert.equal(state.schemaVersion,CURRENT_DATA_SCHEMA);
 await writeJsonAtomic(file,{version:'0.4.54'});
 assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),{version:'0.4.54'});
 assert.deepEqual(await fs.readdir(path.dirname(file)),['install-state.json']);
});

test('manual rollback is available only when the previous install supports the current data schema',()=>{
 const currentRoot=path.resolve('/safe/App_0.4.54');
 const installState={status:'stable',current:{version:'0.4.54',root:currentRoot},previous:{version:'0.4.53',root:'/safe/App_0.4.53',executable:'/safe/App_0.4.53/X-ray Report Studio.exe',dataSchemaVersion:1}};
 assert.equal(canRollback({installState,dataState:{schemaVersion:1},currentRoot}).available,true);
 assert.equal(canRollback({installState:{...installState,status:'pending-first-start'},dataState:{schemaVersion:1},currentRoot}).available,false);
 const incompatible=canRollback({installState,dataState:{schemaVersion:2},currentRoot});
 assert.equal(incompatible.available,false);
 assert.match(incompatible.reason,/Формат данных/);
 assert.equal(canRollback({installState,dataState:{schemaVersion:1},currentRoot:'/other/App'}).available,false);
});

test('corrupt data compatibility metadata blocks rollback',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'xrs-schema-corrupt-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.join(root,'data-schema.json');await fs.writeFile(file,'{');
 await assert.rejects(ensureDataSchema(file),/повреждён/);
});
