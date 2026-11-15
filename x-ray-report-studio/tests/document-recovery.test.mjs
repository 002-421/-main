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
