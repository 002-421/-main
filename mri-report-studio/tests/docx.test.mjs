import test from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
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
