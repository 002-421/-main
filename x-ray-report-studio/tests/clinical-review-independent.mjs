import { readFile } from 'node:fs/promises';
import { MedicalTerminologyEngine, ClinicalConsistencyEngine, ClinicalLogicEngine } from '../src/clinical-review.ts';

const corpus=JSON.parse(await readFile(new URL('./clinical-review-independent.json',import.meta.url),'utf8'));
const engines={terminology:new MedicalTerminologyEngine(),consistency:new ClinicalConsistencyEngine(),clinical:new ClinicalLogicEngine()};
const matrix={};const errors={};
for(const [category,cases] of Object.entries(corpus)){
 if(!engines[category])continue;
 const engine=engines[category];let TP=0,FP=0,FN=0,TN=0;const fn=[],fp=[];
 for(const item of cases){const blocks=category==='terminology'?{description:item.text,conclusion:''}:{description:item.description,conclusion:item.conclusion};const predicted=engine.validate(blocks).length>0;const expected=item.expected;if(predicted&&expected)TP++;else if(predicted&&!expected){FP++;fp.push({id:item.id,description:blocks.description,conclusion:blocks.conclusion??'',findings:engine.validate(blocks).map(x=>x.explanation)});}else if(!predicted&&expected){FN++;fn.push({id:item.id,description:blocks.description,conclusion:blocks.conclusion??''});}else TN++;}
 const precision=TP+FP?TP/(TP+FP):null,recall=TP+FN?TP/(TP+FN):null;
 matrix[category]={cases:cases.length,TP,FP,FN,TN,precision,recall,F1:precision===null||recall===null||precision+recall===0?null:2*precision*recall/(precision+recall)};errors[category]={FP:fp,FN:fn};
}
console.log(JSON.stringify({corpus:'independent fixed synthetic holdout',matrix,errors},null,2));
