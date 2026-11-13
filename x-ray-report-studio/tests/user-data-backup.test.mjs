import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const {createUserDataBackup,verifyUserDataBackup}=require('../electron/user-data-backup.cjs');

test('local update backup includes the Chromium Local Storage database holding report history plus settings and dictionaries',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'xrs-backup-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const data=path.join(root,'Roaming','MRI Report Studio'),shared=path.join(root,'Public','Documents','MRI Report Studio','dictionary.json'),runtime=path.join(root,'Desktop','App_0.4.54'),backups=path.join(root,'Roaming','X-ray Report Studio Backups');
 await fs.mkdir(path.join(data,'Local Storage','leveldb'),{recursive:true});await fs.mkdir(path.dirname(shared),{recursive:true});await fs.mkdir(runtime,{recursive:true});
 await fs.writeFile(path.join(data,'Local Storage','leveldb','000001.log'),'workspace templates settings stamps');
 await fs.writeFile(path.join(data,'Local Storage','leveldb','000002.ldb'),'synthetic per-report undo operation history');
 await fs.writeFile(path.join(data,'dictionary.json'),'["слово"]');await fs.writeFile(path.join(data,'export-folders.json'),'{"word":"C:\\\\Отчёты"}');
 await fs.writeFile(path.join(data,'logs','update-private.log'),'diagnostic log must not enter a backup of report content').catch(async()=>{await fs.mkdir(path.join(data,'logs'),{recursive:true});await fs.writeFile(path.join(data,'logs','update-private.log'),'diagnostic log must not enter a backup of report content');});
 await fs.writeFile(shared,'["общий"]');
 const result=await createUserDataBackup({userDataDir:data,sharedDictionaryFile:shared,backupRoot:backups,version:'0.4.54'});
 assert.ok(!result.directory.startsWith(runtime));
 assert.equal(await fs.readFile(path.join(result.directory,'data','profile','Local Storage','leveldb','000001.log'),'utf8'),'workspace templates settings stamps');
 assert.equal(await fs.readFile(path.join(result.directory,'data','profile','Local Storage','leveldb','000002.ldb'),'utf8'),'synthetic per-report undo operation history');
 assert.equal(await fs.readFile(path.join(result.directory,'data','profile','dictionary.json'),'utf8'),'["слово"]');
 assert.equal(await fs.readFile(path.join(result.directory,'data','shared-dictionary.json'),'utf8'),'["общий"]');
 await assert.rejects(fs.stat(path.join(result.directory,'data','profile','logs')),{code:'ENOENT'});
 assert.deepEqual(await verifyUserDataBackup(result.directory),{files:5,bytes:Buffer.byteLength('workspace templates settings stamps')+Buffer.byteLength('synthetic per-report undo operation history')+Buffer.byteLength('["слово"]')+Buffer.byteLength('["общий"]')+Buffer.byteLength('{"word":"C:\\\\Отчёты"}'),excludedFiles:0});
});

test('backup records and excludes only Chromium LevelDB LOCK while preserving database files',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'xrs-leveldb-lock-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const profile=path.join(root,'Профиль пользователя','MRI Report Studio'),backups=path.join(root,'Резервные копии');
 const leveldb=path.join(profile,'Session Data','Local Storage','leveldb');
 await fs.mkdir(leveldb,{recursive:true});
 await fs.writeFile(path.join(leveldb,'LOCK'),'synthetic transient chromium lock');
 await fs.writeFile(path.join(leveldb,'000003.log'),'synthetic workspace database records');
 await fs.writeFile(path.join(leveldb,'CURRENT'),'MANIFEST-000001');
 await fs.mkdir(path.join(profile,'custom'),{recursive:true});
 await fs.writeFile(path.join(profile,'custom','LOCK'),'not a LevelDB lock; preserve it');

 const backup=await createUserDataBackup({userDataDir:profile,backupRoot:backups,version:'0.4.54'});
 const data=path.join(backup.directory,'data','profile');
 await assert.rejects(fs.stat(path.join(data,'Session Data','Local Storage','leveldb','LOCK')),{code:'ENOENT'});
 assert.equal(await fs.readFile(path.join(data,'Session Data','Local Storage','leveldb','000003.log'),'utf8'),'synthetic workspace database records');
 assert.equal(await fs.readFile(path.join(data,'Session Data','Local Storage','leveldb','CURRENT'),'utf8'),'MANIFEST-000001');
 assert.equal(await fs.readFile(path.join(data,'custom','LOCK'),'utf8'),'not a LevelDB lock; preserve it');
 const manifest=JSON.parse(await fs.readFile(path.join(backup.directory,'manifest.json'),'utf8'));
 assert.deepEqual(manifest.excludedFiles,[{path:'profile/Session Data/Local Storage/leveldb/LOCK',reason:'ephemeral-leveldb-lock'}]);
 assert.deepEqual(await verifyUserDataBackup(backup.directory),{files:3,bytes:Buffer.byteLength('synthetic workspace database records')+Buffer.byteLength('MANIFEST-000001')+Buffer.byteLength('not a LevelDB lock; preserve it'),excludedFiles:1});

 // Verify that an ordinary restore of the backed-up data preserves database contents;
 // the omitted lock is recreated by LevelDB when it opens the restored directory.
 const restored=path.join(root,'restored-profile');
 await fs.cp(data,restored,{recursive:true});
 assert.equal(await fs.readFile(path.join(restored,'Session Data','Local Storage','leveldb','000003.log'),'utf8'),'synthetic workspace database records');
 await assert.rejects(fs.stat(path.join(restored,'Session Data','Local Storage','leveldb','LOCK')),{code:'ENOENT'});

 manifest.excludedFiles[0].reason='unverified-skip';
 await fs.writeFile(path.join(backup.directory,'manifest.json'),JSON.stringify(manifest));
 await assert.rejects(verifyUserDataBackup(backup.directory),/недопустимое исключение/);
});

