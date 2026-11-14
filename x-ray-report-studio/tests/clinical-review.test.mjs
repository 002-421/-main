import test from 'node:test';
import assert from 'node:assert/strict';
import { MedicalTerminologyEngine, ClinicalConsistencyEngine, ClinicalLogicEngine } from '../src/clinical-review.ts';

// Regression/development corpus: entirely synthetic, not the independent holdout.
// Expected finding labels are the scoring oracle and remain fixed for this corpus.
const corpus=[
 {id:'mri-brain-side',mod:'MRI',d:'МРТ: В правой лобной доле очаг 4 мм.',c:'МРТ: Очаг в левой лобной доле 4 мм.',expect:['consistency']},
 {id:'spine-level',mod:'MRI',d:'МРТ: Экструзия диска L4-L5 6 мм.',c:'МРТ: Экструзия диска L5-S1 6 мм.',expect:['consistency']},
 {id:'size-diff',mod:'CT',d:'КТ: В печени образование 12 мм.',c:'КТ: В печени образование 18 мм.',expect:['consistency']},
 {id:'size-units',mod:'CT',d:'КТ: В печени образование 1,2 см.',c:'КТ: В печени образование 12 мм.',expect:[]},
 {id:'size-space-decimal',mod:'CT',d:'КТ: В печени образование 1.2 см.',c:'КТ: В печени образование 18 мм.',expect:['consistency']},
 {id:'size-range',mod:'MRI',d:'МРТ: Очаг 4–6 мм в правой лобной доле.',c:'МРТ: Очаг 4–6 мм в правой лобной доле.',expect:[]},
 {id:'normal-negative',mod:'CT',d:'КТ: Очаговых изменений в лёгких не выявлено.',c:'КТ: Без очаговой патологии.',expect:[]},
 {id:'multiple-foci',mod:'MRI',d:'МРТ: В правой лобной доле очаг 3 мм. В левой теменной доле очаг 5 мм.',c:'МРТ: Два очага, без динамики.',expect:[]},
 {id:'prior-study',mod:'MRI',d:'МРТ: Очаг в правой лобной доле ранее определялся.',c:'МРТ: В динамике очаг не визуализируется.',expect:[]},
 {id:'tentative',mod:'CT',d:'КТ: Возможно образование правого лёгкого.',c:'КТ: Нельзя исключить узел в правом лёгком.',expect:[]},
 {id:'negation-conflict',mod:'MRI',d:'МРТ: В лобной доле очаг определяется.',c:'МРТ: В лобной доле очаг не выявлен.',expect:['clinical']},
 {id:'same-block-conflict',mod:'CT',d:'КТ: В печени образование определяется. В печени образование не выявлено.',c:'КТ: Без иных особенностей.',expect:['clinical']},
 {id:'abbreviations',mod:'MRI',d:'МРТ T1 T2 FLAIR DWI ADC STIR; ЦНС без особенностей.',c:'МРТ: без особенностей.',expect:[]},
 {id:'ct-abbreviations',mod:'CT',d:'КТ МСКТ ВНЧС без особенностей.',c:'КТ: без патологии.',expect:[]},
 {id:'unknown-term',mod:'MRI',d:'МРТ: Найдена редкая условная структура квазифорамен.',c:'МРТ: Особенности не выявлены.',expect:[]},
 {id:'other-anatomy',mod:'CT',d:'КТ: В печени очаг 8 мм. В селезёнке киста 9 мм.',c:'КТ: Очаг печени 8 мм, киста селезёнки 9 мм.',expect:[]},
 {id:'spine-negated-level',mod:'MRI',d:'МРТ: На L4-L5 грыжи нет.',c:'МРТ: На L5-S1 грыжи не выявлено.',expect:[]},
 {id:'size-with-two-lesions',mod:'MRI',d:'МРТ: Очаг 3 мм и отдельный очаг 7 мм.',c:'МРТ: Два очага.',expect:[]},
 {id:'terminology-unknown',mod:'MRI',d:'МРТ: Неизвестная анатомическая структура ксеноузел.',c:'МРТ: без особенностей.',expect:[]},
];
const blocks=x=>({description:x.d,conclusion:x.c});
const engines={terminology:new MedicalTerminologyEngine(),consistency:new ClinicalConsistencyEngine(),clinical:new ClinicalLogicEngine()};
const score=(tp,fp,fn,tn)=>{
 const precision=tp+fp?tp/(tp+fp):null;
 const recall=tp+fn?tp/(tp+fn):null;
 const f1=precision===null||recall===null||precision+recall===0?null:2*precision*recall/(precision+recall);
 return {tp,fp,fn,tn,precision,recall,f1};
};
test('regression: decimal size with NBSP and centimetres conflicts with millimetres',()=>{
 const result=engines.consistency.validate({description:'КТ: В печени образование 1.2\u00a0см.',conclusion:'КТ: В печени образование 18\u00a0мм.'});
 assert.equal(result.length,1);
});
test('control: 1.2 cm and 12 mm are equivalent despite NBSP',()=>{
 const result=engines.consistency.validate({description:'КТ: В печени образование 1.2\u00a0см.',conclusion:'КТ: В печени образование 12\u00a0мм.'});
 assert.equal(result.length,0);
});
test('regression/development corpus: per-category diagnostic confusion matrix and metrics',()=>{
 const report={};for(const [category,engine] of Object.entries(engines)){let tp=0,fp=0,fn=0,tn=0;const mismatches=[];for(const item of corpus){const found=engine.validate(blocks(item)).length>0;const expected=item.expect.includes(category);if(found&&expected)tp++;else if(found)fp++;else if(expected)fn++;else tn++;if(found!==expected)mismatches.push(item.id);}report[category]={...score(tp,fp,fn,tn),mismatches};assert.equal(tp+fp+fn+tn,corpus.length,`${category}: confusion matrix must include every case`);}
 console.log('CLINICAL_REVIEW_METRICS',JSON.stringify({cases:corpus.length,report}));
 assert.ok(Object.values(report).every(x=>x.tp+x.fp+x.fn+x.tn===corpus.length));
});
test('undefined precision, recall and F1 remain undefined when there are no positive examples',()=>{
 assert.deepEqual(score(0,0,0,1),{tp:0,fp:0,fn:0,tn:1,precision:null,recall:null,f1:null});
});
test('all medical findings are comments without a proposed edit',()=>{for(const engine of Object.values(engines))for(const item of corpus)for(const finding of engine.validate(blocks(item))){assert.equal(finding.operation,'comment');assert.equal(finding.proposed,'');assert.equal(finding.meaningRisk,true);}});
test('MRI/CT abbreviations are accepted and unknown terms do not become errors',()=>{const engine=engines.terminology;for(const item of corpus.filter(x=>['abbreviations','ct-abbreviations','unknown-term','terminology-unknown'].includes(x.id)))assert.deepEqual(engine.validate(blocks(item)),[],item.id);});
