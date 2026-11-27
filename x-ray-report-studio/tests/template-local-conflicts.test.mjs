import test from 'node:test';import assert from 'node:assert/strict';
import {threeWayTemplate,reconcileLocalTemplates,rememberTemplateBase,resolveLocalTemplateConflict,localTemplateConflicts,recoverTemplateReconciliation,LOCAL_TEMPLATE_KEYS as K} from '../src/template-local-conflicts.ts';
const doc=(a='Первый абзац',b='Второй абзац')=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:a}]},{type:'paragraph',content:[{type:'text',text:b}]}]});
class Storage{data=new Map();fail=false;getItem(key){return this.data.get(key)??null;}setItem(key,value){if(this.fail&&key===K.bases){this.fail=false;throw Error('SYNTHETIC_QUOTA');}this.data.set(key,value);}removeItem(key){this.data.delete(key);}}
test('three-way merge combines disjoint edits and formatting; overlapping medical text remains a conflict',()=>{
 const base=doc(),local=doc('Локальная редакция'),incoming=doc(undefined,'Новая стандартная');
 const merged=threeWayTemplate(base,local,incoming);assert.equal(merged.conflict,false);assert.deepEqual(merged.doc,doc('Локальная редакция','Новая стандартная'));
 assert.equal(threeWayTemplate(base,local,doc('Иная стандартная редакция')).conflict,true);
 const styled=structuredClone(base);styled.content[1].attrs={textAlign:'center'};assert.equal(threeWayTemplate(base,local,styled).conflict,false);
});
test('legacy, removed and overlapping local revisions retain both versions until an explicit decision',()=>{
 const storage=new Storage(),local=doc('Местная редакция'),incoming=doc('Стандартная редакция');storage.setItem(K.overrides,JSON.stringify({safe:local}));
 let rows=reconcileLocalTemplates(storage,{safe:{doc:incoming}},'1.0.1');assert.equal(rows[0].reason,'untracked');assert.deepEqual(JSON.parse(storage.getItem(K.overrides)).safe,local);
 resolveLocalTemplateConflict(storage,'safe','local');assert.equal(localTemplateConflicts(storage).length,0);assert.deepEqual(JSON.parse(storage.getItem(K.overrides)).safe,local);
 rows=reconcileLocalTemplates(storage,{safe:{doc:incoming,retired:true}},'1.0.2');assert.equal(rows[0].reason,'removed');assert.deepEqual(rows[0].incoming,incoming);
 resolveLocalTemplateConflict(storage,'safe','incoming');assert.equal(JSON.parse(storage.getItem(K.overrides)).safe,undefined);assert.ok(JSON.parse(storage.getItem(K.backups)).length>=2);
});
test('repeated updates do not duplicate conflicts; resolution refuses concurrent local edits',()=>{
 const storage=new Storage();rememberTemplateBase(storage,'safe',doc());storage.setItem(K.overrides,JSON.stringify({safe:doc('Local')}));
 reconcileLocalTemplates(storage,{safe:{doc:doc('Remote')}},'1.0.1');const before=storage.getItem(K.conflicts);reconcileLocalTemplates(storage,{safe:{doc:doc('Remote')}},'1.0.1');assert.equal(storage.getItem(K.conflicts),before);
 storage.setItem(K.overrides,JSON.stringify({safe:doc('Later local edit')}));assert.throws(()=>resolveLocalTemplateConflict(storage,'safe','incoming'),/LOCAL_TEMPLATE_CHANGED/);
});
test('interrupted local transaction restores old overrides; unrelated reports/settings are never written',()=>{
 const storage=new Storage();rememberTemplateBase(storage,'safe',doc());const local=doc('Local');storage.setItem(K.overrides,JSON.stringify({safe:local}));storage.setItem('patient-workspace','SYNTHETIC');storage.setItem('settings','UNCHANGED');storage.fail=true;
 assert.throws(()=>reconcileLocalTemplates(storage,{safe:{doc:doc(undefined,'Remote')}},'1.0.1'),/SYNTHETIC_QUOTA/);recoverTemplateReconciliation(storage);
 assert.deepEqual(JSON.parse(storage.getItem(K.overrides)).safe,local);assert.equal(storage.getItem('patient-workspace'),'SYNTHETIC');assert.equal(storage.getItem('settings'),'UNCHANGED');assert.equal(storage.getItem(K.journal),null);
});
