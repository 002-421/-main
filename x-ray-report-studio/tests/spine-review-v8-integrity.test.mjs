import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spine-review-v8-integrity.json', import.meta.url), 'utf8'));
const mri = JSON.parse(readFileSync(new URL('../src/catalog.json', import.meta.url), 'utf8'));
const ct = JSON.parse(readFileSync(new URL('../src/ct-catalog.json', import.meta.url), 'utf8'));
const boundaries = JSON.parse(readFileSync(new URL('../src/ai-review-boundaries.json', import.meta.url), 'utf8'));
const templates = [...mri.templates, ...ct.templates];
const spineIds = new Set(fixture.spineTemplateIds);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const sha256 = value => createHash('sha256').update(value).digest('hex');
const templateHash = template => sha256(stableJson(template));
const normalizeText = value => value.normalize('NFC').replace(/[\u00a0\u202f]/gu, ' ').replace(/\s+/gu, ' ').trim();

function paragraphs(doc) {
  const result = [];
  const plain = node => node.type === 'text' ? node.text ?? '' : (node.content ?? []).map(plain).join('');
  const walk = node => {
    if (node.type === 'paragraph' || node.type === 'heading') {
      const text = normalizeText(plain(node));
      if (text) result.push(text);
    } else for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  const physician = result.findIndex(text => /^Врач(?:-рентгенолог)?\s*:/iu.test(text));
  return result.slice(0, physician < 0 ? result.length : physician);
}

test('the other 105 MRI/CT built-ins match the XRS 0.4.81 fingerprints', () => {
  assert.equal(templates.length, 113);
  const otherTemplates = templates.filter(template => !spineIds.has(template.id));
  assert.equal(otherTemplates.length, 105);
  assert.deepEqual(otherTemplates.map(template => template.id).sort(), Object.keys(fixture.nonSpineTemplateSha256).sort());
  for (const template of otherTemplates) {
    assert.equal(templateHash(template), fixture.nonSpineTemplateSha256[template.id], `${template.id} changed from the Stable 0.4.81 baseline`);
  }
});

test('the eight spine templates match the approved Review v8 medical text fingerprints and preserve all 40 fields', () => {
  assert.deepEqual(templates.filter(template => spineIds.has(template.id)).map(template => template.id).sort(), [...spineIds].sort());
  for (const id of fixture.spineTemplateIds) {
    const template = mri.templates.find(item => item.id === id);
    assert.ok(template, `${id} is present in the MRI catalog`);
    assert.equal(sha256(JSON.stringify(paragraphs(template.doc))), fixture.approvedMedicalTextSha256[id], `${id} medical text differs from Review v8`);

    const fieldIds = [];
    const walk = node => {
      if (node.type === 'text') for (const mark of node.marks ?? []) if (mark.type === 'templateField') fieldIds.push(mark.attrs.id);
      for (const child of node.content ?? []) walk(child);
    };
    walk(template.doc);
    assert.deepEqual(fieldIds, [
      `${id}.number`, `${id}.patient`, `${id}.birthdate`, 'HEAD.BASE.2.FIELD.0043', `${id}.reportdate`,
    ], `${id} field IDs and order`);
  }
});

test('only the eight spine boundary records are recalibrated for their approved catalog structure', () => {
  const otherIds = Object.keys(boundaries).filter(id => !spineIds.has(id));
  assert.equal(otherIds.length, 105);
  assert.deepEqual(otherIds.sort(), Object.keys(fixture.nonSpineAIBoundarySha256).sort());
  for (const id of otherIds) {
    assert.equal(sha256(JSON.stringify(boundaries[id])), fixture.nonSpineAIBoundarySha256[id], `${id} AI Review boundary metadata changed from Stable 0.4.81`);
  }
  for (const id of fixture.spineTemplateIds) {
    assert.deepEqual(boundaries[id], fixture.spineAIBoundaries[id], `${id} audited boundaries differ from the validated Review v8 structure`);
  }
});
