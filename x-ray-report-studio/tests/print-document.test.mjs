import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePrintDocument} from '../src/print-document.ts';
import {makeTemplateDocument,reportTemplates} from '../src/catalog.ts';
const text=n=>n.text??(n.content??[]).map(text).join('');
const p=t=>({type:'paragraph',content:[{type:'text',text:t}]});
test('new builtins use actual Arial on every authored run without changing marks',()=>{
 for(const t of reportTemplates){const doc=makeTemplateDocument(t.id);assert.equal(doc.attrs.fontFamily,'Arial');const visit=n=>{if(n.type==='text'){const style=n.marks?.find(m=>m.type==='textStyle');assert.equal(style?.attrs.fontFamily,'Arial',t.id);assert.equal(style?.attrs.fontSize,'14.66667px');}n.content?.forEach(visit);};visit(doc);}
});
test('print copy keeps the last description with only the beginning of the conclusion; never mutates saved text',()=>{
 for(const heading of ['ЗАКЛЮЧЕНИЕ:','ЗАКЛЮЧЕНИЕ.','Заключение:']){
 const doc={type:'doc',content:[{type:'reportSection',attrs:{id:'description'},content:[p('Описание справа 6 мм.'),p('Последний медицинский абзац.')]},{type:'reportSection',attrs:{id:'conclusion'},content:[p(heading+' Без изменений.'),p('Продолжение заключения.')]},{type:'reportSection',attrs:{id:'signature'},content:[p('Врач: Синтетический тест.')]}]};
 const original=structuredClone(doc),copy=preparePrintDocument(doc);assert.deepEqual(doc,original);assert.equal(text(copy),text(doc));assert.equal(copy.content[1].attrs.keepNext,true);assert.equal(copy.content[2].attrs.keepNext,false);assert.equal(copy.content[3].attrs?.keepNext,undefined);
 }
});
test('service footer is excluded from spelling without excluding a multi-paragraph formatted conclusion',async()=>{
 const {proofreadingBlocks}=await import('../src/ai-review.ts');
 const doc={type:'doc',content:[p('Определяются паталогические изменения.'),p('Заключение: МР-картина дегенеративных изминений.'),p('Второй абзац заключения.'),p('Данное заключение не является диагнозом') ]};
 const blocks=Object.values(proofreadingBlocks(doc));assert.ok(blocks.some(t=>t.includes('паталогические')));assert.ok(blocks.some(t=>t.includes('изминений')));assert.equal(blocks.length,3);
});
