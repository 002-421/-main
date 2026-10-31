import test from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { readFile } from 'node:fs/promises';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { exportDocx, importOwnDocx, DOCX_MIME } from '../src/docx.ts';
import { makeDocument, collectFields, builtinModules, moduleNode, insertModule } from '../src/model.ts';

const STATE_PART = 'customXml/mri-report-studio.xml';
const p = (text, attrs) => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content: [{ type: 'text', text }] });
async function exported(doc, options) {
  const blob = await exportDocx(doc, options);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const zip = unzipSync(bytes);
  return { blob, bytes, zip, xml: strFromU8(zip['word/document.xml']) };
}
function runWith(xml, text) {
  const result = [...xml.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)].find(match => match[1].includes(`>${text}</w:t>`));
  assert.ok(result, `Word run containing ${text}`);
  return result[1];
}
function rewriteMetadata(zip, change) {
  const state = strFromU8(zip[STATE_PART]);
  const encoded = /<mri:state encoding="base64">([^<]+)<\/mri:state>/.exec(state)[1];
  const value = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  change(value);
  zip[STATE_PART] = strToU8(state.replace(encoded, Buffer.from(JSON.stringify(value)).toString('base64')));
  return zipSync(zip);
}

test('Word export is an OPC ZIP with A4 pages, report content and resolvable custom XML relationships', async () => {
  const doc = makeDocument('orbits');
  const { blob, bytes, zip, xml } = await exported(doc, { profile: 'orbits', title: 'МРТ орбит — протокол' });
  assert.equal(blob.type, DOCX_MIME);
  assert.deepEqual([...bytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  for (const required of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'docProps/core.xml', STATE_PART]) assert.ok(zip[required], required);
  assert.match(xml, /<w:pgSz\b[^>]*w:w="11906"[^>]*w:h="16838"/);
  assert.match(xml, /МРТ орбит/);
  assert.match(xml, /Методика/);
  assert.match(xml, /Заключение/);
  assert.match(xml, /Рекомендации:/);
  assert.match(xml, /<w:pStyle w:val="Heading1"\/>/);
  assert.match(xml, /<w:tbl>/);
  assert.match(strFromU8(zip['docProps/core.xml']), /МРТ орбит — протокол/);
  const types = strFromU8(zip['[Content_Types].xml']);
  assert.match(types, /<Default(?=[^>]*Extension="xml")(?=[^>]*ContentType="application\/xml")[^>]*\/>/);
  assert.match(types, /PartName="\/customXml\/itemPropsMRI.xml" ContentType="application\/vnd\.openxmlformats-officedocument\.customXmlProperties\+xml"/);
  const relationships = strFromU8(zip['word/_rels/document.xml.rels']);
  const custom = /<Relationship\b[^>]*Type="[^"]*\/customXml"[^>]*Target="([^"]+)"/.exec(relationships);
  assert.ok(custom);
  assert.ok(zip[posix.normalize(posix.join('word', custom[1]))]);
  const props = strFromU8(zip['customXml/_rels/mri-report-studio.xml.rels']);
  assert.match(props, /Type="[^"]*\/customXmlProps" Target="itemPropsMRI.xml"/);
  assert.ok(zip['customXml/itemPropsMRI.xml']);
  assert.match(strFromU8(zip['word/styles.xml']), /w:ascii="Arial"/);
});

test('Word runs preserve typography and line spacing while filled fields have no colored field background', async () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [
    { type: 'text', text: 'Формат', marks: [
      { type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'strike' },
      { type: 'textStyle', attrs: { fontFamily: 'Times New Roman', fontSize: '16px', color: '#1a2b3c', lineHeight: '1.5' } },
      { type: 'highlight', attrs: { color: '#c8f7dc' } },
    ] },
    { type: 'reportField', attrs: { id: 'patient', hint: 'Имя пациента', value: 'Иванов Иван' }, marks: [{ type: 'bold' }, { type: 'highlight', attrs: { color: '#ff0000' } }] },
    { type: 'reportField', attrs: { id: 'empty', hint: 'Дата рождения', value: '' } },
  ] }] };
  const { xml } = await exported(doc);
  const styled = runWith(xml, 'Формат');
  for (const format of [/<w:b\/>/, /<w:i\/>/, /<w:u w:val="single"\/>/, /<w:strike\/>/, /w:ascii="Times New Roman"/, /<w:sz w:val="24"\/>/, /<w:color w:val="1A2B3C"\/>/, /w:fill="C8F7DC"/]) assert.match(styled, format);
  const filled = runWith(xml, 'Иванов Иван');
  assert.match(filled, /<w:b\/>/);
  assert.doesNotMatch(filled, /<w:(?:highlight|shd)\b/);
  assert.doesNotMatch(xml, /Имя пациента/);
  const empty = runWith(xml, '⟦Дата рождения⟧');
  assert.match(empty, /<w:highlight w:val="yellow"\/>/);
  assert.match(empty, /w:fill="FFF0A4"/);
  assert.match(xml, /<w:jc w:val="center"\/>/);
  assert.match(xml, /w:line="360" w:lineRule="auto"/);
});

