import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync, strFromU8 } from 'fflate';
import { areas, reportTemplates, makeTemplateDocument } from '../src/catalog.ts';
import { separateRecommendations } from '../src/table-layout.ts';
import { INITIAL_TEMPLATE_VERSION, nextTemplateVersion, readTemplateVersions, templateVersion, writeTemplateVersion } from '../src/template-versioning.ts';
import { sanitizeTemplateForExport } from '../src/template-sanitizer.ts';
import { exportTemplateDocx, inspectTemplateDocx } from '../src/template-docx.ts';

const walk = (node, fn) => { fn(node); node.content?.forEach(child => walk(child, fn)); };
const plain = node => (node.text ?? '') + (node.content ?? []).map(plain).join('');
class Store {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}

test('all 113 built-in MRI/CT templates use 11 pt without changing template counts', () => {
  assert.equal(reportTemplates.length, 113);
  assert.equal(areas.filter(area => area.id.startsWith('ct-')).length, 8);
  for (const template of reportTemplates) {
    const doc = makeTemplateDocument(template.id);
    assert.equal(doc.attrs.fontSizePt, 11, template.id);
    walk(doc, node => {
      if (node.type === 'paragraph' || node.type === 'heading') assert.equal(node.attrs.fontSizePt, 11, `${template.id}: ${plain(node).slice(0, 50)}`);
      if (node.marks?.some(mark => mark.type === 'textStyle')) assert.equal(node.marks.find(mark => mark.type === 'textStyle').attrs.fontSize, '14.66667px', template.id);
    });
  }
});

test('the eight Review v8 spine templates retain approved labels, five field IDs and yellow measurements', () => {
  const alternatives = new Map([
    ['spine-shop', 31], ['spine-shop-m', 31], ['spine-shop-art', 33],
    ['spine-gop', 33], ['spine-gop-m', 33], ['spine-pop', 42], ['spine-pop-m', 42],
    ['spine-kkop', 2],
  ]);
  const headings = ['Дорзальные/-ая экструзии/-я дисков/-а:', 'Дорзальные/-ая протрузии/-я дисков/-а:'];
  assert.deepEqual(reportTemplates.filter(template => template.areaId === 'spine').map(template => template.id).sort(), [...alternatives.keys()].sort());
  for (const [id, expectedMeasurements] of alternatives) {
    const doc = makeTemplateDocument(id), fieldIds = [], found = [];
    let measurements = 0;
    walk(doc, node => {
      if (node.type !== 'text') return;
      for (const mark of node.marks ?? []) if (mark.type === 'templateField') fieldIds.push(mark.attrs.id);
      if (headings.includes(node.text)) {
        found.push(node.text);
        assert.ok(node.marks?.some(mark => mark.type === 'bold'), id);
        assert.ok(!node.marks?.some(mark => mark.type === 'highlight' && mark.attrs.color === '#ffff00'), id);
      }
      const prompts = [...node.text.matchAll(/(?<![\d,])0,0(?![\d,])/g)].length;
      if (prompts) assert.ok(node.marks?.some(mark => mark.type === 'highlight' && mark.attrs.color === '#ffff00'), id);
      measurements += prompts;
    });
    assert.deepEqual(fieldIds, [
      `${id}.number`, `${id}.patient`, `${id}.birthdate`, 'HEAD.BASE.2.FIELD.0043', `${id}.reportdate`,
    ], `${id}: original editable field IDs and order`);
    assert.deepEqual(found, id === 'spine-kkop' ? [] : headings, `${id}: approved alternative labels`);
    assert.equal(measurements, expectedMeasurements, `${id}: editable yellow measurements`);
  }
});

