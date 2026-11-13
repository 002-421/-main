import test from 'node:test';
import assert from 'node:assert/strict';
import { ClinicalConsistencyEngine, ClinicalLogicEngine } from '../src/clinical-review.ts';

const clinical=new ClinicalLogicEngine();
const consistency=new ClinicalConsistencyEngine();
const warning=(description,conclusion)=>clinical.validate({description,conclusion});

test('explicit anatomical inflections link the same organ in description and conclusion',t=>{
  const cases=[
    ['logic-tp04','КТ: В правом легком определяется узел.','КТ: Узел правого легкого отсутствует.'],
    ['logic-tp06','КТ: В селезенке определяется образование.','КТ: Образование селезенки не выявлено.'],
    ['logic-tp08','КТ: В плевре определяется узел.','КТ: Узел плевры отсутствует.'],
    ['logic-tp10','КТ: В почке определяется киста.','КТ: Киста почки не обнаружена.'],
  ];
  for(const [id,description,conclusion] of cases)t.test(id,()=>assert.equal(warning(description,conclusion).length,1));
});

test('pleural terminology does not mask an explicitly stated side',()=>{
  const pairs=[
    ['справа','слева'],['правый','левый'],['правая','левая'],['правого','левого'],
    ['правому','левому'],['правым','левым'],['правом','левом'],['правую','левую'],['правой','левой'],
  ];
  for(const [right,left] of pairs){
    const result=consistency.validate({description:`КТ: Узел плевры ${right} 3 мм.`,conclusion:`КТ: Узел плевры ${left} 3 мм.`});
    assert.equal(result.length,1,`${right} / ${left}`);
  }
});

test('unmarked pleural location does not create an inferred laterality conflict',()=>{
  assert.deepEqual(consistency.validate({description:'КТ: Узел плевры 3 мм.',conclusion:'КТ: Узел плевры 3 мм.'}),[]);
});

test('anatomical normalization does not merge different organs, sides or spinal levels',()=>{
  const cases=[
    ['different organs','КТ: В правом легком определяется узел.','КТ: Узел селезенки отсутствует.'],
    ['different sides','КТ: В правой почке определяется киста.','КТ: Киста левой почки не выявлена.'],
    ['different levels','МРТ: Грыжа диска L4-L5 определяется.','МРТ: Грыжа диска L5-S1 не выявлена.'],
  ];
  for(const [label,description,conclusion] of cases)assert.deepEqual(warning(description,conclusion),[],label);
});

test('laterality is not assigned across multiple different findings in one clause',()=>{
  const result=consistency.validate({
    description:'КТ: Узел в правом легком и киста в левой почке 3 мм.',
    conclusion:'КТ: Узел в левом легком и киста в правой почке 3 мм.',
  });
  assert.deepEqual(result,[]);
});
