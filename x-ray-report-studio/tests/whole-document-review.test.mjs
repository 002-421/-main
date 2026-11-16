import {test} from 'node:test';
import assert from 'node:assert/strict';
import {proofreadingBlocks,ReviewEngine} from '../src/ai-review.ts';
import {LocalAIProvider} from '../src/local-ai-provider.ts';
const paragraph=(text,marks)=>({type:'paragraph',content:[{type:'text',text,marks}]});
const doc={type:'doc',content:['header','description','conclusion','signature'].map((id,i)=>({type:'reportSection',attrs:{id},content:[paragraph('Ошибкка',i%2?[{type:'bold'}]:[]),...(id==='header'?[paragraph('Ошибкка',[{type:'templateField',attrs:{id:'head-gm.patient'}}])]:[]),...(id==='signature'?[paragraph('Ошибкка')]:[])]}))};
test('all five editable locations are checked and structured personal fields are excluded',async()=>{
 const blocks=proofreadingBlocks(doc);assert.equal(Object.values(blocks).filter(x=>x==='Ошибкка').length,5);
 const provider=new LocalAIProvider(async text=>text==='Ошибкка'?[{id:'ru.spelling.1',kind:'spelling',start:0,end:7,text,suggestions:['Ошибка'],message:'Опечатка'}]:[]);
 const result=await new ReviewEngine(provider).review(doc,new Set(['spelling']));
 assert.equal(result.suggestions.length,5);assert.ok(result.suggestions.every(x=>x.blockId.startsWith('paragraph@')));
});

test('real dictionary finds supplied typos in header and conclusion, including DOCX round-trip',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {createRussianChecker}=await import('../src/proofreading-core.ts');
 const {makeTemplateDocument}=await import('../src/catalog.ts');
 const {exportDocx,importOwnDocx}=await import('../src/docx.ts');
 const checker=createRussianChecker(await readFile(new URL('../node_modules/dictionary-ru/index.aff',import.meta.url),'utf8'),await readFile(new URL('../node_modules/dictionary-ru/index.dic',import.meta.url),'utf8'));
 const report=makeTemplateDocument('head-gm');report.content=structuredClone(doc.content);
 const wrong='Проапив токол исследрплаотования градюднице перефирической диффереренцировать прорцесс транзциторной';
 for(const section of report.content.filter(n=>n.type==='reportSection'))section.content.push(paragraph(wrong,[{type:'bold'}]));
 const engine=new ReviewEngine(new LocalAIProvider(checker));
 const result=await engine.review(report,new Set(['spelling']));
 assert.equal(result.suggestions.filter(s=>s.original==='исследрплаотования').length,4);
 const imported=await importOwnDocx(await exportDocx(report));assert.ok(imported);
 const again=await engine.review(imported.doc,new Set(['spelling']));
 assert.equal(again.suggestions.filter(s=>s.original==='исследрплаотования').length,4);
});