test('recommendation paragraphs receive 12 pt external spacing without inserted blank paragraphs', () => {
  const sample = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Описание' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Рекомендована консультация невролога.' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Рекомендуется контроль через 6 месяцев.' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Конец.' }] },
  ] };
  const spaced = separateRecommendations(sample);
  assert.equal(spaced.content.length, sample.content.length);
  assert.equal(spaced.content[1].attrs.spaceBeforePt, 12);
  assert.equal(spaced.content[1].attrs.spaceAfterPt, 0);
  assert.equal(spaced.content[2].attrs.spaceBeforePt, 0);
  assert.equal(spaced.content[2].attrs.spaceAfterPt, 12);
  for (const template of reportTemplates) {
    walk(makeTemplateDocument(template.id), node => {
      if (node.type !== 'paragraph' || !/^\s*(?:Рекоменд|Рекоменду)/iu.test(plain(node))) return;
      assert.equal(node.attrs.fontSizePt, 11, template.id);
      assert.equal(node.attrs.spaceBeforePt, 12, template.id);
    });
  }
});

test('service notices are removed from template body while footer settings remain', () => {
  for (const template of reportTemplates) {
    const doc = makeTemplateDocument(template.id);
    let serviceParagraphs = 0;
    walk(doc, node => { if (node.type === 'paragraph' && /^(?:Данное заключение не является диагнозом|Исследование выполнено на магнитно-резонансном томографе)/iu.test(plain(node).trim())) serviceParagraphs++; });
    assert.equal(serviceParagraphs, 0, template.id);
    assert.equal(doc.attrs?.footerText, template.doc.attrs?.footerText, template.id);
  }
});

test('template version starts at 0.0.1 and increments only when explicitly changed', () => {
  const storage = new Store();
  assert.equal(templateVersion(storage, 'head-gm'), '0.0.1');
  assert.equal(INITIAL_TEMPLATE_VERSION, '0.0.1');
  assert.equal(nextTemplateVersion('0.0.1'), '0.0.2');
  assert.equal(nextTemplateVersion('2.4.9'), '2.4.10');
  assert.deepEqual(readTemplateVersions(storage), {});
  writeTemplateVersion(storage, 'head-gm', '0.0.2');
  assert.equal(templateVersion(storage, 'head-gm'), '0.0.2');
  assert.throws(() => nextTemplateVersion('bad'), /Некорректная версия/);
});

test('template-package export replaces patient and physician identity with highlighted neutral placeholders', async () => {
  const template = {
    id: 'synthetic-template', title: 'Синтетический', areaId: 'head', templateVersion: '0.0.1',
    doc: { type: 'doc', attrs: { templateId: 'synthetic-template' }, content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Врач-рентгенолог: Иванова Мария Петровна дата: 17.11.2026' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Ф.И.О. пациента: Сидоров Алексей Павлович' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Дата рождения: 04.05.1980' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Протокол исследования № 12345' }] },
      { type: 'paragraph', content: [{ type: 'reportField', attrs: { id: 'synthetic.patient', hint: 'Ф.И.О.', value: 'Сидоров Алексей Павлович' } }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Нормальный текст.' }] },
    ] },
  };
  const clean = sanitizeTemplateForExport(template.doc);
  const cleanText = plain(clean);
  assert.match(cleanText, /Врач: Ф\.И\.О\./u);
  assert.match(cleanText, /дд\.мм\.гггг/u);
  assert.match(cleanText, /номер исследования/u);
  assert.doesNotMatch(cleanText, /Иванова Мария|Сидоров Алексей|17\.11\.2026|04\.05\.1980|12345/u);
  const physician = clean.content[0];
  assert.ok(physician.content.some(node => node.marks?.some(mark => mark.type === 'highlight' && mark.attrs.color === '#ffff00')));
  const blob = await exportTemplateDocx(template, '0.4.73');
  const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const combined = Object.entries(zip).filter(([name]) => name !== 'word/document.xml').map(([, bytes]) => strFromU8(bytes)).join('\n');
  assert.doesNotMatch(combined, /Иванова Мария|Сидоров Алексей|17\.11\.2026|04\.05\.1980|12345/u);
  const row = await inspectTemplateDocx(blob, [template]);
  assert.equal(row.status, 'unchanged');
  assert.equal(row.exportedTemplateVersion, '0.0.1');
});
