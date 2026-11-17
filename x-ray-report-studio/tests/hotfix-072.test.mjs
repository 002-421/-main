import test from 'node:test';import assert from 'node:assert/strict';
import {ClinicalConsistencyEngine,ClinicalLogicEngine} from '../src/clinical-review.ts';
import {ReviewEngine} from '../src/ai-review.ts';
import {readFileSync} from 'node:fs';import {createRussianChecker} from '../src/proofreading-core.ts';
const consistency=(d,c)=>new ClinicalConsistencyEngine().validate({description:d,conclusion:c});
const logic=(d,c)=>new ClinicalLogicEngine().validate({description:d,conclusion:c});
test('synovitis laterality uses morphology and stable unique matching, never edits',()=>{
 for(const [d,c] of [['Синовит слева.','МР-картина синовита справа.'],['Левосторонний синовит.','Правосторонний синовит.']]){const r=consistency(d,c);assert.equal(r.length,1);assert.ok(r.every(x=>x.operation==='comment'&&!x.proposed));assert.deepEqual(r,consistency(d,c));}
 for(const [d,c] of [['Справа синовит, слева коксартроз.','Справа синовит, слева коксартроз.'],['Двусторонний синовит, больше слева.','Двусторонний синовит, больше справа.'],['Синовит слева не выявлен.','Синовит справа.'],['Синовит левого коленного сустава.','Синовит правого плечевого сустава.'],['Синовит справа. Синовит слева.','Синовит слева.']])assert.equal(consistency(d,c).length,0,d);
});
test('unique brain focus distinguishes side/location while independent foci are not conflated',()=>{
 assert.equal(consistency('Очаг в левой лобной доле.','Очаг в правой лобной доле.').length,1);
 assert.equal(logic('Очаг в левой лобной доле.','Очаг в левой теменной доле.').length,1);
 assert.equal(logic('Очаг в левой лобной доле. Очаг в правой теменной доле.','Очаг в правой теменной доле.').length,0);
 assert.equal(logic('В стволе мозга очагов не выявлено.','В левой лобной доле определяется очаг.').length,0);
});
test('one combined explicit stenosis warning retains both sources and ignores other levels',()=>{
 const d='C5/6: относительный стеноз. C6/7: относительный стеноз. Позвоночный канал не сужен.';const r=logic(d,'Относительный стеноз позвоночного канала C5-C7.');assert.equal(r.length,1);assert.match(r[0].explanation,/C5-C6, C6-C7/);assert.match(r[0].related,/C5\/6/);assert.match(r[0].related,/C6\/7/);
 assert.equal(logic('На C5/6 имеется стеноз. На остальных уровнях канал не сужен.','Стеноз C5/6.').length,0);
 assert.equal(logic('Позвоночный канал 0,85 см.','Без особенностей.').length,0);
});
test('explicit property negations require same structure and remain clinical comments',()=>{
 for(const [d,c] of [['Желудочки не расширены.','Желудочки расширены.'],['Очаг не накапливает контраст.','Очаг накапливает контраст.'],['Экструзий нет.','Выявлена экструзия C5/6.']])assert.ok(logic(d,c).length,d);
 assert.equal(logic('Стеноза C5/6 нет.','Стеноз C6/7.').length,0);
 assert.equal(logic('Деформация спинного мозга.','Патологического изменения МР-сигнала не выявлено.').length,0);
});
test('spelling proposes one dictionary-verified split without adding words',async()=>{
 const checker=createRussianChecker(readFileSync('node_modules/dictionary-ru/index.aff','utf8'),readFileSync('node_modules/dictionary-ru/index.dic','utf8'));
 for(const word of ['суженсправа','суженслева','расширенсправа','расширенслева']){const rows=await checker(word);const x=rows.find(x=>x.text===word);assert.ok(x);assert.ok(x.suggestions.some(v=>v.replace(' ','')===word&&v.includes(' ')),word);assert.equal(new Set(x.suggestions).size,x.suggestions.length);assert.ok(!x.suggestions.includes(word));}
});
test('reanalysis of unchanged document retains IDs; duplicate findings merge without merging independent findings',async()=>{
 const doc={type:'doc',content:[{type:'reportSection',attrs:{id:'description'},content:[{type:'paragraph',content:[{type:'text',text:'Синовит слева.'}]}]},{type:'reportSection',attrs:{id:'conclusion'},content:[{type:'paragraph',content:[{type:'text',text:'МР-картина синовита справа.'}]}]}]};doc.content.unshift({type:'reportSection',attrs:{id:'header'},content:[]});doc.content.push({type:'reportSection',attrs:{id:'signature'},content:[]});const engine=new ReviewEngine({review:async()=>[]});const a=await engine.review(doc,new Set(['consistency'])),b=await engine.review(doc,new Set(['consistency']));assert.equal(a.suggestions.length,1);assert.deepEqual(a.suggestions.map(x=>x.id),b.suggestions.map(x=>x.id));
});
test('spine ranges and Cyrillic segment names agree; terminology ambiguity is low-confidence only',()=>{
 for(const level of ['C5-C7','С5-С7'])assert.equal(consistency('C5/6: экструзия. C6/7: экструзия.',`Экструзии ${level}.`).length,0);
 const r=logic('C5/6: Сублигаментарная экструзия 0,70 см. Деформация спинного мозга за счёт пролабирования C5-C6.','Без дополнительных особенностей.');assert.equal(r.length,1);assert.equal(r[0].priority,'low');assert.equal(r[0].operation,'comment');
 assert.equal(logic('C5/6: экструзия. Пролабирование C6/7.','Без особенностей.').length,0);
});
