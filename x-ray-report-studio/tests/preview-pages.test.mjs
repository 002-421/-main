import test from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from 'fflate';
import { makeTemplateDocument } from '../src/catalog.ts';
import { exportDocx } from '../src/docx.ts';
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
    assert.equal(layout.fontSizePt, 12);
    assert.equal(layout.topMm, 43);
  }
});
