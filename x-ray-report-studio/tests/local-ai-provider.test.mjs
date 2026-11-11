import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRussianChecker } from '../src/proofreading-core.ts';
import { LocalAIProvider } from '../src/local-ai-provider.ts';
import { ReviewEngine, TrackChangesEngine } from '../src/ai-review.ts';

const aff = await readFile(new URL('../node_modules/dictionary-ru/index.aff', import.meta.url), 'utf8');
const dic = await readFile(new URL('../node_modules/dictionary-ru/index.dic', import.meta.url), 'utf8');
const checker = createRussianChecker(aff, dic);
const provider = new LocalAIProvider(checker);
const section = (id, text) => ({type:'reportSection',attrs:{id},content:[{type:'paragraph',content:[{type:'text',text}]}]});
const doc = (description, conclusion='Без особенностей.') => ({type:'doc',content:[section('header','Синтетический заголовок'),section('description',description),section('conclusion',conclusion),section('signature','Синтетическая подпись')]});

test('local checker converts spelling, punctuation and style into review findings', async () => {
  const text='Иследование  выполнено ,очаг очаг не выявлен.';
  const result=await new ReviewEngine(provider).review(doc(text),new Set(['spelling','punctuation','style']));
  assert.ok(result.suggestions.some(s=>s.category==='spelling'&&s.original==='Иследование'));
  assert.ok(result.suggestions.some(s=>s.category==='punctuation'&&s.original==='  '));
  assert.ok(result.suggestions.some(s=>s.category==='style'&&s.original.toLowerCase().includes('очаг очаг')));
  for(const s of result.suggestions) assert.equal(text.slice(s.from,s.to),s.original);
});

test('medical terms, measurements and MRI sequences are preserved', async () => {
  const text='Гиперинтенсивный интрамедуллярный очаг 2,5 мм. Экстрадуральный спондилодисцит. T1 T2 FLAIR DWI ADC STIR. Протрузия и экструзия.';
  const result=await provider.review({description:text,conclusion:'Секвестрация не выявлена.'});
  assert.equal(result.filter(s=>s.category==='spelling').length,0,JSON.stringify(result));
  assert.ok(result.every(s=>!/[0-9]|справа|слева/u.test(s.proposed)||s.operation==='comment'));
});

test('meaning-sensitive suggestions are comments; safe spacing needs explicit acceptance', async () => {
  const blocks={description:'Очаг  справа 5 мм.',conclusion:'Без особенностей.'};
  const findings=await provider.review(blocks);
  assert.ok(findings.some(f=>f.meaningRisk&&f.operation==='comment'));
  const safe=await new ReviewEngine(provider).review(doc('Протокол  выполнен.'));
  const edit=safe.suggestions.find(s=>s.original==='  '&&s.operation==='replace');
  assert.ok(edit);
  const tracks=new TrackChangesEngine();tracks.set('one',[edit]);tracks.set('two',[edit]);
  const original={description:'Протокол  выполнен.',conclusion:'Без особенностей.'};
  assert.equal(tracks.accept('one',edit.id,original).description,'Протокол выполнен.');
  assert.equal(original.description,'Протокол  выполнен.');
  assert.throws(()=>tracks.accept('two',edit.id,{...original,description:'Протокол выполнен.'}),/устарела/);
});

test('cancellation stops a running local analysis without logging clinical text', async () => {
  const controller=new AbortController();
  const slow=new LocalAIProvider(async(_text,_words,signal)=>{controller.abort();signal.throwIfAborted();return [];});
  const logs=[];const previous=console.log;console.log=(...args)=>logs.push(args);
  try{await assert.rejects(slow.review({description:'Очаг справа.',conclusion:'Без изменений.'},controller.signal),/abort/i);}
  finally{console.log=previous;}
  assert.equal(logs.length,0);
});

test('actual Hunspell loop observes cancellation on a long synthetic document', async () => {
  const controller=new AbortController();
  const pending=checker('Иследование '.repeat(500),[],controller.signal);
  setTimeout(()=>controller.abort(),0);
  await assert.rejects(pending,error=>error?.name==='AbortError');
});
