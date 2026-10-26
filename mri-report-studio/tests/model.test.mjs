import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeDocument, collectFields, moduleNode, insertModule, removeModule,
  builtinModules, profiles, validateLibrary, validateDraft,
} from '../src/model.ts';

test('all profiles create a document with unique fields and the appropriate anatomy', () => {
  for (const profile of profiles) {
    const doc = makeDocument(profile.id);
    const fields = collectFields(doc);
    assert.ok(fields.length > 10, profile.id);
    assert.equal(new Set(fields.map(f => f.id)).size, fields.length);
    assert.equal(doc.content.some(n => n.attrs.id === 'brain'), profile.brain);
    assert.deepEqual(doc.content.filter(n => n.attrs.moduleId).map(n => n.attrs.moduleId), profile.modules);
  }
});

test('adding, removing and restoring a module preserves patient data and manual module edits', () => {
  const original = makeDocument();
  original.content[0].content[0].content[0].text = 'Мой заголовок';
  const result = moduleNode(builtinModules.find(m => m.id === 'M02'));
  let doc = insertModule(original, result.body, result.conclusion);
  assert.equal(doc.content.find(n => n.attrs.id === 'header').content[0].content[0].text, 'Мой заголовок');
  const module = doc.content.find(n => n.attrs.id === 'M02');
  module.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'Ручная правка артерий' }] });
  const removed = removeModule(doc, 'M02');
  assert.equal(removed.doc.content.some(n => n.attrs.id === 'M02'), false);
  assert.equal(removed.doc.content.find(n => n.attrs.id === 'conclusion').content.some(n => n.attrs?.moduleRef === 'M02'), false);
  doc = insertModule(removed.doc, removed.body, removed.conclusion);
  assert.equal(doc.content.find(n => n.attrs.id === 'M02').content.at(-1).content[0].text, 'Ручная правка артерий');
  assert.equal(original.content.some(n => n.attrs.id === 'M02'), false);
});

test('all source modules can coexist without colliding field identities', () => {
  let doc = makeDocument();
  for (const m of builtinModules) {
    const part = moduleNode(m);
    doc = insertModule(doc, part.body, part.conclusion);
  }
  const fields = collectFields(doc);
  assert.ok(fields.length > 230);
  assert.equal(fields.length, new Set(fields.map(f => f.id)).size);
});

test('importing a draft round-trips rich text, filled fields and modules', () => {
  const doc = makeDocument('pituitary');
  doc.content[0].content[0].content[0].marks = [{ type: 'bold' }];
  const input = { format: 'mri-report-studio', version: 1, profile: 'pituitary', doc, customModules: [] };
  const saved = validateDraft(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(saved.doc, doc);
  assert.equal(saved.profile, 'pituitary');
});

test('malformed and incompatible libraries and reports are rejected before replacing a document', () => {
  assert.throws(() => validateDraft({ doc: makeDocument() }));
  const duplicate = makeDocument();
  const field = duplicate.content[0].content[1].content[0].content[1].content[0].content[0];
  duplicate.content[0].content.push({ type: 'paragraph', content: [structuredClone(field)] });
  assert.throws(() => validateDraft({ format: 'mri-report-studio', version: 1, doc: duplicate }));
  assert.throws(() => validateLibrary([{ id: '<script>', title: 'bad', sections: [] }]));
  assert.throws(() => validateLibrary([{ id: 'x', title: 'x', sections: [{ paragraphs: [12] }] }]));
  assert.throws(() => validateLibrary([{ id: 'x', title: 'x', sections: [] }, { id: 'x', title: 'y', sections: [] }]));
});
