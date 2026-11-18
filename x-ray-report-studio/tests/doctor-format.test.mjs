import test from 'node:test';import assert from 'node:assert/strict';
import {DoctorFormats,DOCTOR_FORMAT_KEY,TEMPLATE_FONT_SIZES,newProtocolFont} from '../src/doctor-format.ts';
import {makeTemplateDocument,reportTemplates} from '../src/catalog.ts';
import {exportDocx,importOwnDocx} from '../src/docx.ts';
const memory=()=>{const values=new Map();return{values,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};};
test('existing physician names migrate to stable independent IDs without overwriting legacy settings',()=>{
 const s=memory();s.setItem('mri-alliance.settings.v3','legacy physician and stamps');const a=new DoctorFormats(s,['Синтетический А','Синтетический Б'],'Синтетический А');const aid=a.get('Синтетический А').id,bid=a.get('Синтетический Б').id;assert.notEqual(aid,bid);a.save('Синтетический А',14,false);a.save('Синтетический Б',10.5,true);
 const restored=new DoctorFormats(s,['Синтетический А','Синтетический Б'],'Синтетический Б');assert.deepEqual(restored.get('Синтетический А'),{id:aid,name:'Синтетический А',fontSize:14,optimize:false});assert.deepEqual(restored.get('Синтетический Б'),{id:bid,name:'Синтетический Б',fontSize:10.5,optimize:true});assert.equal(s.getItem('mri-alliance.settings.v3'),'legacy physician and stamps');
 restored.save('Синтетический А',11,false);assert.equal(restored.get('Синтетический А').fontSize,11);assert.throws(()=>restored.save('Синтетический А',9,false));
});
test('corrupt formatting registry is backed up before migration; failed writes preserve previous registry',()=>{
 const s=memory();s.setItem(DOCTOR_FORMAT_KEY,'corrupt synthetic registry');new DoctorFormats(s,[],'');assert.ok([...s.values].some(([key,value])=>key.startsWith(DOCTOR_FORMAT_KEY+'.recovery.')&&value==='corrupt synthetic registry'));
 const old=s.getItem(DOCTOR_FORMAT_KEY);const store=new DoctorFormats(s,[],'');s.setItem=()=>{throw new Error('Synthetic quota');};assert.throws(()=>store.save('',14,true),/quota/);assert.equal(s.getItem(DOCTOR_FORMAT_KEY),old);assert.equal(store.get('').fontSize,11);
});
test('all seven sizes apply to every new MRI/CT template without changing its text or source version',async()=>{
 const text=n=>n.text??(n.content??[]).map(text).join('');
 for(const size of TEMPLATE_FONT_SIZES){for(const t of reportTemplates){const source=makeTemplateDocument(t.id),before=JSON.stringify(source),doc=newProtocolFont(source,size);assert.equal(doc.attrs.fontSizePt,size);assert.equal(text(doc),text(source));assert.equal(JSON.stringify(source),before);const walk=n=>{if(['paragraph','heading'].includes(n.type))assert.equal(n.attrs.fontSizePt,size);for(const m of n.marks??[])if(m.type==='textStyle'){assert.equal(m.attrs.fontFamily,'Arial');assert.ok(Math.abs(parseFloat(m.attrs.fontSize)*.75-size)<.01);}n.content?.forEach(walk);};walk(doc);}
 const doc=newProtocolFont(makeTemplateDocument('head-gm'),size);assert.deepEqual((await importOwnDocx(await exportDocx(doc))).doc,doc);
 }
});
