import assert from 'node:assert/strict';
import test from 'node:test';
import { areas, reportTemplates, reportBlocks, makeTemplateDocument, PATIENT_FIELD_ID, DOCTOR_FIELD_ID, DEFAULT_TEMPLATE_ID } from '../src/catalog.ts';
import { validateTemplate } from '../src/model.ts';
import { collectInlineFields, prepareInlineDocument } from '../src/inline-fields.ts';

function walk(node, callback) { callback(node); node.content?.forEach(child => walk(child, callback)); }
function plain(node) { return (node.text ?? '') + (node.content ?? []).map(plain).join(''); }
function visible(node) { return node.type === 'reportField' ? `⟦${node.attrs.hint}⟧` : (node.text ?? '') + (node.content ?? []).map(visible).join(''); }

test('catalog contains the six archive zones and all imported protocols', () => {
  assert.deepEqual(areas.map(a => a.title), [
    'Брюшная полость и забрюшинное пространство', 'Голова', 'Малый таз', 'Остальные', 'Позвоночник', 'Суставы',
  ]);
  assert.equal(reportTemplates.length, 55);
  for (const area of areas) assert.ok(reportTemplates.some(t => t.areaId === area.id));
  assert.equal(reportBlocks.length, 13);
  assert.equal(makeTemplateDocument().attrs.templateId, DEFAULT_TEMPLATE_ID);
});

test('source protocols preserve wording and have editable unique fields', () => {
  for (const template of reportTemplates) {
    const doc = makeTemplateDocument(template.id);
    validateTemplate(doc);
    const fields = collectInlineFields(prepareInlineDocument(doc));
    assert.equal(new Set(fields.map(f => f.id)).size, fields.length, template.title);
    assert.ok(fields.every(f => !f.filled), template.title);
    assert.ok(doc.content.length > 0);
    const copy = makeTemplateDocument(template.id);
    doc.content.length = 0;
    assert.ok(copy.content.length > 0, template.title);
  }
  assert.throws(() => makeTemplateDocument('missing'), /не найден/);
});

test('default head protocol retains editable patient and doctor fields and omits age and clinical goal', () => {
  const doc = makeTemplateDocument(DEFAULT_TEMPLATE_ID);
  const fields = collectInlineFields(prepareInlineDocument(doc));
  assert.ok(fields.some(f => f.id.endsWith('.patient')));
  assert.ok(fields.some(f => f.id === DOCTOR_FIELD_ID));
  assert.doesNotMatch(plain(doc), /возраст пациента|полных лет|клиническ(?:ая|ие) (?:цель|сведения)/i);
});

test('archive slash alternatives are yellow editable report text', () => {
  const doc = makeTemplateDocument(DEFAULT_TEMPLATE_ID);
  const highlights = [];
  walk(doc, node => { for (const mark of node.marks ?? []) if (mark.type === 'highlight') highlights.push(node.text ?? ''); });
  assert.ok(highlights.length > 0);
  assert.ok(highlights.some(value => value.includes('/')));
});
