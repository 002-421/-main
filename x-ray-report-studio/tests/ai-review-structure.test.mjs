import test from 'node:test';
import assert from 'node:assert/strict';
import source from '../src/catalog.json' with { type: 'json' };
import ctSource from '../src/ct-catalog.json' with { type: 'json' };
import boundaries from '../src/ai-review-boundaries.json' with { type: 'json' };
import { makeTemplateDocument } from '../src/catalog.ts';
import { compactTemplateTables, separateRecommendations, highlightDeletionNotes } from '../src/table-layout.ts';
import { resetInlineTemplate, prepareInlineDocument } from '../src/inline-fields.ts';
import { initializeReportFooter } from '../src/report-footer.ts';
import { justifyDescription } from '../src/description-alignment.ts';
import { structurePreparedBuiltin, planUserDocumentMigration } from '../src/ai-review-structure.ts';
import { ReportBlockExtractor } from '../src/ai-review.ts';
import { exportDocx, importOwnDocx } from '../src/docx.ts';

const prepared = id => justifyDescription(prepareInlineDocument(initializeReportFooter(resetInlineTemplate(highlightDeletionNotes(separateRecommendations(compactTemplateTables(makeTemplateDocument(id))))), '01.01.2000')));

test('all 55 bundled MRI templates receive audited sections without changing nodes or formatting', () => {
  assert.equal(source.templates.length, 55);
  assert.equal(Object.keys(boundaries).length, 113);
  for (const template of source.templates) {
    const original = prepared(template.id);
    const snapshot = structuredClone(original);
    const structured = structurePreparedBuiltin(template.id, original);
    assert.deepEqual(structured.content.map(x => x.attrs.id), ['header','description','conclusion','signature'], template.id);
    assert.deepEqual(structured.content.flatMap(x => x.content), snapshot.content, template.id);
    assert.deepEqual(original, snapshot, template.id);
    const blocks = new ReportBlockExtractor().extract(structured);
    assert.ok(blocks.description && blocks.conclusion, template.id);
    assert.doesNotMatch(JSON.stringify(blocks), /Ф\.И\.О\. пациента|Дата рождения|Врач:|дд\.мм\.гггг/, template.id);
  }
});

test('all 58 CT templates receive audited boundaries without changing nested nodes or formatting', () => {
  assert.equal(ctSource.templates.length, 58);
  for (const template of ctSource.templates) {
    const original=prepared(template.id), snapshot=structuredClone(original);
    const structured=structurePreparedBuiltin(template.id,original);
    assert.deepEqual(structured.content.map(x=>x.attrs.id),['header','description','conclusion','signature'],template.id);
    assert.deepEqual(structured.content.flatMap(x=>x.content),snapshot.content,template.id);
    assert.deepEqual(original,snapshot,template.id);
    const blocks=new ReportBlockExtractor().extract(structured);
    assert.ok(blocks.description && blocks.conclusion,template.id);
    assert.doesNotMatch(JSON.stringify(blocks),/Ф\.И\.О\. пациента|Дата рождения|Врач(?:-рентгенолог)?:|дд\.мм\.гггг/,template.id);
  }
});

test('changed and user-authored documents require manual review; backup is an exact copy', () => {
  const original = prepared(source.templates[0].id);
  original.content.splice(5, 0, { type: 'paragraph', content: [{ type: 'text', text: 'Дополнение' }] });
  assert.throws(() => structurePreparedBuiltin(source.templates[0].id, original));
  const plan = planUserDocumentMigration(original);
  assert.equal(plan.status, 'manual-review');
  assert.deepEqual(plan.backup, original);
  assert.notEqual(plan.backup, original);
});

test('structured MRI document round-trips through DOCX without losing sections or formatting', async () => {
  const original = structurePreparedBuiltin(source.templates[0].id, prepared(source.templates[0].id));
  const blob = await exportDocx(original,{templateId:source.templates[0].id});
  const restored = await importOwnDocx(blob);
  assert.deepEqual(restored.doc, original);
});
test('structured CT document round-trips through DOCX without losing sections or formatting', async () => {
  const original=structurePreparedBuiltin(ctSource.templates[0].id,prepared(ctSource.templates[0].id));
  const blob=await exportDocx(original,{templateId:ctSource.templates[0].id});
  const restored=await importOwnDocx(blob);
  assert.deepEqual(restored.doc,original);
});
