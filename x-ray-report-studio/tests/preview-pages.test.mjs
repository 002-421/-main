import test from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from 'fflate';
import { makeTemplateDocument } from '../src/catalog.ts';
import { exportDocx, importOwnDocx } from '../src/docx.ts';
import { previewPageLayout } from '../src/preview-pages.ts';

test('Word preview uses the same page geometry and base font as exported source reports', async () => {
  for (const id of ['head-gm', 'ct-f180c23cde']) {
    const doc = makeTemplateDocument(id);
    const layout = previewPageLayout(doc);
    const blob = await exportDocx(doc, { templateId: id });
    const xml = strFromU8(unzipSync(new Uint8Array(await blob.arrayBuffer()))['word/document.xml']);
    const twips = mm => Math.round(mm / 25.4 * 1440);
    assert.match(xml, new RegExp(`w:top="${twips(layout.topMm)}"`), `${id}: Word top margin`);
    assert.match(xml, new RegExp(`w:bottom="${twips(layout.bottomMm)}"`), `${id}: Word bottom margin`);
    assert.match(xml, new RegExp(`w:left="${twips(layout.leftMm)}"`), `${id}: Word left margin`);
    assert.match(xml, new RegExp(`w:right="${twips(layout.rightMm)}"`), `${id}: Word right margin`);
    assert.equal(layout.fontSizePt, 11);
    assert.equal(layout.topMm, 43);
  }
});

test('legacy 12 pt documents and explicit 10/14 pt paragraphs survive preview layout and DOCX round trip', async () => {
  const sizes = [12, 10, 14];
  const doc = { type: 'doc', attrs: { sourceFormat: 'alliance-template', fontSizePt: 12 }, content: sizes.map(size => ({
    type: 'paragraph', attrs: { fontSizePt: size }, content: [{ type: 'text', text: `Synthetic ${size} pt` }],
  })) };
  const original = structuredClone(doc);
  assert.equal(previewPageLayout(doc).fontSizePt, 12, 'explicit legacy base is not normalized to 11 pt');
  const blob = await exportDocx(doc, { templateId: 'head-gm' });
  const xml = strFromU8(unzipSync(new Uint8Array(await blob.arrayBuffer()))['word/document.xml']);
  for (const size of sizes) {
    const run = [...xml.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)].find(match => match[1].includes(`>Synthetic ${size} pt</w:t>`));
    assert.ok(run, `Word contains the synthetic ${size} pt text`);
    assert.match(run[1], new RegExp(`<w:sz w:val="${size * 2}"`), `Word preserves explicit ${size} pt`);
  }
  assert.deepEqual((await importOwnDocx(blob)).doc, original, 'DOCX metadata restores the unchanged legacy document');
  assert.deepEqual(doc, original, 'layout and export leave the input document untouched');
});
