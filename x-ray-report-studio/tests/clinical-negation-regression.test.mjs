import test from 'node:test';
import assert from 'node:assert/strict';
import { ClinicalLogicEngine } from '../src/clinical-review.ts';

const engine=new ClinicalLogicEngine();
const check=(description,conclusion)=>engine.validate({description,conclusion});
test('reports positive L4-L5 herniation versus conclusion that no disc hernias were found',()=>{
 assert.ok(check('На уровне L4-L5 определяется грыжа межпозвонкового диска.','Грыж межпозвонковых дисков не выявлено.').length>0);
});
test('does not conflict when one level is positive and another level is negative',()=>{
 assert.equal(check('Грыжа L4-L5 определяется. На уровне L5-S1 грыжи нет.','Грыжа L4-L5.').length,0);
});
test('does not conflate protrusion and extrusion',()=>{
 assert.equal(check('Протрузия диска L4-L5 определяется.','Экструзия диска L4-L5 не выявлена.').length,0);
});
test('uncertain findings and prior negative dynamics are not contradictions',()=>{
 assert.equal(check('Грыжа L4-L5 не исключается.','Возможная грыжа L4-L5.').length,0);
 assert.equal(check('Без отрицательной динамики.','Ранее известная грыжа L4-L5.').length,0);
});
test('findings in different anatomy are not compared',()=>{
 assert.equal(check('Грыжа L4-L5 определяется.','Грыжа шейного отдела не выявлена.').length,0);
});
