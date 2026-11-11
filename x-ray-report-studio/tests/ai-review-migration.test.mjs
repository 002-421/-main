import test from 'node:test';
import assert from 'node:assert/strict';
import { planManualMigration, createMigrationBackup, readMigrationBackup, migrationBackupKeys } from '../src/ai-review-migration.ts';

const p=text=>({type:'paragraph',content:[{type:'text',text}]});
const flat=()=>({type:'doc',content:[p('Пациент: Тестовый'),p('Описание: находка справа.'),p('Заключение: находка справа.'),p('Врач: Тестовый')]});
const storage=()=>{const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),key:index=>[...map.keys()][index]??null,get length(){return map.size},map};};

test('manual boundary plan preserves every original node and is idempotent',()=>{
  const doc=flat(),before=structuredClone(doc);
  const plan=planManualMigration(doc,{description:1,conclusion:2,signature:3});
  assert.equal(plan.status,'ready');
  assert.deepEqual(plan.document.content.flatMap(node=>node.content),before.content);
  assert.deepEqual(doc,before);
  assert.equal(planManualMigration(plan.document).status,'already-structured');
  assert.deepEqual(planManualMigration(plan.document).document,plan.document);
  assert.throws(()=>planManualMigration(doc,{description:1,conclusion:1,signature:3}));
  assert.throws(()=>planManualMigration(doc));
});

test('verified permanent backup survives a new store instance and restores exact source',async()=>{
  const store=storage(),doc=flat();
  const key=await createMigrationBackup(store,'tab-a','synthetic',doc);
  const restarted={getItem:store.getItem};
  assert.deepEqual((await readMigrationBackup(restarted,key,'tab-a')).doc,doc);
  assert.deepEqual(migrationBackupKeys(store),[key]);
  await assert.rejects(readMigrationBackup(restarted,key,'tab-b'));
});

test('write error, unverified readback and corrupt backup block migration',async()=>{
  const doc=flat();
  await assert.rejects(createMigrationBackup({setItem(){throw Error('quota')},getItem(){return null}},'tab','synthetic',doc));
  await assert.rejects(createMigrationBackup({setItem(){},getItem(){return null}},'tab','synthetic',doc),/проверку записи/);
  const store=storage(),key=await createMigrationBackup(store,'tab','synthetic',doc);
  const record=JSON.parse(store.getItem(key));record.doc.content[1].content[0].text='Повреждено';store.setItem(key,JSON.stringify(record));
  await assert.rejects(readMigrationBackup(store,key,'tab'),/повреждена/);
  record.doc=doc;record.tabId='other-tab';store.setItem(key,JSON.stringify(record));
  await assert.rejects(readMigrationBackup(store,key),/повреждена/);
  store.setItem(key,'{bad json');
  await assert.rejects(readMigrationBackup(store,key,'tab'),/повреждена/);
});

test('backup can restore original after a simulated failure after migration',async()=>{
  const store=storage(),doc=flat(),key=await createMigrationBackup(store,'tab','synthetic',doc);
  let current=planManualMigration(doc,{description:1,conclusion:2,signature:3}).document;
  assert.notDeepEqual(current,doc);
  current=(await readMigrationBackup(store,key,'tab')).doc;
  assert.deepEqual(current,doc);
});
