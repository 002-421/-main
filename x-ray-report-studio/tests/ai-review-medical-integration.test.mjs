import test from 'node:test';
import assert from 'node:assert/strict';
import { ReviewEngine, MockAIProvider } from '../src/ai-review.ts';

const paragraph=text=>({type:'paragraph',content:[{type:'text',text}]});
const section=(id,text)=>({type:'reportSection',attrs:{id},content:[paragraph(text)]});
const doc={type:'doc',content:[section('header','synthetic header'),section('description','КТ: очаг справа.'),section('conclusion','КТ: очаг справа.'),section('signature','synthetic signature')]};
const source='КТ: очаг справа.';
const finding=(category,from=0,to=3)=>({operation:'comment',blockId:'description',original:source.slice(from,to),proposed:'',explanation:'synthetic warning',category,priority:'medium',from,to,meaningRisk:true});
function spyEngine(results=[]){let calls=0;return {validate(){calls++;return results;},get calls(){return calls;},reset(){calls=0;}};}

test('medical engines run only for their independently selected categories',async()=>{
 const terminology=spyEngine([finding('terminology')]),consistency=spyEngine([finding('consistency')]),clinical=spyEngine([finding('clinical')]);
 const engine=new ReviewEngine(new MockAIProvider(),{terminology,consistency,clinical});
 const none=await engine.review(doc,new Set());assert.equal(none.suggestions.length,0);assert.deepEqual([terminology.calls,consistency.calls,clinical.calls],[0,0,0]);
 for(const [category,chosen] of [['terminology',terminology],['consistency',consistency],['clinical',clinical]]){
   terminology.reset();consistency.reset();clinical.reset();
   const result=await engine.review(doc,new Set([category]));assert.equal(chosen.calls,1,category);
   for(const other of [terminology,consistency,clinical].filter(x=>x!==chosen))assert.equal(other.calls,0,category);
   assert.equal(result.suggestions.every(x=>x.category===category),true);
 }
});

test('deduplicates only identical spans and operations within the consistency group',async()=>{
 const exactA=finding('side',0,3),exactB={...exactA,category:'consistency',explanation:'duplicate source'};
 const differentSpan=finding('level',0,5),differentFinding=finding('size',4,7);
 const engine=new ReviewEngine(new MockAIProvider(),{terminology:spyEngine(),consistency:spyEngine([exactA,exactB,differentSpan,differentFinding]),clinical:spyEngine()});
 const result=await engine.review(doc,new Set(['consistency']));assert.equal(result.suggestions.length,3);
 assert.deepEqual(result.suggestions.map(x=>[x.from,x.to]),[[0,3],[0,5],[4,7]]);
});

test('clinical medical outputs remain comments with no proposed text',async()=>{
 const warning=finding('clinical');
 const engine=new ReviewEngine(new MockAIProvider(),{terminology:spyEngine(),consistency:spyEngine(),clinical:spyEngine([warning])});
 const result=await engine.review(doc,new Set(['clinical']));assert.equal(result.suggestions.length,1);assert.equal(result.suggestions[0].operation,'comment');assert.equal(result.suggestions[0].proposed,'');assert.equal(result.suggestions[0].meaningRisk,true);
});
