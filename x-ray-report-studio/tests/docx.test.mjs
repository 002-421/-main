import test from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { readFile } from 'node:fs/promises';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { exportDocx, importOwnDocx, recoverDocx, DOCX_MIME } from '../src/docx.ts';
import { makeDocument, collectFields, builtinModules, moduleNode, insertModule } from '../src/model.ts';
import { makeTemplateDocument, reportTemplates } from '../src/catalog.ts';
import { initializeReportFooter } from '../src/report-footer.ts';
import { attachDoctorStamp } from '../src/doctor-stamp.ts';

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
  assert.match(xml, /<w:body><w:p>/);
  assert.match(xml, /<w:pgMar(?=[^>]*w:top="2438")/);
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

test('male pelvis Word templates embed the PI-RADS reference image and retain it in editable state', async () => {
  const doc = makeTemplateDocument('pelvis-omt-m-ku');
  const { zip, xml } = await exported(doc, { templateId: 'pelvis-omt-m-ku' });
  assert.ok(Object.keys(zip).some(name => /^word\/media\/.*\.png$/.test(name)));
  assert.match(xml, /<w:drawing>/);
  const imported = await importOwnDocx(zipSync(zip));
  assert.ok(imported);
  assert.ok(imported.doc.content.some(node => node.type === 'image' && node.attrs?.alt === 'Справочная схема PI-RADS v2.1 (2019)'));
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

test('Word text edits are imported while the original template identity and document metadata survive', async () => {
  const doc = { type: 'doc', attrs: { sourceFormat: 'alliance-template', pageWidthMm: 210 }, content: [p('До изменения'), p('Второй абзац')] };
  const first = await exported(doc, { kind: 'template', templateId: 'head-gm' });
  first.zip['word/document.xml'] = strToU8(first.xml.replace('До изменения', 'Изменено в Word'));
  const imported = await importOwnDocx(zipSync(first.zip));
  assert.equal(imported.kind, 'template'); assert.equal(imported.templateId, 'head-gm'); assert.equal(imported.doc.attrs.pageWidthMm, 210);
  assert.match(JSON.stringify(imported.doc), /Изменено в Word/); assert.equal(imported.editedInWord, true);
});

test('Word import round-trips paragraph changes, tables, formatting and yellow highlights repeatedly', async () => {
  const cell = (text, type = 'tableCell') => ({ type, content: [p(text)] });
  const doc = { type: 'doc', attrs: { sourceFormat: 'alliance-template' }, content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Заголовок', marks: [{ type: 'bold' }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Первый абзац', marks: [{ type: 'italic' }] }, { type: 'text', text: ' выделен', marks: [{ type: 'highlight', attrs: { color: '#ffff00' } }] }] },
    p('Второй абзац'), { type: 'table', content: [{ type: 'tableRow', content: [cell('Ячейка 1', 'tableHeader'), cell('Ячейка 2')] }] },
  ] };
  const source = await exported(doc, { kind: 'template', templateId: 'head-gm' });
  source.zip['word/document.xml'] = strToU8(source.xml.replace('Второй абзац', 'Исправленный абзац'));
  let imported = await importOwnDocx(zipSync(source.zip));
  assert.match(JSON.stringify(imported.doc), /Исправленный абзац/);
  assert.ok(imported.doc.content.some(node => node.type === 'table'));
  const text = JSON.stringify(imported.doc); assert.match(text, /italic/); assert.match(text, /highlight/);
  const once = structuredClone(imported.doc), paragraphCount = once.content.filter(node => node.type === 'paragraph').length;
  const second = await exported(imported.doc, { kind: 'template', templateId: imported.templateId });
  imported = await importOwnDocx(second.blob);
  assert.deepEqual(imported.doc, once); assert.equal(imported.doc.content.filter(node => node.type === 'paragraph').length, paragraphCount);
  assert.equal(imported.templateId, 'head-gm');
});

