import test from 'node:test';import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';import StarterKit from '@tiptap/starter-kit';import Image from '@tiptap/extension-image';
import {recoverParagraphBlocks} from '../src/document-recovery.ts';
const schema=getSchema([StarterKit,Image.configure({inline:false})]);
test('block image in paragraph reproduces exact ProseMirror failure and recovers without dropping text or media',()=>{
 const source={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Справа 6 мм',marks:[{type:'bold'}]},{type:'image',attrs:{src:'data:image/png;base64,AAAA'}},{type:'text',text:'Заключение: L5–S1'}]}]};
 const before=JSON.stringify(source);assert.throws(()=>schema.nodeFromJSON(source).check(),/Invalid content for node paragraph/);
 const result=recoverParagraphBlocks(source);assert.equal(result.changed,true);schema.nodeFromJSON(result.doc).check();
 assert.equal(JSON.stringify(source),before);assert.deepEqual(result.doc.content.map(n=>n.type),['paragraph','image','paragraph']);
 assert.deepEqual(result.doc.content[0].content,source.content[0].content.slice(0,1));assert.equal(result.doc.content[2].content[0].text,'Заключение: L5–S1');
});
test('valid documents are unchanged; unknown nodes remain refused rather than discarded',()=>{const good={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'6 мм'}]}]};assert.deepEqual(recoverParagraphBlocks(good),{doc:good,changed:false});const bad={type:'doc',content:[{type:'paragraph',content:[{type:'unknownMedicalContent'}]}]};assert.throws(()=>schema.nodeFromJSON(recoverParagraphBlocks(bad).doc).check());});

test('real XRS physician-stamp export creates the incompatible legacy paragraph, recovered without losing stamp or signature',async()=>{
 const {attachDoctorStamp}=await import('../src/doctor-stamp.ts');
 const doc={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Врач-рентгенолог: Синтетический Врач. Дата: 15.11.2026'}]}]};
 const stamped=attachDoctorStamp(doc,{'Синтетический Врач':'data:image/png;base64,AAAA'},{'Синтетический Врач':{width:360,height:130}});
 assert.throws(()=>schema.nodeFromJSON(stamped).check(),/Invalid content for node paragraph/);
 const recovered=recoverParagraphBlocks(stamped);assert.equal(recovered.changed,true);schema.nodeFromJSON(recovered.doc).check();
 assert.equal(recovered.doc.content.filter(n=>n.type==='image').length,1);assert.ok(JSON.stringify(recovered.doc).includes('Синтетический Врач'));assert.ok(JSON.stringify(recovered.doc).includes('15.11.2026'));assert.equal(doc.content[0].content.length,1);
});
