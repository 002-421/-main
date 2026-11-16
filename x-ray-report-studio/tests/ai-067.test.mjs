import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ReviewEngine,LocalAIProvider} from '../src/ai-review.ts';
import {medicalTextForCopy,personalDataWarnings} from '../src/safe-medical-copy.ts';
import {createRussianChecker} from '../src/proofreading-core.ts';
import {LocalAIProvider as LocalProvider} from '../src/local-ai-provider.ts';
import {morphologicalIssues} from '../src/morphological-grammar.ts';

const section=(id,text)=>({type:'reportSection',attrs:{id},content:[{type:'paragraph',content:[{type:'text',text}]}]});
const document=(description,conclusion,signature='Рекомендации: наблюдение. Врач: Иванов Иван Иванович.')=>({type:'doc',content:[section('header','Пациент: Петров Пётр'),section('description',description),section('conclusion',conclusion),section('signature',signature)]});

test('several spinal findings retain exact conclusion ranges, with no false conflict for matched levels',async()=>{
 const doc=document('На уровне L4/L5 определяется левосторонняя фораминальная экструзия диска. На уровне L5/S1 определяется правосторонняя парамедианно-фораминальная экструзия. На уровне L3/L4 определяется протрузия диска.','Экструзии L1/2 и L5/S1. Протрузия L3/L4.');
 const result=await new ReviewEngine().review(doc,new Set(['consistency']));
 const issues=result.suggestions.filter(x=>x.category==='consistency');
 assert.ok(issues.some(x=>x.original==='L1/2'&&x.explanation.includes('отсутствующая')));
 assert.ok(issues.some(x=>x.explanation.includes('L4-L5')&&x.explanation.includes('не отражённая')));
 assert.ok(issues.every(x=>x.operation==='comment'&&!x.proposed));
 assert.ok(issues.every(x=>result.blocks.conclusion.slice(x.from,x.to)===x.original));
 assert.ok(!issues.some(x=>/L5-S1|L3-L4/u.test(x.explanation)&&!/L4-L5/u.test(x.explanation)));
 const clean=await new ReviewEngine().review(document(doc.content[1].content[0].content[0].text,'Экструзии L4/L5 и L5/S1. Протрузия L3/L4.'),new Set(['consistency']));
 assert.equal(clean.suggestions.filter(x=>x.category==='consistency').length,0);
 const differentType=await new ReviewEngine().review(document('На уровне L4/L5 определяется экструзия диска.','Протрузия L4/L5.'),new Set(['consistency']));
 assert.ok(differentType.suggestions.some(x=>x.explanation.includes('экструзия')&&x.explanation.includes('не отражённая')));
 assert.ok(differentType.suggestions.some(x=>x.explanation.includes('протрузия')&&x.explanation.includes('отсутствующая')));
});

test('copy selects confirmed medical sections, excludes header and doctor, and detects embedded identifiers',()=>{
 const doc=document('Очаг L4/L5, 6 мм.','Протрузия L4/L5.');
 const text=medicalTextForCopy(doc);
 assert.match(text,/Очаг L4\/L5, 6 мм/u);assert.match(text,/Протрузия L4\/L5/u);assert.match(text,/Рекомендации: наблюдение/u);
 assert.doesNotMatch(text,/Петров|Иванов/u);assert.deepEqual(personalDataWarnings(text),[]);
 assert.ok(personalDataWarnings(text+' Пациент: Петров Пётр. 12.05.1970').length);
 assert.ok(personalDataWarnings('Осмотрел Иванов Иван.').includes('возможное ФИО'));
 assert.ok(personalDataWarnings('Исследование № 12345.').length);
 assert.throws(()=>medicalTextForCopy({type:'doc',content:[section('header','x'),section('description','x')]}),/границы/u);
});

test('local dictionary suggests requested forms, preserves trusted forms, and diagnoses only actual spaces',async()=>{
 const dir=new URL('../node_modules/dictionary-ru/',import.meta.url);
 const check=createRussianChecker(await readFile(new URL('index.aff',dir),'utf8'),await readFile(new URL('index.dic',dir),'utf8'));
 for(const [wrong,right] of [['дстрофических','дистрофических'],['менигиома','менингиома'],['трепанобиопся','трепанобиопсия']]){
  const issue=(await check(wrong)).find(x=>x.text===wrong&&x.kind==='spelling');assert.ok(issue,wrong);assert.ok(issue.suggestions.includes(right),wrong);
 }
 assert.deepEqual((await check('гипофиз гипофиза гипофизом гипофизу аденогипофиза')).filter(x=>x.kind==='spelling'),[]);
 const spacing=await check('Описание  (  очаг  ) , заключение.');
 assert.ok(spacing.some(x=>x.text==='  '));assert.ok(spacing.some(x=>x.message.includes('скобки')));
 const punctuation=await new LocalProvider(check).review({description:'Очаг ( 6 мм ) подтверждён.',conclusion:'Без особенностей.'});
 assert.ok(punctuation.some(x=>x.category==='punctuation'&&x.operation==='delete'&&x.original.trim()===''));
 assert.ok(!(await check('Фасеты не смещены друг относительно друга.')).some(x=>x.text==='относительно'));
});

test('relative constructions and participle complements do not trigger invented agreement errors',async()=>{
 for(const text of ['Фасеты не смещены друг относительно друга.','Структуры расположены относительно средней линии.','Антелистез, сопровождающийся деформацией дурального мешка.','Стеноз, сопровождающийся компрессией нервных структур.']){
  assert.deepEqual(await morphologicalIssues(text),[],text);
 }
});