test('template placeholder identity survives Word splitting its visible marker across text runs', async () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'reportField', attrs: { id: 'stable-field-id', hint: 'Имя пациента', value: '' } }] }] };
  const source = await exported(doc, { kind: 'template', templateId: 'head-gm' });
  source.zip['word/document.xml'] = strToU8(source.xml.replace('⟦Имя пациента⟧', '⟦Имя</w:t></w:r><w:r><w:t> пациента⟧'));
  const imported = await importOwnDocx(zipSync(source.zip));
  const field = imported.doc.content[0].content.find(node => node.type === 'reportField');
  assert.equal(field.attrs.id, 'stable-field-id'); assert.equal(field.attrs.hint, 'Имя пациента');
});

test('Word import honors removal of yellow highlighting instead of treating all pale fills as yellow', async () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Вариант', marks: [{ type: 'highlight', attrs: { color: '#ffff00' } }] }] }] };
  const source = await exported(doc, { kind: 'template', templateId: 'head-gm' });
  source.zip['word/document.xml'] = strToU8(source.xml.replace('w:fill="FFFF00"', 'w:fill="FFFFFF"'));
  const imported = await importOwnDocx(zipSync(source.zip));
  assert.doesNotMatch(JSON.stringify(imported.doc), /highlight/);
});

