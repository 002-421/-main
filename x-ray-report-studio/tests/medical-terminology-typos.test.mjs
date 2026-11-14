import test from 'node:test';
import assert from 'node:assert/strict';
import { MedicalTerminologyEngine } from '../src/clinical-review.ts';

const engine=new MedicalTerminologyEngine();
const findings=text=>engine.validate({description:text,conclusion:''});
const typos=['гиперинтенсвный','гиподенсивныйй','субарахноидальныйй','остеодиструкция','интрамедуллярнй','гиперденсивнй','перивентрикулярнй','консолидациия','экстрадуралный','гиподенсивнй'];
test('detects all ten previously missed registered medical term typos as comments',()=>{
 for(const [i,word] of typos.entries()){const modality=i===1||i===3||i===5||i===7||i===9?'КТ':'МРТ';const result=findings(`${modality}: ${word}`);assert.equal(result.length,1,word);assert.equal(result[0].operation,'comment');assert.equal(result[0].proposed,'');assert.equal(result[0].category,'terminology');}
});
test('does not flag correct terms, names, abbreviations, rare words or ambiguous near matches',()=>{
 for(const text of ['МРТ: гиперинтенсивный интрамедуллярный очаг.','КТ: гиподенсивный узел и остеодеструкция.','МРТ: Иванов описал редкий квазифорамен.','КТ: МСКТ ВНЧС ЦНС.','МРТ: протрузия и экструзия.'])assert.deepEqual(findings(text),[],text);
});
