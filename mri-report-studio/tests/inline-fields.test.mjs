import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareInlineDocument, resetInlineTemplate, promoteInlineTemplate, collectInlineFields, countUnchangedParts } from '../src/inline-fields.ts';

const legacy = () => ({ type: 'doc', content: [{ type: 'paragraph', content: [
  { type: 'text', text: 'Пациент: ' },
  { type: 'reportField', attrs: { id: 'patient', hint: 'Ф.И.О.', value: 'Частные данные' }, marks: [{ type: 'bold' }] },
  { type: 'text', text: '. Врач: ' },
  { type: 'reportField', attrs: { id: 'doctor', hint: 'Ф.И.О. врача', value: '' } },
] }] });

test('old fields become real editable text without losing patient data or formatting', () => {
  const original = legacy(), migrated = prepareInlineDocument(original);
  assert.equal(original.content[0].content[1].type, 'reportField');
  assert.equal(migrated.content[0].content[1].text, 'Частные данные');
  assert.ok(migrated.content[0].content[1].marks.some(m => m.type === 'bold'));
  assert.deepEqual(collectInlineFields(migrated).map(f => [f.id, f.value, f.filled]), [['patient', 'Частные данные', true], ['doctor', 'Ф.И.О. врача', false]]);
});

test('template reset removes patient values while preserving editable doctor field and formatting', () => {
  const reset = resetInlineTemplate(legacy());
  assert.ok(!JSON.stringify(reset).includes('Частные данные'));
  assert.deepEqual(collectInlineFields(reset).map(f => [f.value, f.filled]), [['Ф.И.О.', false], ['Ф.И.О. врача', false]]);
  assert.ok(reset.content[0].content[1].marks.some(m => m.type === 'bold'));
});

test('saving an edited template promotes rich split runs to one new prompt and can reset later values', () => {
  const doc = prepareInlineDocument(legacy());
  const mark = { type: 'templateField', attrs: { id: 'patient', hint: 'Ф.И.О.', original: 'Ф.И.О.', filled: true } };
  doc.content[0].content.splice(1, 1,
    { type: 'text', text: 'Новая ', marks: [structuredClone(mark), { type: 'bold' }] },
    { type: 'text', text: 'подсказка', marks: [structuredClone(mark)] });
  const template = promoteInlineTemplate(doc);
  assert.equal(collectInlineFields(template)[0].hint, 'Новая подсказка');
  assert.equal(collectInlineFields(template)[0].filled, false);
  const reset = resetInlineTemplate(template);
  assert.equal(collectInlineFields(reset)[0].value, 'Новая подсказка');
  assert.equal(collectInlineFields(reset).length, 2);
});

test('unchanged audit tracks ordinary template paragraphs as well as prompts', () => {
  const doc = prepareInlineDocument({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Стандартная формулировка.' }] },
    { type: 'paragraph', content: [{ type: 'reportField', attrs: { id: 'a', hint: 'Заполнить', value: '' } }] },
  ] });
  assert.equal(countUnchangedParts(doc), 2);
  doc.content[0].content[0].text = 'Изменённая формулировка.';
  assert.equal(countUnchangedParts(doc), 1);
});