test('Word style-only edits are imported with a warning instead of restoring stale metadata silently', async () => {
  const second = await exported(makeDocument(), { kind: 'template', templateId: 'head-gm' });
  second.zip['word/styles.xml'] = strToU8(strFromU8(second.zip['word/styles.xml']).replace('Arial', 'Georgia'));
  const imported = await importOwnDocx(zipSync(second.zip));
  assert.equal(imported.editedInWord, true); assert.ok(imported.importWarnings.length); assert.deepEqual(imported.doc, makeDocument());
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

test('Word content is recoverable with a preview candidate when Studio metadata is missing or damaged', async () => {
  const doc={type:'doc',content:[p('Пациент: Учебный'),p('Описание: текст'),p('Заключение: норма')]};
  const {zip,xml}=await exported(doc,{kind:'report',templateId:'head-gm'});
  const edited={...zip,'word/document.xml':strToU8(xml.replace('Описание: текст','Описание: исправленный текст'))};
  delete edited[STATE_PART];
  assert.equal(await importOwnDocx(zipSync(edited)),null);
  const recovered=await recoverDocx(zipSync(edited));
  assert.match(JSON.stringify(recovered.doc),/Учебный|исправленный текст|Заключение: норма/);
  assert.ok(recovered.warnings.length);
  edited[STATE_PART]=strToU8('<corrupt/>');
  await assert.rejects(importOwnDocx(zipSync(edited)),/Повреждены/);
  assert.match(JSON.stringify((await recoverDocx(zipSync(edited))).doc),/исправленный текст/);
  await assert.rejects(recoverDocx(new Uint8Array([1,2,3])),/Не удалось прочитать/);
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
  assert.match(xml, /<w:pgMar(?=[^>]*w:top="2438")(?=[^>]*w:right="1020")(?=[^>]*w:bottom="907")(?=[^>]*w:left="1020")/);
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
  const footerXml = strFromU8(footer[1]);
  assert.match(footerXml, /Данное заключение не является диагнозом и должно быть интерпретировано лечащим врачом/);
  assert.match(footerXml, /Исследование выполнено на магнитно-резонансном томографе Philips Achieva с высокой напряженностью магнитного поля 1,5 Тесла/);
  assert.match(footerXml, /PAGE/);
  assert.equal((footerXml.match(/<w:jc w:val="center"\/>/g) ?? []).length, 2);
  assert.match(footerXml, /<w:jc w:val="right"\/>/);
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

test('source template physician and date sit at opposite sides of the signature line', async () => {
  const doc = initializeReportFooter(makeTemplateDocument('head-gm'), '03.11.2026');
  const { xml } = await exported(doc, { templateId: 'head-gm' });
  const doctorText = xml.indexOf('Врач:');
  const signature = xml.slice(xml.lastIndexOf('<w:tbl>', doctorText), xml.indexOf('</w:tbl>', doctorText) + 8);
  assert.match(signature, /<w:gridCol w:w="[0-9]+"\/><w:gridCol w:w="[0-9]+"\/>/);
  assert.match(signature, /<w:jc w:val="left"\/>/);
  assert.match(signature, /Дата:/);
  assert.match(signature, /03\.11\.2026/);
});

test('CT physician and date print on one line at opposite sides like MRI reports', async () => {
  const template = reportTemplates.find(item => item.id.startsWith('ct-'));
  const doc = initializeReportFooter(makeTemplateDocument(template.id), '04.11.2026');
  const { xml } = await exported(doc, { templateId: template.id });
  const row = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g)?.find(value => value.includes('Врач-рентгенолог:') && value.includes('Дата:'));
  assert.ok(row, template.title);
  assert.match(row, /<w:gridCol w:w="[0-9]+"\/><w:gridCol w:w="[0-9]+"\/>/);
  assert.match(row, /<w:jc w:val="left"\/>/);
  assert.doesNotMatch(row, /дата:/);
  assert.match(row, /Дата:/);
  assert.match(row, /04\.11\.2026/);
});

test('template export retains the footer when editor document attrs are absent', async () => {
  const doc = makeTemplateDocument('head-gm');
  delete doc.attrs.sourceFormat;
  const { xml, zip } = await exported(doc, { templateId: 'head-gm' });
  const footer = Object.entries(zip).find(([name]) => /^word\/footer\d+\.xml$/.test(name));
  assert.ok(footer);
  assert.match(strFromU8(footer[1]), /Данное заключение не является диагнозом/);
  assert.match(strFromU8(footer[1]), /Исследование выполнено на магнитно-резонансном томографе/);
  assert.match(strFromU8(footer[1]), /PAGE/);
  assert.match(xml, /<w:footerReference w:type="default"/);
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
  const imported = await importOwnDocx(zipSync(zip));
  assert.ok(imported.importWarnings.length);
});

test('line spacing selected in the editor overrides a source paragraph baseline in Word', async () => {
  const doc = { type: 'doc', attrs: { sourceFormat: 'alliance-template' }, content: [{
    type: 'paragraph', attrs: { lineHeight: 1.05, sourceStyle: 'Normal' },
    content: [{ type: 'text', text: 'Изменённый интервал', marks: [{ type: 'textStyle', attrs: { lineHeight: '1.5' } }] }],
  }] };
  const { xml } = await exported(doc);
  assert.match(xml, /w:line="360" w:lineRule="auto"/);
});

test('a doctor stamp image is embedded between physician and date paragraphs', async () => {
  const stamp='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW+0AAAAASUVORK5CYII=';
  const doc={type:'doc',content:[p('Врач-рентгенолог: Иванов Иван Иванович'),{type:'image',attrs:{src:stamp,alt:'Подпись и печать врача',width:100,height:40}},p('Дата: 04.11.2026')]};
  const {zip,xml}=await exported(doc);
  assert.ok(Object.keys(zip).some(name => /^word\/media\/.*\.png$/.test(name)));
  assert.match(xml,/w:drawing/);
  assert.ok(xml.indexOf('Врач-рентгенолог')<xml.indexOf('w:drawing'));
  assert.ok(xml.indexOf('w:drawing')<xml.indexOf('Дата:'));
});

test('doctor stamp stays inside the physician column behind the footer without adding vertical space', async () => {
  const stamp='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW+0AAAAASUVORK5CYII=';
  const source={type:'doc',content:[p('Врач-рентгенолог: Иванов Иван Иванович'),p('Дата: 04.11.2026')]};
  const document=attachDoctorStamp(source,{'Иванов Иван Иванович':stamp},{'Иванов Иван Иванович':{width:1177,height:422}},{},{'Иванов Иван Иванович':{x:25,y:-15}});
  const {xml}=await exported(document);
  assert.match(xml,/<wp:anchor/);
  assert.match(xml,/<wp:anchor[^>]*behindDoc="1"/);
  assert.match(xml,/<wp:wrapNone\/>/);
  assert.match(xml,/<wp:posOffset>\d+<\/wp:posOffset>/);
  assert.match(xml,/<wp:posOffset>-142875<\/wp:posOffset>/);
  assert.ok(xml.indexOf('Врач-рентгенолог')<xml.indexOf('wp:anchor'));
  assert.ok(xml.indexOf('wp:anchor')<xml.indexOf('Дата:'));
  assert.equal((xml.match(/<wp:anchor\b/g)||[]).length,1);
});
