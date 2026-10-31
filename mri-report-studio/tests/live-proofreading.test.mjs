import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from '@tiptap/pm/model';
import { createProofreadingSnapshot, locateProofreadingIssue } from '../src/live-proofreading.ts';

const schema = new Schema({
  nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'inline*', group: 'block' }, text: { group: 'inline' }, hardBreak: { group: 'inline', inline: true }, reportField: { group: 'inline', inline: true, atom: true } },
  marks: { bold: {}, templateField: { attrs: { id: {}, filled: { default: false } } } },
});
const text = (value, marks) => schema.text(value, marks);
const paragraph = (...values) => schema.node('paragraph', null, values);
const issue = (start, end, value) => ({ start, end, text: value, kind: 'spelling', id: 'a', message: 'test', suggestions: [] });

test('live checker excludes placeholder hints and safely maps real inline field text', () => {
  const doc = schema.node('doc', null, [paragraph(text('Описание: '), text('Неизменённая подсказка', [schema.mark('templateField', { id: 'a', filled: false })]), text('Иследование', [schema.mark('templateField', { id: 'b', filled: true })]))]);
  const snapshot = createProofreadingSnapshot(doc);
  assert.equal(snapshot.text, 'Описание: \nИследование');
  assert.ok(!snapshot.text.includes('подсказка'));
  const start = snapshot.text.indexOf('Иследование');
  const mapped = locateProofreadingIssue(snapshot, issue(start, start + 11, 'Иследование'));
  assert.equal(doc.textBetween(mapped.from, mapped.to), 'Иследование');
});

test('live checker combines formatted fragments but refuses paragraph and atom boundary fixes', () => {
  const doc = schema.node('doc', null, [paragraph(text('Иследо', [schema.mark('bold')]), text('вание'), schema.node('reportField'), text('после')), paragraph(text('следующий'))]);
  const snapshot = createProofreadingSnapshot(doc);
  assert.equal(snapshot.text, 'Иследование\nпосле\nследующий');
  const mapped = locateProofreadingIssue(snapshot, issue(0, 11, 'Иследование'));
  assert.deepEqual({ from: mapped.from, to: mapped.to }, { from: 1, to: 12 });
  assert.equal(locateProofreadingIssue(snapshot, issue(0, 15, 'bad')), null);
  assert.equal(locateProofreadingIssue(snapshot, issue(12, snapshot.text.length, 'bad')), null);
  assert.equal(locateProofreadingIssue(snapshot, issue(-1, 2, 'bad')), null);
});
