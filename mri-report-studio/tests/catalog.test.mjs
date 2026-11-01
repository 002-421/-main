import assert from 'node:assert/strict';
import test from 'node:test';
import { areas, reportTemplates, reportBlocks, makeTemplateDocument, PATIENT_FIELD_ID, DOCTOR_FIELD_ID, DEFAULT_TEMPLATE_ID } from '../src/catalog.ts';
import { validateTemplate } from '../src/model.ts';
import { collectInlineFields, prepareInlineDocument } from '../src/inline-fields.ts';
import { initializeReportFooter } from '../src/report-footer.ts';
import { highlightDeletionNotes } from '../src/table-layout.ts';

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
        if (cell.type === 'paragraph') {
          const highlightedNote = (cell.attrs?.fontSizePt ?? 0) === 10 && cell.content?.some(child => child.marks?.some(mark => mark.type === 'highlight' && mark.attrs?.color === '#ffff00'));
          assert.ok((cell.attrs?.fontSizePt ?? 9) <= 9 || highlightedNote, template.title);
        }
        for (let index = 1; index < (cell.content ?? []).length; index++) {
          assert.ok(!(cell.content[index - 1].type === 'hardBreak' && cell.content[index].type === 'hardBreak'), template.title);
        }
      });
    });
  }
});

test('templates default to Arial 12 and separate conclusion and recommendations', () => {
  for (const template of reportTemplates) {
    const doc = makeTemplateDocument(template.id);
    assert.equal(doc.attrs.fontFamily, 'Arial', template.title);
    assert.equal(doc.attrs.fontSizePt, 12, template.title);
    const check = (node, inTable = false) => {
      const table = inTable || node.type === 'table';
      if (node.type === 'paragraph' || node.type === 'heading') {
        assert.equal(node.attrs.fontFamily, 'Arial', template.title);
        const highlightedNote = node.attrs.fontSizePt === 10 && node.content?.some(child => child.marks?.some(mark => mark.type === 'highlight' && mark.attrs?.color === '#ffff00'));
        assert.ok(node.attrs.fontSizePt === (table ? 9 : 12) || highlightedNote, template.title);
      }
      for (const mark of node.marks ?? []) if (mark.type === 'textStyle') {
        assert.equal(mark.attrs.fontFamily, 'Arial', template.title);
        const highlighted = node.marks?.some(candidate => candidate.type === 'highlight' && candidate.attrs?.color === '#ffff00');
        assert.ok(mark.attrs.fontSize === (table ? '12px' : '16px') || highlighted && mark.attrs.fontSize === '13.333px', template.title);
      }
      node.content?.forEach(child => check(child, table));
      for (let index = 0; index < (node.content ?? []).length; index++) {
        const child = node.content[index];
        const text = plain(child).trim();
        if (child.type === 'paragraph' && (/^(?:Рекоменд|Рекоменду)/i.test(text) || /^Заключение\s*:?/i.test(text))) {
          assert.equal(node.content[index - 1]?.type, 'paragraph', `${template.title}: section separator`);
          assert.equal(plain(node.content[index - 1]), '', `${template.title}: section separator`);
        }
      }
    };
    check(doc);
  }
});

test('removal notes are italic, 10 pt and highlighted yellow', () => {
  const deletionNotes = [];
  for (const template of reportTemplates) walk(makeTemplateDocument(template.id), node => {
    if (node.type !== 'paragraph') return;
    const text = plain(node).trim();
    if (/(?:нужно\s+)?удалять\s*!?/i.test(text) || /^По структуре, выделяют 4 типа молочных жел[её]з \(по Wolfe\)/i.test(text) || /^Тип\s*[1-4]\s*:/i.test(text)) deletionNotes.push({ template: template.title, node, text });
  });
  assert.ok(deletionNotes.length >= 8);
  for (const { template, node, text } of deletionNotes) {
    assert.equal(node.attrs.fontSizePt, 10, `${template}: ${text}`);
    const runs = [];
    walk(node, child => { if (child.type === 'text') runs.push(child); });
    assert.ok(runs.length > 0, `${template}: ${text}`);
    for (const run of runs) {
      assert.ok(run.marks.some(mark => mark.type === 'italic'), `${template}: ${text}`);
      assert.ok(run.marks.some(mark => mark.type === 'highlight' && mark.attrs?.color === '#ffff00'), `${template}: ${text}`);
      assert.ok(run.marks.some(mark => mark.type === 'textStyle' && mark.attrs?.fontSize === '13.333px'), `${template}: ${text}`);
    }
  }
});