test('table grids preserve resized columns, header cells and horizontal plus vertical merges', async () => {
  const cell = (text, attrs = {}, type = 'tableCell') => ({ type, attrs, content: [p(text)] });
  const doc = { type: 'doc', content: [{ type: 'table', content: [
    { type: 'tableRow', content: [cell('Шапка 1', { colspan: 2, rowspan: 1 }, 'tableHeader'), cell('Шапка 2', {}, 'tableHeader')] },
    { type: 'tableRow', content: [cell('Объединено', { colspan: 2, rowspan: 2, colwidth: [100, 200] }), cell('Право 1')] },
    { type: 'tableRow', content: [cell('Право 2')] },
  ] }] };
  const { xml } = await exported(doc);
  const grid = /<w:tblGrid>(.*?)<\/w:tblGrid>/.exec(xml)[1];
  const widths = [...grid.matchAll(/w:w="(\d+)"/g)].map(match => Number(match[1]));
  assert.equal(widths.length, 3);
  assert.equal(widths[1], 2 * widths[0]);
  assert.equal(widths.reduce((sum, value) => sum + value, 0), 10206);
  assert.match(xml, /<w:tblHeader\/>/);
  assert.match(xml, /w:fill="F1F4F8"/);
  const rows = [...xml.matchAll(/<w:tr>(.*?)<\/w:tr>/g)].map(match => match[1]);
  assert.equal(rows.length, 3);
  assert.equal([...rows[2].matchAll(/<w:tc>/g)].length, 2);
  assert.match(rows[1], /<w:gridSpan w:val="2"\/><w:vMerge w:val="restart"\/>/);
  assert.match(rows[2], /<w:gridSpan w:val="2"\/><w:vMerge w:val="continue"\/>/);
  assert.match(rows[2], /Право 2/);
});

test('lists produce real Word numbering with nested levels and separate start values; newlines and tabs are preserved', async () => {
  const item = (...content) => ({ type: 'listItem', content });
  const doc = { type: 'doc', content: [
    { type: 'orderedList', attrs: { start: 4 }, content: [item(p('Первый'), { type: 'bulletList', content: [item(p('Вложенный'))] }), item(p('Второй'))] },
    { type: 'orderedList', attrs: { start: 9 }, content: [item(p('Ещё список'))] },
    { type: 'paragraph', attrs: { textAlign: 'justify', lineHeight: '2' }, content: [{ type: 'reportField', attrs: { id: 'multiline', hint: 'Текст', value: 'Строка 1\nСтрока 2\tДалее' } }] },
  ] };
  const { xml, zip } = await exported(doc);
  const numbering = strFromU8(zip['word/numbering.xml']);
  assert.match(numbering, /<w:start w:val="4"\/>/);
  assert.match(numbering, /<w:start w:val="9"\/>/);
  assert.match(numbering, /<w:numFmt w:val="bullet"\/>/);
  assert.match(numbering, /<w:numFmt w:val="decimal"\/>/);
  assert.match(xml, /<w:ilvl w:val="1"\/>/);
  assert.equal([...xml.matchAll(/<w:numPr>/g)].length, 4);
  assert.match(xml, /<w:br\/>/);
  assert.match(xml, /<w:tab\/>/);
  assert.match(xml, /<w:jc w:val="both"\/>/);
  assert.match(xml, /w:line="480" w:lineRule="auto"/);
});

