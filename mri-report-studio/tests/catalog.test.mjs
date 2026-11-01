import assert from 'node:assert/strict';
import test from 'node:test';
import { areas, reportTemplates, reportBlocks, makeTemplateDocument, PATIENT_FIELD_ID, DOCTOR_FIELD_ID, DEFAULT_TEMPLATE_ID } from '../src/catalog.ts';
import { validateTemplate } from '../src/model.ts';
import { collectInlineFields, prepareInlineDocument } from '../src/inline-fields.ts';
import { initializeReportFooter } from '../src/report-footer.ts';

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

test('all protocol templates separate the closing block and fill its date automatically', () => {
  for (const template of reportTemplates) {
    const doc = initializeReportFooter(prepareInlineDocument(makeTemplateDocument(template.id)), '03.11.2026');
    const physician = doc.content.findIndex(node => node.type === 'paragraph' && plain(node).includes('Врач:') && node.content?.some(child => child.marks?.some(mark => mark.type === 'templateField' && mark.attrs?.id.endsWith('.reportdate'))));
    assert.ok(physician >= 0, template.title);
    assert.equal(doc.content[physician - 1].type, 'paragraph');
    assert.equal(plain(doc.content[physician - 1]), '');
    assert.doesNotMatch(plain(doc), /Данное заключение не является диагнозом|Исследование выполнено на магнитно-резонансном томографе/);
    const date = doc.content[physician].content.find(node => node.marks?.some(mark => mark.type === 'templateField' && mark.attrs?.id.endsWith('.reportdate')));
    assert.equal(date.text, '03.11.2026', template.title);
    assert.equal(date.marks.find(mark => mark.type === 'templateField').attrs.filled, true, template.title);
  }
});

test('tables in every template use compact widths, cell text and line breaks', () => {
  for (const template of reportTemplates) {
    const doc = makeTemplateDocument(template.id);
    walk(doc, node => {
      if (node.type !== 'table') return;
      const firstRow = node.content.find(child => child.type === 'tableRow');
      const widths = firstRow.content.flatMap(cell => cell.attrs?.colwidth ?? []);
      assert.ok(widths.reduce((sum, value) => sum + value, 0) <= 640, template.title);
      walk(node, cell => {
        if (cell.type === 'paragraph') assert.ok((cell.attrs?.fontSizePt ?? 9) <= 9, template.title);
        for (let index = 1; index < (cell.content ?? []).length; index++) {
          assert.ok(!(cell.content[index - 1].type === 'hardBreak' && cell.content[index].type === 'hardBreak'), template.title);
        }
      });
    });
  }
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

test('numeric dimensions and indices use Russian decimal commas while dates keep dots', () => {
  const text = reportTemplates.map(t => visible(t.doc)).join('\n');
  assert.match(text, /22,6-26,0/);
  assert.match(text, /28,2-29,4/);
  assert.match(text, /1,5 Тесла/);
  assert.match(text, /дд\.мм\.гггг/);
  assert.doesNotMatch(text, /22\.6-26\.0|28\.2-29\.4|1\.5 Тесла/);
  assert.match(text, /размерами - 0,0 см/);
  const yellowZeros=[];
  for(const template of reportTemplates)walk(template.doc,node=>{if(node.type==='text'&&node.text==='0,0'&&node.marks?.some(mark=>mark.type==='highlight'&&mark.attrs?.color==='#ffff00'))yellowZeros.push(node);});
  assert.ok(yellowZeros.length>0);
  for(const template of reportTemplates)walk(template.doc,node=>{
    if(node.type!=='paragraph')return;
    const paragraph=visible(node);
    for(const match of paragraph.matchAll(/\bсм(?:²|2)?\b/gi)) assert.match(paragraph.slice(0,match.index),/\d(?:,\d+)?\s*$/,`${template.title}: missing centimetre value in ${paragraph}`);
    assert.doesNotMatch(paragraph.replace(/\d{1,2}\.\d{1,2}\.\d{4}/g,''),/(?<!\d)\d+\.\d+(?!\d)/,`${template.title}: decimal period remains in ${paragraph}`);
  });
});
