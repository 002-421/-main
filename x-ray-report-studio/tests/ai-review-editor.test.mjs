import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { history, undo, redo } from '@tiptap/pm/history';
import { applyReviewSuggestion, resolveReviewRange, isSafeReviewReplacement } from '../src/ai-review-editor.ts';
import { ReportBlockExtractor, TrackChangesEngine, ReviewEngine, MockAIProvider } from '../src/ai-review.ts';

const schema = new Schema({ nodes: {
  doc: { content:'reportSection+' },
  reportSection: { content:'paragraph+', group:'block', attrs:{ id:{default:''} } },
  paragraph: { content:'text*', group:'block' },
  text: { group:'inline' },
}, marks: { bold: {} } });
const paragraph = (text, bold=false) => schema.nodes.paragraph.create(null, [schema.text(text, bold ? [schema.marks.bold.create()] : [])]);
const section = (id, p) => schema.nodes.reportSection.create({id}, [p]);
const document = () => schema.nodes.doc.create(null, [
  section('header',paragraph('Пациент: Тестовый')),
  section('description',paragraph('Ошибкка в тексте.',true)),
  section('conclusion',paragraph('Ошибкка в тексте.')),
  section('signature',paragraph('Врач: Тестовый')),
]);
function editor(initial=document()) {
  let state=EditorState.create({doc:initial,plugins:[history()]});
  return { get state(){return state}, view:{dispatch(tr){state=state.apply(tr)}}, commands:{setTextSelection(){},focus(){}} };
}
const suggestion = (original, proposed, from, to) => ({ id:'one', operation:'replace', blockId:'description', original, proposed, explanation:'Тест', category:'spelling', priority:'low', from, to, state:'pending' });

test('one explicit acceptance changes only description and remains undoable with formatting', () => {
  const e=editor();const blocks=new ReportBlockExtractor().extract(e.state.doc.toJSON());
  const before=e.state.doc.toJSON();const s=suggestion('Ошибкка','Ошибка',0,7);
  assert.deepEqual(resolveReviewRange(e,s,blocks),{from:23,to:30});
  applyReviewSuggestion(e,s,blocks);
  assert.match(e.state.doc.toJSON().content[1].content[0].content[0].text,/Ошибка/);
  assert.deepEqual(e.state.doc.toJSON().content[0],before.content[0]);
  assert.deepEqual(e.state.doc.toJSON().content[3],before.content[3]);
  assert.deepEqual(e.state.doc.toJSON().content[1].content[0].content[0].marks,[{type:'bold'}]);
  assert.equal(undo(e.state,tr=>e.view.dispatch(tr)),true);
  assert.deepEqual(e.state.doc.toJSON(),before);
  assert.equal(redo(e.state,tr=>e.view.dispatch(tr)),true);
  assert.match(e.state.doc.textContent,/Ошибка/);
});

test('stale source and cross-node ranges are rejected; rejection leaves document unchanged', () => {
  const e=editor();const blocks=new ReportBlockExtractor().extract(e.state.doc.toJSON());
  const tracks=new TrackChangesEngine();const s=suggestion('Ошибкка','Ошибка',0,7);
  tracks.set('a',[s]);tracks.set('b',[{...s,id:'two'}]);
  tracks.reject('a','one');
  const before=e.state.doc.toJSON();
  assert.equal(tracks.list('a')[0].state,'rejected');
  assert.equal(tracks.list('b')[0].state,'pending');
  assert.deepEqual(e.state.doc.toJSON(),before);
  e.view.dispatch(e.state.tr.insertText('иной текст',resolveReviewRange(e,s,blocks).from,resolveReviewRange(e,s,blocks).to));
  assert.throws(()=>applyReviewSuggestion(e,s,blocks));
});

test('one transaction replaces text across formatting runs, preserving neighbours and Undo/Redo',()=>{
  const mixed=schema.nodes.paragraph.create(null,[schema.text('Ошиб',[schema.marks.bold.create()]),schema.text('кка'),schema.text(' в'),schema.text(' тексте.',[schema.marks.bold.create()])]);
  const doc=document();const parts=[...doc.content.content];parts[1]=section('description',mixed);
  const e=editor(schema.nodes.doc.create(null,parts));
  const blocks=new ReportBlockExtractor().extract(e.state.doc.toJSON()),before=e.state.doc.toJSON();
  const s=suggestion('Ошибкка','Ошибка',0,7);
  assert.throws(()=>applyReviewSuggestion(e,s,blocks,'tab-a','tab-b'),/другая вкладка/);
  applyReviewSuggestion(e,s,blocks,'tab-a','tab-a');
  const after=e.state.doc.toJSON(),runs=after.content[1].content[0].content;
  assert.equal(e.state.doc.content.child(1).textContent,'Ошибка в тексте.');
  assert.equal(runs.map(run=>run.text).join(''),'Ошибка в тексте.');
  assert.ok(runs.find(run=>run.text==='Ошибка')?.marks?.some(mark=>mark.type==='bold'),'replacement inherits the format at its start');
  assert.ok(!runs.find(run=>run.text===' в')?.marks?.some(mark=>mark.type==='bold'),'following plain text keeps its formatting');
  assert.ok(runs.find(run=>run.text===' тексте.')?.marks?.some(mark=>mark.type==='bold'),'following bold text keeps its formatting');
  assert.deepEqual(after.content[0],before.content[0]);assert.deepEqual(after.content[3],before.content[3]);
  assert.equal(undo(e.state,tr=>e.view.dispatch(tr)),true);assert.deepEqual(e.state.doc.toJSON(),before);
  assert.equal(redo(e.state,tr=>e.view.dispatch(tr)),true);assert.equal(e.state.doc.content.child(1).textContent,'Ошибка в тексте.');
});