test('backup failure preserves earlier usable backup and removes only the incomplete staging directory',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'xrs-backup-failure-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const data=path.join(root,'profile'),backups=path.join(root,'stable-backups');await fs.mkdir(data);await fs.mkdir(backups);
 const previous=path.join(backups,'previous');await fs.mkdir(previous);await fs.writeFile(path.join(previous,'keep.txt'),'usable');
 await fs.symlink(path.join(root,'outside'),path.join(data,'unsafe-link'));
 await assert.rejects(createUserDataBackup({userDataDir:data,backupRoot:backups,id:'failed'}),/символическая ссылка/);
 assert.equal(await fs.readFile(path.join(previous,'keep.txt'),'utf8'),'usable');
 assert.deepEqual((await fs.readdir(backups)).sort(),['previous']);
});

test('backup destination cannot be inside the profile or installation directory',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'xrs-backup-boundary-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const data=path.join(root,'profile');await fs.mkdir(data);
 await assert.rejects(createUserDataBackup({userDataDir:data,backupRoot:path.join(data,'backups')}),/отдельным от профиля/);
});

test('backup preserves 1, 5 and 12 open synthetic reports and template state',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'xrs-report-counts-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const count of [1,5,12]){
  const profile=path.join(root,`profile-${count}`),backups=path.join(root,`backups-${count}`),store=path.join(profile,'Local Storage','leveldb');
  await fs.mkdir(store,{recursive:true});
  const workspace={activeId:`synthetic-${count}-1`,reports:Array.from({length:count},(_,i)=>({id:`synthetic-${count}-${i+1}`,templateId:`template-${i+1}`,dirty:i%2===0,doc:{type:'doc',content:[{type:'text',text:`SYNTHETIC REPORT ${count}-${i+1}`} ]}}))};
  await fs.writeFile(path.join(store,'workspace-state.ldb'),JSON.stringify({workspace,templates:[{id:'custom-template',name:'SYNTHETIC CUSTOM TEMPLATE'}],settings:{doctorStamps:{SyntheticDoctor:'data:image/png;base64,AA=='}}}));
  const backup=await createUserDataBackup({userDataDir:profile,backupRoot:backups,version:'0.4.53'});
  const restored=JSON.parse(await fs.readFile(path.join(backup.directory,'data','profile','Local Storage','leveldb','workspace-state.ldb'),'utf8'));
  assert.equal(restored.workspace.reports.length,count);
  assert.equal(restored.workspace.activeId,workspace.activeId);
  assert.equal(restored.templates[0].name,'SYNTHETIC CUSTOM TEMPLATE');
  assert.equal(restored.settings.doctorStamps.SyntheticDoctor,'data:image/png;base64,AA==');
  assert.equal((await verifyUserDataBackup(backup.directory)).files,1);
 }
});

test('backup verification rejects changed files and symlinks without touching source data',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'xrs-backup-integrity-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const profile=path.join(root,'profile'),backups=path.join(root,'backups');await fs.mkdir(profile);await fs.writeFile(path.join(profile,'settings.json'),'{}');
 const backup=await createUserDataBackup({userDataDir:profile,backupRoot:backups});
 const saved=path.join(backup.directory,'data','profile','settings.json');await fs.writeFile(saved,'{"changed":true}');
 await assert.rejects(verifyUserDataBackup(backup.directory),/целостности/);
 await fs.unlink(saved);await fs.symlink(path.join(root,'outside'),saved);
 await assert.rejects(verifyUserDataBackup(backup.directory),/символическую ссылку/);
 assert.equal(await fs.readFile(path.join(profile,'settings.json'),'utf8'),'{}');
});

test('backup location rejects symlinks and any path inside a removable application version',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'xrs-backup-location-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const profile=path.join(root,'profile'),allowed=path.join(root,'Roaming'),app=path.join(root,'Desktop','App_0.4.54');
 await fs.mkdir(profile,{recursive:true});await fs.mkdir(allowed,{recursive:true});await fs.mkdir(app,{recursive:true});
 await assert.rejects(createUserDataBackup({userDataDir:profile,backupRoot:path.join(app,'Backups'),forbiddenRoots:[app]}),/удаляемой версией/);
 const link=path.join(allowed,'X-ray Report Studio Backups');await fs.symlink(app,link,'dir');
 await assert.rejects(createUserDataBackup({userDataDir:profile,backupRoot:link,allowedBackupRoot:allowed}),/небезопасный тип/);
 assert.deepEqual(await fs.readdir(app),[]);
});
