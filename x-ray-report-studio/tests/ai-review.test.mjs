import test from 'node:test';
import assert from 'node:assert/strict';
import { ReportBlockExtractor, PrivacyGuard, TemplateValidator, ConsistencyEngine, ReviewEngine, TrackChangesEngine, CloudAIProvider } from '../src/ai-review.ts';

const p = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const section = (id, text) => ({ type: 'reportSection', attrs: { id }, content: [p(text)] });
const doc = (description='На уровне L4-L5 справа грыжа 5 мм.', conclusion='Грыжа L4-L5 справа 5 мм.') => ({ type: 'doc', content: [section('header', 'Пациент: Тестовый Человек'), section('description', description), section('conclusion', conclusion), section('signature', 'Врач: Тестовый Врач. Дата: 01.01.2000')] });

test('extracts only structural description and conclusion; excludes header and signature', () => {
  const blocks = new ReportBlockExtractor().extract(doc());
  assert.match(blocks.description, /L4-L5/);
  assert.match(blocks.conclusion, /Грыжа/);
  assert.doesNotMatch(JSON.stringify(blocks), /Тестовый|01\.01\.2000/);
});
test('ambiguous, reordered and flat documents are blocked', () => {
  const extractor = new ReportBlockExtractor();
  assert.throws(() => extractor.extract({ type: 'doc', content: [p('Описание'), p('Заключение')] }));
  const changed = doc(); changed.content[2].attrs.id = 'signature';
  assert.throws(() => extractor.extract(changed));
});
test('template placeholders and conflicting sides, levels and sizes are found', () => {
  const blocks = { description: 'На уровне L4-L5 справа грыжа 5 мм. [[Заполнить]]', conclusion: 'На уровне L5-S1 слева грыжа 7 мм.' };
  assert.equal(new TemplateValidator().validate(blocks).length, 1);
  assert.deepEqual(new ConsistencyEngine().validate(blocks).map(x=>x.category).sort(), ['level','side','size']);
});
test('consistent synthetic report has no false findings', async () => {
  assert.deepEqual((await new ReviewEngine().review(doc())).suggestions, []);
});
test('privacy check blocks personal data inside allowed blocks without logging it', async () => {
  const original = console.log; const logs=[]; console.log=(...args)=>logs.push(args.join(' '));
  try { await assert.rejects(new ReviewEngine().review(doc('Пациент: Секретов Иван.', 'Без изменений.'))); }
  finally { console.log=original; }
  assert.equal(logs.length, 0);
  assert.throws(()=>new PrivacyGuard().preview({description:'Дата рождения: 01.01.2000',conclusion:'Норма'}));
});
test('accept, reject, stale source and tab isolation', () => {
  const tracks=new TrackChangesEngine();
  const s={id:'one',operation:'replace',blockId:'description',original:'справа',proposed:'слева',explanation:'Проверить сторону',category:'side',priority:'high',from:0,to:6,state:'pending'};
  tracks.set('tab-a',[s]);tracks.set('tab-b',[{...s,id:'two'}]);
  const blocks={description:'справа',conclusion:'Без изменений'};
  assert.deepEqual(tracks.accept('tab-a','one',blocks),{...blocks,description:'слева'});
  assert.equal(blocks.description,'справа');
  assert.throws(()=>tracks.accept('tab-a','one',blocks));
  assert.throws(()=>tracks.accept('tab-b','two',{...blocks,description:'слева'}),/устарела/);
  tracks.reject('tab-b','two');
  assert.equal(tracks.list('tab-b')[0].state,'rejected');
  assert.equal(tracks.list('tab-a')[0].state,'accepted');
});
test('insert and delete affect only the allowed copy; comments never edit', () => {
  const tracks = new TrackChangesEngine();
  const blocks = { description: 'Очаг.', conclusion: 'Очаг.' };
  const base = { explanation:'Тест', category:'test', priority:'low', state:'pending' };
  tracks.set('tab', [
    { ...base, id:'insert', operation:'insert', blockId:'description', original:'', proposed:' малый', from:4, to:4 },
    { ...base, id:'delete', operation:'delete', blockId:'conclusion', original:'Очаг', proposed:'', from:0, to:4 },
    { ...base, id:'comment', operation:'comment', blockId:'description', original:'Очаг', proposed:'', from:0, to:4 },
  ]);
  assert.equal(tracks.accept('tab','insert',blocks).description,'Очаг малый.');
  assert.equal(tracks.accept('tab','delete',blocks).conclusion,'.');
  assert.throws(()=>tracks.accept('tab','comment',blocks));
  assert.deepEqual(blocks,{description:'Очаг.',conclusion:'Очаг.'});
});
test('no network activity, including cloud provider stub', async () => {
  const original=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('network');};
  try { await new ReviewEngine().review(doc()); await assert.rejects(new CloudAIProvider().review({description:'Норма',conclusion:'Норма'})); }
  finally { globalThis.fetch=original; }
  assert.equal(calls,0);
});