test('all non-footer notes after the physician line are marked for deletion', () => {
  let styledParagraphs = 0;
  for (const template of reportTemplates) {
    const doc = makeTemplateDocument(template.id);
    const physician = doc.content.findIndex(node => node.type === 'paragraph' && plain(node).includes('Врач:')
      && node.content?.some(child => child.marks?.some(mark => mark.type === 'templateField' && mark.attrs?.id.endsWith('.reportdate'))));
    if (physician < 0) continue;
    const check = node => {
      const text = plain(node).trim();
      if (/^(?:Данное заключение не является диагнозом|Исследование выполнено на магнитно-резонансном томографе)/i.test(text)) return;
      if (node.type === 'paragraph' && text) {
        styledParagraphs++;
        assert.equal(node.attrs.fontSizePt, 10, `${template.title}: ${text}`);
        const runs = [];
        walk(node, child => { if (child.type === 'text') runs.push(child); });
        for (const run of runs) {
          assert.ok(run.marks.some(mark => mark.type === 'italic'), `${template.title}: ${text}`);
          assert.ok(run.marks.some(mark => mark.type === 'highlight' && mark.attrs?.color === '#ffff00'), `${template.title}: ${text}`);
        }
        return;
      }
      node.content?.forEach(check);
    };
    doc.content.slice(physician + 1).forEach(check);
  }
  assert.ok(styledParagraphs >= 20, `Expected post-signature notes; got ${styledParagraphs}`);
});

test('both age-specific alternatives are highlighted for choosing the matching norm', () => {
  const doc = makeTemplateDocument('head-gm');
  const paragraphs = [];
  walk(doc, node => { if (node.type === 'paragraph' && plain(node).includes('после 60 лет')) paragraphs.push(node); });
  assert.equal(paragraphs.length, 1);
  const paragraph = paragraphs[0];
  const markedRuns = paragraph.content.filter(node => node.marks?.some(mark => mark.type === 'highlight' && mark.attrs?.color === '#ffff00') && node.marks?.some(mark => mark.type === 'italic'));
  const marked = markedRuns.map(node => node.text ?? '').join('');
  assert.match(marked, /норма 18-22,1, после 60 лет 22,6-26,0/);
  assert.match(marked, /норма 24,0-26,3, после 50 лет - 28,2-29,4/);
  assert.ok(markedRuns.every(node => node.marks.some(mark => mark.type === 'textStyle' && mark.attrs.fontSize === '13.333px')));
});

test('patient-specific dimensions are highlighted while reference norms are left untouched', () => {
  const doc = highlightDeletionNotes({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Размеры 1,6x3,3 см, от 0,3 см до 0,0 см. Норма 0,5-0,8 см.' }] }] });
  const paragraph = doc.content[0];
  const highlighted = paragraph.content.filter(node => node.marks?.some(mark => mark.type === 'highlight' && mark.attrs?.color === '#ffff00')).map(node => node.text).join('');
  assert.equal(highlighted, '1,6x3,3 см0,3 см0,0 см');
  const norm = paragraph.content.filter(node => node.text?.includes('0,5-0,8 см'));
  assert.ok(norm.length > 0);
  assert.ok(norm.every(node => !node.marks?.some(mark => mark.type === 'highlight' && mark.attrs?.color === '#ffff00')));
});

test('male pelvis protocols include the restored PI-RADS reference image', () => {
  for (const id of ['pelvis-omt-m', 'pelvis-omt-m-ku']) {
    const doc = makeTemplateDocument(id);
    validateTemplate(doc);
    const imageIndex = doc.content.findIndex(node => node.type === 'image' && node.attrs?.alt === 'Справочная схема PI-RADS v2.1 (2019)');
    assert.ok(imageIndex > 0, `${id}: PI-RADS image`);
    assert.match(doc.content[imageIndex].attrs.src, /^data:image\/png;base64,/);
    assert.ok(plain(doc.content[imageIndex - 1]).includes('Справочная информация. Удалять!'));
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
