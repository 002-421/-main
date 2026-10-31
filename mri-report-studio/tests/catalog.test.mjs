import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { areas, reportTemplates, reportBlocks, makeTemplateDocument, PATIENT_FIELD_ID, DOCTOR_FIELD_ID, templatePage } from '../src/catalog.ts';
import { collectFields } from '../src/model.ts';

function walk(node, callback) { callback(node); node.content?.forEach(child => walk(child, callback)); }
function text(node) { return (node.text ?? '') + (node.content ?? []).map(text).join(''); }
function visible(node) { return node.type === 'reportField' ? `⟦${node.attrs.hint}⟧` : (node.text ?? '') + (node.content ?? []).map(visible).join(''); }

// Read the source OPC XML independently: the source has Word content controls,
// so normal python-docx paragraph.text would accidentally omit all entry text.
async function sourceXML(name) {
  const bytes = new Uint8Array(await readFile(new URL(`../../mri-templates/${name}`, import.meta.url)));
  return strFromU8(unzipSync(bytes)['word/document.xml']);
}

test('catalog reproduces delivered Word page profile and real source control identities', async () => {
  const doc = makeTemplateDocument('brain');
  const xml = await sourceXML('MRI_Head_Base.docx');
  const originalText = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map(match => match[1].replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name])).join('')
    .replace('Дата рождения / возраст', 'Дата рождения')
    .replace(' / ⟦полных лет⟧', '')
    .replace('Клинические сведения / цель⟦жалобы, анамнез, клинический вопрос⟧', '');
  assert.equal(visible(doc), originalText, 'Every source word and field hint must remain in its original order');
  assert.equal(doc.attrs.sourceFormat, 'alliance-template');
  assert.equal(templatePage.fontFamily, 'DejaVu Sans');
  assert.equal(templatePage.fontSizePt, 10);
  assert.equal(templatePage.marginTopMm, 16);
  assert.equal(templatePage.marginLeftMm, 18);
  const fields = collectFields(doc);
  assert.equal(fields.length, 43);
  assert.ok(fields.some(f => f.id === PATIENT_FIELD_ID && f.hint === 'Ф.И.О.'));
  assert.ok(fields.some(f => f.id === DOCTOR_FIELD_ID && f.hint === 'Ф.И.О.'));
  for (const field of fields) {
    assert.ok(xml.includes(`w:val="${field.id}"`));
    assert.ok(xml.includes(`⟦${field.hint.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}⟧`));
    assert.equal(field.value, '');
  }
  assert.ok(!fields.some(f => /полных лет|жалобы, анамнез/.test(f.hint)));
  assert.doesNotMatch(text(doc), /Дата рождения \/ возраст|Клинические сведения \/ цель/);
});

test('base retains original section wording, two-page boundary, typography and table widths', () => {
  const doc = makeTemplateDocument('brain');
  const labels = [];
  walk(doc, node => { if (node.type === 'heading') labels.push(text(node)); });
  assert.deepEqual(labels, ['ДАННЫЕ ИССЛЕДОВАНИЯ', 'МЕТОДИКА', 'ОПИСАНИЕ • ГОЛОВНОЙ МОЗГ', 'ЖЕЛУДОЧКОВАЯ СИСТЕМА', 'ЛИКВОРНЫЕ ПРОСТРАНСТВА И ПРИЛЕЖАЩИЕ СТРУКТУРЫ', 'ДОПОЛНИТЕЛЬНЫЕ БЛОКИ • ПРИ НАЛИЧИИ', 'ЗАКЛЮЧЕНИЕ', 'РЕКОМЕНДАЦИИ И ПОДПИСЬ']);
  const titles = [], pageBreaks = [], tables = [];
  walk(doc, node => {
    if (node.attrs?.sourceStyle === 'Title') titles.push(node);
    if (node.attrs?.pageBreakBefore) pageBreaks.push(node);
    if (node.type === 'table') tables.push(node);
  });
  assert.equal(titles.length, 2);
  assert.equal(titles[0].attrs.fontSizePt, 21);
  assert.equal(titles[0].attrs.fontFamily, 'Calibri', 'Word theme overrides the literal DejaVu heading font');
  assert.equal(titles[0].content[0].marks.find(m => m.type === 'textStyle').attrs.fontFamily, 'Calibri');
  assert.equal(titles[0].type, 'paragraph');
  assert.equal(pageBreaks.length, 1);
  assert.equal(pageBreaks[0], titles[1]);
  assert.equal(tables[0].content.length, 5);
  assert.ok(Math.abs(tables[0].content[0].content[0].attrs.colwidth[0] - 204.06667) < 0.001);
  assert.equal(tables[0].content[0].content[0].content[0].attrs.spaceBeforePt, 3);
  const method = doc.content.find(n => n.attrs?.id === 'method');
  assert.equal(method.content[0].attrs.fontFamily, 'Calibri');
  assert.equal(method.content[1].attrs.fontFamily, 'DejaVu Sans');
});

test('all areas have templates with unique blank fields and clones are independent', () => {
  for (const area of areas) assert.ok(reportTemplates.some(t => t.areaId === area.id));
  for (const template of reportTemplates) {
    const doc = makeTemplateDocument(template.id);
    const fields = collectFields(doc);
    assert.equal(new Set(fields.map(f => f.id)).size, fields.length);
    assert.ok(fields.every(f => f.value === ''));
    const copy = makeTemplateDocument(template.id);
    doc.content.length = 0;
    assert.ok(copy.content.length > 0);
  }
  assert.throws(() => makeTemplateDocument('missing'), /не найден/);
});

test('isolated vascular and regional protocols omit uninvolved brain description and merge conclusions once', () => {
  for (const id of ['arteries', 'veins', 'pituitary', 'orbits', 'sinuses']) {
    const doc = makeTemplateDocument(id);
    assert.ok(!doc.content.some(n => n.attrs?.id === 'brain'));
    assert.equal(doc.content.filter(n => n.attrs?.id === 'conclusion').length, 1);
    assert.doesNotMatch(text(doc), /ОПИСАНИЕ • ГОЛОВНОЙ МОЗГ|Основа блока:|КАК РАБОТАТЬ С ШАБЛОНОМ/);
  }
  const combo = makeTemplateDocument('brain-vessels');
  assert.ok(combo.content.some(n => n.attrs?.id === 'M02'));
  assert.ok(combo.content.some(n => n.attrs?.id === 'M03'));
  const conclusions = combo.content.find(n => n.attrs?.id === 'conclusion');
  const hints = collectFields(conclusions).map(f => f.hint);
  assert.ok(hints.some(h => h.includes('Основные сосудистые находки')));
  assert.ok(hints.some(h => h.includes('Вывод о выявленных венозных изменениях')));
  assert.equal(reportBlocks.length, 13);
});
