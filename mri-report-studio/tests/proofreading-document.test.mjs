import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { proofreadingSnapshot, proofreadingTarget } from '../src/proofreading-document.ts';

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' }, paragraph: { content: 'inline*', group: 'block' },
    text: { group: 'inline' }, hardBreak: { inline: true, group: 'inline' },
    reportField: { inline: true, group: 'inline', atom: true, attrs: { id: {}, value: { default: '' }, hint: { default: '' } } },
  },
  marks: { bold: {} },
});
const paragraph = (...content) => schema.node('paragraph', null, content);
const txt = (value, bold = false) => schema.text(value, bold ? [schema.mark('bold')] : undefined);

test('proofreading skips empty prompts and maps multiline field values without destroying atoms', () => {
  const doc = schema.node('doc', null, [paragraph(txt('Описание: '), schema.node('reportField', { id: 'empty', hint: 'Подсказка с ошиббкой' }), schema.node('reportField', { id: 'filled', value: 'Очаг очаг\nне выявлен' }), txt(' Заключение.'))]);
  const snapshot = proofreadingSnapshot(doc);
  assert.ok(!snapshot.text.includes('ошиббкой'));
  const start = snapshot.text.indexOf('Очаг очаг');
  const target = proofreadingTarget(snapshot, { start, end: start + 'Очаг очаг'.length });
  assert.equal(target.field.attrs.id, 'filled');
  assert.equal(target.start, 0);
  const state = EditorState.create({ schema, doc });
  const fixed = state.apply(state.tr.setNodeMarkup(target.pos, undefined, { ...target.field.attrs, value: 'Очаг\nне выявлен' })).doc;
  assert.equal(fixed.child(0).child(2).attrs.value, 'Очаг\nне выявлен');
  assert.equal(fixed.child(0).child(1).attrs.hint, 'Подсказка с ошиббкой');
});

test('corrections spanning differently formatted text preserve the first mark and following text', () => {
  const doc = schema.node('doc', null, [paragraph(txt('Иследо', true), txt('вание без изменений.'))]);
  const snapshot = proofreadingSnapshot(doc);
  const target = proofreadingTarget(snapshot, { start: 0, end: 'Иследование'.length });
  assert.deepEqual(target, { from: 1, to: 12 });
  const state = EditorState.create({ schema, doc });
  const fixed = state.apply(state.tr.insertText('Исследование', target.from, target.to)).doc;
  assert.equal(fixed.textContent, 'Исследование без изменений.');
  assert.equal(fixed.child(0).child(0).marks[0].type.name, 'bold');
});

test('proofreading cannot replace across fields or paragraphs', () => {
  const doc = schema.node('doc', null, [paragraph(txt('До'), schema.node('reportField', { id: 'a', value: 'Очаг' }), txt('После')), paragraph(txt('Далее'))]);
  const snapshot = proofreadingSnapshot(doc);
  assert.equal(snapshot.text, 'До\nОчаг\nПосле\nДалее');
  assert.equal(proofreadingTarget(snapshot, { start: 0, end: 6 }), null);
  assert.equal(proofreadingTarget(snapshot, { start: 8, end: snapshot.text.length }), null);
  assert.equal(proofreadingTarget(snapshot, { start: -1, end: 2 }), null);
});
