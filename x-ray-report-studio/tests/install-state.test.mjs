import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const {
 CURRENT_DATA_SCHEMA,ensureDataSchema,writeJsonAtomic,canRollback,
 getPendingFirstStartAction,isInstallConfirmed,recordFirstStartAttempt,confirmFirstStart,
}=require('../electron/install-state.cjs');
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

test('sequential 0.4.56 → 0.4.57 → 0.4.58 requires the actual candidate runtime before Stable confirmation',()=>{
 const root=path.resolve('/synthetic/X-ray Report Studio');
 const app=(version)=>path.join(root,version==='0.4.57'?'App_0.4.57-366a1757':`App_${version}`);
 const executable=(version)=>path.join(app(version),'X-ray Report Studio.exe');
 let state={status:'stable',current:{version:'0.4.56',root:app('0.4.56'),executable:executable('0.4.56'),dataSchemaVersion:1}};

 state={status:'pending-first-start',launchAttempts:0,current:{version:'0.4.57',root:app('0.4.57'),executable:executable('0.4.57'),dataSchemaVersion:1},previous:state.current};
 assert.equal(getPendingFirstStartAction(state,app('0.4.56'),executable('0.4.56'),'0.4.56'),'handoff-to-candidate');
 assert.equal(isInstallConfirmed(state,app('0.4.56'),executable('0.4.56'),'0.4.56'),false);
 assert.equal(state.launchAttempts,0,'the previous Electron runtime cannot consume the candidate launch attempt');
 assert.equal(getPendingFirstStartAction(state,app('0.4.57'),executable('0.4.57'),'0.4.57'),'candidate');
 state=recordFirstStartAttempt(state,app('0.4.57'),executable('0.4.57'),'0.4.57','2026-01-01T00:00:00.000Z');
 assert.equal(state.launchAttempts,1);
 state=confirmFirstStart(state,app('0.4.57'),executable('0.4.57'),'0.4.57','2026-01-01T00:00:01.000Z');
 assert.equal(state.status,'stable');
 assert.equal(isInstallConfirmed(state,app('0.4.57'),executable('0.4.57'),'0.4.57'),true);

 state={status:'pending-first-start',launchAttempts:0,current:{version:'0.4.58',root:app('0.4.58'),executable:executable('0.4.58'),dataSchemaVersion:1},previous:state.current};
 assert.equal(getPendingFirstStartAction(state,app('0.4.57'),executable('0.4.57'),'0.4.57'),'handoff-to-candidate');
 assert.equal(isInstallConfirmed(state,app('0.4.57'),executable('0.4.57'),'0.4.57'),false,'the old runtime cannot install a subsequent release');
 state=recordFirstStartAttempt(state,app('0.4.58'),executable('0.4.58'),'0.4.58','2026-01-01T00:00:02.000Z');
 state=confirmFirstStart(state,app('0.4.58'),executable('0.4.58'),'0.4.58','2026-01-01T00:00:03.000Z');
 assert.equal(isInstallConfirmed(state,app('0.4.58'),executable('0.4.58'),'0.4.58'),true);
});

test('pending first-start cannot be confirmed from an unrelated executable or malformed install path',()=>{
 const root=path.resolve('/synthetic');
 const state={status:'pending-first-start',launchAttempts:0,current:{version:'0.4.57',root:path.join(root,'App_0.4.57'),executable:path.join(root,'App_0.4.57','X-ray Report Studio.exe')},previous:{root:path.join(root,'App_0.4.56')}};
 assert.equal(getPendingFirstStartAction(state,path.join(root,'App_0.4.55')),'blocked');
 assert.throws(()=>recordFirstStartAttempt(state,path.join(root,'App_0.4.55')),/фактическим запуском|Первый запуск/);
 assert.throws(()=>confirmFirstStart(state,path.join(root,'App_0.4.56')),/подтвердить/);
 assert.equal(isInstallConfirmed(state,path.join(root,'App_0.4.55')),false);
 assert.equal(getPendingFirstStartAction(state,state.current.root,path.join(state.current.root,'X-ray Report Studio.exe'),'0.4.56'),'blocked','the path alone cannot confirm a different executable version');
 assert.equal(getPendingFirstStartAction(state,state.current.root,path.join(state.current.root,'different.exe'),'0.4.57'),'blocked','the folder alone cannot confirm a different executable');
});