test('own DOCX restores fields, rich JSON, modules, custom library, cached module edits and template marker', async () => {
  let doc = makeDocument('pituitary');
  const existingField = collectFields(doc)[0];
  function fill(node) {
    if (node.type === 'reportField' && node.attrs.id === existingField.id) node.attrs.value = 'Петров Пётр <тест> & 123';
    node.content?.forEach(fill);
  }
  fill(doc);
  doc.content[0].content[0].content[0].marks = [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#1a2b3c' } }];
  const library = [{ id: 'CUSTOM1', title: 'Мой раздел', sections: [{ paragraphs: ['Признак: [[значение]].'] }], custom: true }];
  const extra = moduleNode(library[0]);
  doc = insertModule(doc, extra.body, extra.conclusion);
  const cached = moduleNode(builtinModules.find(module => module.id === 'M02'));
  cached.body.content.push(p('Сохранённая ручная правка'));
  const options = { profile: 'pituitary', customModules: library, cache: { M02: cached }, kind: 'template' };
  const { blob } = await exported(doc, options);
  const result = await importOwnDocx(blob);
  assert.deepEqual(result.doc, doc);
  assert.equal(result.profile, 'pituitary');
  assert.equal(result.kind, 'template');
  assert.deepEqual(result.customModules, library);
  assert.deepEqual(result.cache, options.cache);
});

test('external Word edits and style edits cannot silently restore stale Studio state', async () => {
  const first = await exported({ type: 'doc', content: [p('До изменения')] });
  first.zip['word/document.xml'] = strToU8(first.xml.replace('До изменения', 'Изменено в Word'));
  await assert.rejects(importOwnDocx(zipSync(first.zip)), /изменён в Word/);
  const second = await exported(makeDocument());
  second.zip['word/styles.xml'] = strToU8(strFromU8(second.zip['word/styles.xml']).replace('Arial', 'Georgia'));
  await assert.rejects(importOwnDocx(zipSync(second.zip)), /Форматирование или структура/);
});

test('foreign DOCX returns null and corrupt or malformed Studio state is rejected', async () => {
  const { zip } = await exported(makeDocument());
  const foreign = { ...zip };
  delete foreign[STATE_PART];
  assert.equal(await importOwnDocx(zipSync(foreign)), null);
  await assert.rejects(importOwnDocx(new Uint8Array([0, 1, 2, 3])), /Не удалось прочитать/);
  const malformed = { ...zip, [STATE_PART]: strToU8('<not-a-studio-state/>') };
  await assert.rejects(importOwnDocx(zipSync(malformed)), /Повреждены/);
  await assert.rejects(importOwnDocx(rewriteMetadata({ ...zip }, metadata => { metadata.draft.doc = { type: 'no-document' }; })), /не поддерживаемый файл/);
  await assert.rejects(importOwnDocx(rewriteMetadata({ ...zip }, metadata => { metadata.draft.cache = { M02: { body: { type: 'paragraph' } } }; })), /Некорректный сохранённый модуль/);
});

test('source template profile retains exact page geometry, title styles, spacing, table grid and page break', async () => {
  const attrs = {
    sourceFormat: 'alliance-template', pageWidthMm: 210, pageHeightMm: 297,
    marginTopMm: 16, marginBottomMm: 16, marginLeftMm: 18, marginRightMm: 18,
    fontFamily: 'DejaVu Sans', fontSizePt: 10, lineHeight: 1.05, spaceAfterPt: 5,
  };
  const cell = (text, width) => ({ type: 'tableCell', attrs: { colwidth: [width / 15] }, content: [p(text, { sourceStyle: 'Normal', spaceBeforePt: 3, spaceAfterPt: 3 })] });
  const doc = { type: 'doc', attrs, content: [
    p('МРТ ГОЛОВЫ', { sourceStyle: 'Title', fontSizePt: 21, lineHeight: 1, spaceBeforePt: 9, spaceAfterPt: 5, keepNext: true }),
    p('Протокол исследования', { sourceStyle: 'Subtitle', fontSizePt: 11, keepNext: true }),
    { type: 'heading', attrs: { level: 2, sourceStyle: 'Heading2', fontSizePt: 10, spaceBeforePt: 9, spaceAfterPt: 5 }, content: [{ type: 'text', text: 'ДАННЫЕ ИССЛЕДОВАНИЯ' }] },
    { type: 'table', content: [{ type: 'tableRow', content: [cell('Пациент', 3061), cell('Имя пациента', 6803)] }] },
    p('Описание', { sourceStyle: 'Normal' }),
    p('МРТ ГОЛОВЫ', { sourceStyle: 'Title', fontSizePt: 21, pageBreakBefore: true }),
  ] };
  const { xml, zip, blob } = await exported(doc);
  assert.match(xml, /<w:pgMar(?=[^>]*w:top="907")(?=[^>]*w:right="1020")(?=[^>]*w:bottom="907")(?=[^>]*w:left="1020")/);
  assert.match(xml, /<w:pStyle w:val="Title"\/>/);
  assert.match(xml, /<w:pStyle w:val="Subtitle"\/>/);
  assert.match(xml, /<w:pStyle w:val="Heading2"\/>/);
  assert.match(xml, /<w:pageBreakBefore\/>/);
  assert.match(xml, /w:line="252" w:lineRule="auto"/);
  assert.match(xml, /<w:tblGrid><w:gridCol w:w="3061"\/><w:gridCol w:w="6803"\/><\/w:tblGrid>/);
  assert.match(xml, /<w:tblW w:type="dxa" w:w="9864"\/>/);
  assert.match(xml, /<w:tblInd w:type="dxa" w:w="-113"\/>/);
  assert.match(xml, /<w:spacing(?=[^>]*w:before="60")(?=[^>]*w:after="60")/);
  const styles = strFromU8(zip['word/styles.xml']);
  assert.match(styles, /w:ascii="DejaVu Sans"/);
  assert.match(runWith(xml, 'МРТ ГОЛОВЫ'), /w:ascii="Calibri"/);
  assert.match(styles, /<w:bottom w:val="single" w:color="4F81BD" w:sz="8" w:space="4"\/>/);
  assert.match(styles, /<w:sz w:val="42"\/>/);
  const footer = Object.entries(zip).find(([name]) => /^word\/footer\d+\.xml$/.test(name));
  assert.ok(footer);
  assert.match(strFromU8(footer[1]), /МРТ головы • v1.0/);
  assert.match(strFromU8(footer[1]), /PAGE/);
  assert.match(strFromU8(footer[1]), /<w:spacing(?=[^>]*w:after="0")(?=[^>]*w:line="240")/);
  assert.deepEqual((await importOwnDocx(blob)).doc, doc);
});

test('editable inline fields export user values as ordinary Word text and retain only untouched hint highlights', async () => {
  const field = (id, hint, filled) => ({ type: 'templateField', attrs: { id, hint, original: hint, filled } });
  const doc = { type: 'doc', content: [{ type: 'paragraph', attrs: { templateOriginal: 'Врач: Ф.И.О.' }, content: [
    { type: 'text', text: 'Врач: ' },
    { type: 'text', text: 'Смирнова Анна', marks: [field('doctor', 'Ф.И.О.', true), { type: 'bold' }, { type: 'highlight', attrs: { color: '#ff0000' } }] },
    { type: 'text', text: 'Дата исследования', marks: [field('date', 'Дата исследования', false)] },
  ] }] };
  const { xml, blob } = await exported(doc, { templateId: 'brain-contrast' });
  assert.doesNotMatch(xml, /Ф.И.О./);
  assert.match(runWith(xml, 'Смирнова Анна'), /<w:b\/>/);
  assert.doesNotMatch(runWith(xml, 'Смирнова Анна'), /<w:(?:highlight|shd)\b/);
  assert.match(runWith(xml, 'Дата исследования'), /<w:highlight w:val="yellow"\/>/);
  assert.doesNotMatch(xml, /templateOriginal|templateField/);
  const restored = await importOwnDocx(blob);
  assert.deepEqual(restored.doc, doc);
  assert.equal(restored.templateId, 'brain-contrast');
});

test('source font faces are embedded with Word font relationships and cannot be modified behind embedded draft metadata', async () => {
  const dir = new URL('../src/assets/fonts/', import.meta.url);
  const font = {
    name: 'DejaVu Sans',
    data: new Uint8Array(await readFile(new URL('DejaVuSans.ttf', dir))),
    bold: new Uint8Array(await readFile(new URL('DejaVuSans-Bold.ttf', dir))),
    italic: new Uint8Array(await readFile(new URL('DejaVuSans-Oblique.ttf', dir))),
    boldItalic: new Uint8Array(await readFile(new URL('DejaVuSans-BoldOblique.ttf', dir))),
  };
  const doc = { type: 'doc', attrs: { sourceFormat: 'alliance-template' }, content: [p('Описание с исходным шрифтом')] };
  const { zip, blob } = await exported(doc, { fonts: [font] });
  const parts = Object.keys(zip).filter(name => name.endsWith('.odttf'));
  assert.equal(parts.length, 4);
  const table = strFromU8(zip['word/fontTable.xml']);
  for (const face of ['Regular', 'Bold', 'Italic', 'BoldItalic']) assert.match(table, new RegExp(`<w:embed${face}\\b`));
  assert.match(strFromU8(zip['word/settings.xml']), /<w:embedTrueTypeFonts\/>/);
  assert.deepEqual((await importOwnDocx(blob)).doc, doc);
  zip[parts[0]][100] ^= 1;
  await assert.rejects(importOwnDocx(zipSync(zip)), /Форматирование или структура/);
});

test('line spacing selected in the editor overrides a source paragraph baseline in Word', async () => {
  const doc = { type: 'doc', attrs: { sourceFormat: 'alliance-template' }, content: [{
    type: 'paragraph', attrs: { lineHeight: 1.05, sourceStyle: 'Normal' },
    content: [{ type: 'text', text: 'Изменённый интервал', marks: [{ type: 'textStyle', attrs: { lineHeight: '1.5' } }] }],
  }] };
  const { xml } = await exported(doc);
  assert.match(xml, /w:line="360" w:lineRule="auto"/);
});