test('cross-paragraph ranges require manual editing',()=>{
  const doc=document(),parts=[...doc.content.content];parts[1]=schema.nodes.reportSection.create({id:'description'},[paragraph('Ошибкка'),paragraph('в тексте.')]);
  const e=editor(schema.nodes.doc.create(null,parts)),blocks=new ReportBlockExtractor().extract(e.state.doc.toJSON());
  const source='Ошибкка\nв тексте.';const s=suggestion(source,'Ошибка',0,source.length);
  assert.throws(()=>applyReviewSuggestion(e,s,blocks),/ручного редактирования/);
});

test('six category filters work with synthetic mock findings without network', async () => {
  const original=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('network')};
  try {
    const doc=document().toJSON();const provider=new MockAIProvider([{operation:'replace',blockId:'description',original:'Ошибкка',proposed:'Ошибка',explanation:'Тест',category:'spelling',priority:'low',from:0,to:7}]);
    const none=await new ReviewEngine(provider).review(doc,new Set(['punctuation']));
    const selected=await new ReviewEngine(provider).review(doc,new Set(['spelling']));
    assert.equal(none.suggestions.length,0);
    assert.equal(selected.suggestions.length,1);
  } finally {globalThis.fetch=original}
  assert.equal(calls,0);
});

test('AI replacement refuses lateralities, measurements, negation and clinical comments',()=>{
 const safe=suggestion('ошибкка','ошибка',0,8);
 assert.equal(isSafeReviewReplacement(safe),true);
 for(const word of ['справа','слева','правой','левой','не','не выявлено','отсутствует','L4-L5','5 мм','диагноз']){
  assert.equal(isSafeReviewReplacement({...safe,original:word,proposed:'исправлено'}),false,word);
  assert.equal(isSafeReviewReplacement({...safe,original:'ошибка',proposed:word}),false,word);
 }
 assert.equal(isSafeReviewReplacement({...safe,meaningRisk:true}),false);
 assert.equal(isSafeReviewReplacement({...safe,confidence:'limited'}),false);
 assert.equal(isSafeReviewReplacement({...safe,operation:'comment'}),false);
 assert.equal(isSafeReviewReplacement({...safe,original:'гипофис',proposed:'гипофиз',category:'terminology'}),false,'anatomical terms require manual review even when only one letter differs');
 assert.equal(isSafeReviewReplacement({...safe,original:'гипофиз',proposed:'гипоталамус',category:'style'}),false,'replacement cannot change anatomical localization');
 assert.equal(isSafeReviewReplacement({...safe,original:'слово ,',proposed:'слово,',category:'punctuation'}),true,'punctuation-only corrections can be explicitly accepted');
 assert.equal(isSafeReviewReplacement({...safe,original:'слово',proposed:'слова',category:'punctuation'}),false,'punctuation findings cannot replace words');
});

test('AI suggestions never replace text by direct confirmation when source range became stale',()=>{
 const e=editor(),blocks=new ReportBlockExtractor().extract(e.state.doc.toJSON());
 const s=suggestion('Ошибкка','изменено',0,7);
 e.view.dispatch(e.state.tr.insertText('исправлено',23,30));const before=e.state.doc.toJSON();
 assert.throws(()=>applyReviewSuggestion(e,s,blocks),/изменился|устарела/);
 assert.deepEqual(e.state.doc.toJSON(),before);
});

test('review maps exact text inside nested table cells without crossing cells',()=>{
 const tableSchema=new Schema({nodes:{doc:{content:'reportSection+'},reportSection:{content:'block+',attrs:{id:{default:''}}},paragraph:{group:'block',content:'text*'},table:{group:'block',content:'tableRow+'},tableRow:{content:'tableCell+'},tableCell:{content:'paragraph+'},text:{group:'inline'}}});
 const p=text=>tableSchema.nodes.paragraph.create(null,tableSchema.text(text));
 const section=(id,children)=>tableSchema.nodes.reportSection.create({id},children);
 const table=tableSchema.nodes.table.create(null,tableSchema.nodes.tableRow.create(null,[tableSchema.nodes.tableCell.create(null,p('Ошибкка')),tableSchema.nodes.tableCell.create(null,p('Тест'))]));
 const doc=tableSchema.nodes.doc.create(null,[section('header',p('Тест')),section('description',table),section('conclusion',p('Норма')),section('signature',p('Тест'))]);
 const e=editor(doc),blocks=new ReportBlockExtractor().extract(doc.toJSON());
 const range=resolveReviewRange(e,suggestion('Ошибкка','Ошибка',0,7),blocks);
 assert.equal(e.state.doc.textBetween(range.from,range.to),'Ошибкка');
 applyReviewSuggestion(e,suggestion('Ошибкка','Ошибка',0,7),blocks);
 assert.equal(e.state.doc.child(1).child(0).child(0).child(0).textContent,'Ошибка');
 assert.equal(e.state.doc.child(1).child(0).child(0).child(1).textContent,'Тест');
});
