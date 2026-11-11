import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { history, undo, redo } from '@tiptap/pm/history';
import { applyReviewSuggestion, resolveReviewRange } from '../src/ai-review-editor.ts';
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
  section('description',paragraph('Очаг справа 5 мм.',true)),
  section('conclusion',paragraph('Очаг справа 5 мм.')),
  section('signature',paragraph('Врач: Тестовый')),
]);
function editor(initial=document()) {
  let state=EditorState.create({doc:initial,plugins:[history()]});
  return { get state(){return state}, view:{dispatch(tr){state=state.apply(tr)}}, commands:{setTextSelection(){},focus(){}} };
}
const suggestion = (original, proposed, from, to) => ({ id:'one', operation:'replace', blockId:'description', original, proposed, explanation:'Тест', category:'spelling', priority:'low', from, to, state:'pending' });

test('one explicit acceptance changes only description and remains undoable with formatting', () => {
  const e=editor();const blocks=new ReportBlockExtractor().extract(e.state.doc.toJSON());
  const before=e.state.doc.toJSON();const s=suggestion('справа','слева',5,11);
  assert.deepEqual(resolveReviewRange(e,s,blocks),{from:28,to:34});
  applyReviewSuggestion(e,s,blocks);
  assert.match(e.state.doc.toJSON().content[1].content[0].content[0].text,/слева/);
  assert.deepEqual(e.state.doc.toJSON().content[0],before.content[0]);
  assert.deepEqual(e.state.doc.toJSON().content[3],before.content[3]);
  assert.deepEqual(e.state.doc.toJSON().content[1].content[0].content[0].marks,[{type:'bold'}]);
  assert.equal(undo(e.state,tr=>e.view.dispatch(tr)),true);
  assert.deepEqual(e.state.doc.toJSON(),before);
  assert.equal(redo(e.state,tr=>e.view.dispatch(tr)),true);
  assert.match(e.state.doc.textContent,/слева/);
});

test('stale source and cross-node ranges are rejected; rejection leaves document unchanged', () => {
  const e=editor();const blocks=new ReportBlockExtractor().extract(e.state.doc.toJSON());
  const tracks=new TrackChangesEngine();const s=suggestion('справа','слева',5,11);
  tracks.set('a',[s]);tracks.set('b',[{...s,id:'two'}]);
  tracks.reject('a','one');
  const before=e.state.doc.toJSON();
  assert.equal(tracks.list('a')[0].state,'rejected');
  assert.equal(tracks.list('b')[0].state,'pending');
  assert.deepEqual(e.state.doc.toJSON(),before);
  e.view.dispatch(e.state.tr.insertText('иной текст',resolveReviewRange(e,s,blocks).from,resolveReviewRange(e,s,blocks).to));
  assert.throws(()=>applyReviewSuggestion(e,s,blocks));
});

test('six category filters work with synthetic mock findings without network', async () => {
  const original=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('network')};
  try {
    const doc=document().toJSON();const provider=new MockAIProvider([{operation:'replace',blockId:'description',original:'справа',proposed:'слева',explanation:'Тест',category:'spelling',priority:'low',from:5,to:11}]);
    const none=await new ReviewEngine(provider).review(doc,new Set(['punctuation']));
    const selected=await new ReviewEngine(provider).review(doc,new Set(['spelling']));
    assert.equal(none.suggestions.length,0);
    assert.equal(selected.suggestions.length,1);
  } finally {globalThis.fetch=original}
  assert.equal(calls,0);
});
