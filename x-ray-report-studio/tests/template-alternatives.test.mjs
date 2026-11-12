import test from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, unzipSync, zipSync, strToU8 } from 'fflate';
import { makeTemplateDocument, reportTemplates } from '../src/catalog.ts';
import { brainAlternativeGroups, confirmedAlternativeGroups, highlightBrainAlternatives } from '../src/template-alternatives.ts';
import { exportDocx, importOwnDocx } from '../src/docx.ts';

const visible = node => node.text ?? (node.type === 'reportField' ? node.attrs?.hint ?? '' : (node.content ?? []).map(visible).join(''));
const ids = node => [node.type === 'reportField' ? node.attrs?.id : null, ...(node.content ?? []).flatMap(ids)].filter(Boolean);
const yellow = node => (node.content ?? []).filter(child => child.marks?.some(mark => mark.type === 'highlight' && mark.attrs?.color === '#ffff00')).length;

test('all 113 templates retain text, field identities and ordering after alternative marking', () => {
  assert.equal(reportTemplates.length, 113);
  for (const template of reportTemplates) {
    const doc = makeTemplateDocument(template.id), again = highlightBrainAlternatives(doc, template.id);
    assert.equal(visible(again), visible(doc), template.id);
    assert.deepEqual(ids(again), ids(doc), template.id);
    assert.deepEqual(again, doc, `${template.id}: marking is idempotent`);
  }
});

test('three convexital descriptions and other confirmed brain variants are all yellow, unlike unrelated structures', () => {
  const doc = makeTemplateDocument('head-gm');
  const group = brainAlternativeGroups(doc, 'head-gm').find(item => item.structure.startsWith('конвекситальные'));
  assert.equal(group.indices.length, 3);
  for (const index of group.indices) assert.ok(yellow(doc.content[index]) > 0, `paragraph ${index}`);
  const unrelated = doc.content.find(node => visible(node).startsWith('Срединные структуры не смещены'));
  assert.equal(yellow(unrelated), 0);
  assert.equal(brainAlternativeGroups(makeTemplateDocument('head-mra-gm'), 'head-mra-gm').length, 0);
  const knee = makeTemplateDocument('joints-ks');
  const kneeGroup = confirmedAlternativeGroups(knee, 'joints-ks').find(item => item.structure.includes('мениска'));
  assert.equal(kneeGroup.indices.length, 2);
  for (const index of kneeGroup.indices) assert.ok(yellow(knee.content[index]) > 0);
});

test('newly highlighted alternative survives DOCX export and Word edit import', async () => {
  const doc = makeTemplateDocument('head-gm');
  const blob = await exportDocx(doc, { kind: 'template', templateId: 'head-gm' });
  const zip = unzipSync(new Uint8Array(await blob.arrayBuffer())), xml = strFromU8(zip['word/document.xml']);
  assert.match(xml, /Субарахноидальные конвекситальные пространства/);
  assert.match(xml, /w:fill="FFFF00"/);
  zip['word/document.xml'] = strToU8(xml.replace('Срединные структуры не смещены', 'Срединные структуры без смещения'));
  const imported = await importOwnDocx(zipSync(zip));
  assert.match(visible(imported.doc), /Срединные структуры без смещения/);
  const option = imported.doc.content.find(node => visible(node).startsWith('Субарахноидальные конвекситальные пространства и борозды не расширены'));
  assert.ok(yellow(option) > 0);
});
