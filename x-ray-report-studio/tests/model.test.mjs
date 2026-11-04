import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeDocument, collectFields, moduleNode, insertModule, removeModule,
  builtinModules, profiles, validateLibrary, validateDraft, validateTemplate, migrateLegacyHeader,
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

test('every fresh profile keeps birth date and removes age and clinical goal with stable remaining IDs', () => {
  for (const profile of profiles) {
    const doc = makeDocument(profile.id);
    const header = doc.content.find(n => n.attrs.id === 'header');
    const rows = header.content.find(n => n.type === 'table').content;
    const labels = rows.map(row => row.content[0].content[0].content[0].text);
    assert.ok(labels.includes('Дата рождения'), profile.id);
    assert.equal(labels.some(label => /возраст|клинические сведения/i.test(label)), false);
    const fields = collectFields(doc);
    assert.equal(fields.find(f => f.id === 'base.1').hint, 'Ф.И.О.');
    assert.equal(fields.find(f => f.id === 'base.2').hint, 'дд.мм.гггг');
    assert.equal(fields.find(f => f.id === 'base.4').hint, 'дд.мм.гггг');
    assert.equal(fields.find(f => f.id === 'base.5').hint, 'номер');
    assert.equal(fields.some(f => ['base.3', 'base.6'].includes(f.id)), false);
    assert.ok(fields.every(f => f.value === ''));
  }
});

test('old drafts migrate only retired header content and retain values, IDs, formatting and modules', () => {
  const expected = makeDocument('arteries');
  const header = expected.content.find(n => n.attrs.id === 'header');
  const rows = header.content.find(n => n.type === 'table').content;
  rows[0].content[1].content[0].content[0].attrs.value = 'Сохранённый Пациент';
  const birth = rows[1].content[1].content[0].content[0];
  birth.attrs.value = '01.02.1970';
  birth.marks = [{ type: 'italic' }];
  rows[1].content[0].content[0].content[0].marks = [{ type: 'bold' }];
  const module = expected.content.find(n => n.attrs.id === 'M02');
  module.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'Ручная правка', marks: [{ type: 'underline' }] }] });
  expected.content.push({ type: 'reportSection', attrs: { id: 'user', title: 'Мой раздел', moduleId: '' }, content: [
    { type: 'paragraph', content: [{ type: 'reportField', attrs: { id: 'user.age', hint: 'полных лет', value: 'Эту авторскую подсказку сохраняем' } }] },
  ] });
  const legacy = structuredClone(expected);
  const oldRows = legacy.content[0].content[1].content;
  oldRows[1].content[0].content[0].content[0].text = 'Дата рождения / возраст';
  oldRows[1].content[1].content[0].content.push(
    { type: 'text', text: ' / ', marks: [{ type: 'italic' }] },
    { type: 'reportField', attrs: { id: 'base.3', hint: 'полных лет', value: '56' } },
  );
  oldRows.splice(4, 0, { type: 'tableRow', content: [
    { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Клинические сведения / цель' }] }] },
    { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'reportField', attrs: { id: 'base.6', hint: 'жалобы, анамнез, клинический вопрос', value: 'Головная боль' } }] }] },
  ] });
  const untouched = structuredClone(legacy);
  assert.deepEqual(migrateLegacyHeader(legacy), expected);
  assert.deepEqual(validateDraft({ format: 'mri-report-studio', version: 1, doc: legacy }).doc, expected);
  assert.deepEqual(legacy, untouched, 'opening a draft must not mutate the imported object');
  const custom = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Мой собственный заголовок' }] }] };
  assert.deepEqual(migrateLegacyHeader(custom), custom);
});

test('custom rich templates retain section edits and profile modules while isolating report values', () => {
  const template = makeDocument('pituitary');
  template.content = template.content.filter(n => !['method', 'signature'].includes(n.attrs.id));
  const header = template.content.find(n => n.attrs.id === 'header');
  header.attrs.title = 'Моя шапка';
  const patient = header.content[1].content[0].content[1].content[0].content[0];
  patient.attrs.value = 'Не переносить в нового пациента';
  patient.attrs.hint = 'Фамилия, имя, отчество';
  patient.marks = [{ type: 'bold' }];
  header.content[0].attrs = { level: 1, textAlign: 'center' };
  header.content[0].content[0].text = 'Мой заголовок исследования';
  header.content[0].content[0].marks = [{ type: 'textStyle', attrs: { fontFamily: 'Times New Roman', fontSize: '18.667px', color: '#223344' } }];
  header.content[1].content[0].content[0].attrs = { colspan: 1, rowspan: 1, colwidth: [125], align: 'left' };
  template.content.unshift({ type: 'reportSection', attrs: { id: 'custom_intro', title: 'Вступление', moduleId: '' }, content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Авторский раздел' }] },
    { type: 'paragraph', content: [{ type: 'reportField', attrs: { id: 'custom.field', hint: 'Моя подсказка', value: 'Старое значение' } }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Пункт', marks: [{ type: 'highlight', attrs: { color: '#fff09b' } }] }] }] }] },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Примечание' }] }] },
    { type: 'horizontalRule' },
  ] });
  const original = structuredClone(template);
  const saved = validateTemplate(JSON.parse(JSON.stringify(template)));
  assert.deepEqual(saved.content.map(n => n.attrs.id), template.content.map(n => n.attrs.id));
  assert.deepEqual(saved.content[2], template.content[2], 'anatomy, paragraphs and module references survive');
  const savedHeader = saved.content.find(n => n.attrs.id === 'header');
  assert.deepEqual(savedHeader.content[0], header.content[0]);
  assert.deepEqual(savedHeader.content[1].content[0].content[0].attrs, { colspan: 1, rowspan: 1, colwidth: [125], align: 'left' });
  assert.equal(collectFields(saved).find(f => f.id === 'base.1').hint, 'Фамилия, имя, отчество');
  assert.ok(collectFields(saved).every(f => f.value === ''));
  const first = makeDocument('pituitary', builtinModules, saved);
  const second = makeDocument('pituitary', builtinModules, saved);
  assert.equal(first.content.filter(n => n.attrs.moduleId === 'M04').length, 1);
  first.content[0].content[1].content[0].attrs.value = 'Только первый отчёт';
  first.content[0].attrs.title = 'Правка текущего отчёта';
  assert.ok(collectFields(second).every(f => f.value === ''));
  assert.equal(second.content[0].attrs.title, 'Вступление');
  assert.deepEqual(template, original);
  assert.deepEqual(saved, second);
});

test('template validation rejects broken structures and duplicate identities and sanitizes unsupported attributes', () => {
  const doc = makeDocument();
  const duplicateField = structuredClone(doc);
  duplicateField.content[1].content.push({ type: 'paragraph', content: [structuredClone(doc.content[0].content[1].content[0].content[1].content[0].content[0])] });
  assert.throws(() => validateTemplate(duplicateField));
  const duplicateSection = structuredClone(doc);
  duplicateSection.content.push(structuredClone(doc.content[0]));
  assert.throws(() => validateTemplate(duplicateSection));
  assert.throws(() => validateTemplate({ type: 'doc', content: [{ type: 'script', text: 'alert(1)' }] }));
  assert.throws(() => validateTemplate({ type: 'doc', content: [{ type: 'table', content: [{ type: 'paragraph' }] }] }));
  assert.throws(() => validateTemplate({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(100001) }] }] }));
  const dirty = { type: 'doc', attrs: { onclick: 'alert(1)' }, content: [{ type: 'paragraph', attrs: { textAlign: 'center', style: 'url(evil)' }, content: [{
    type: 'text', text: 'Безопасный текст', marks: [
      { type: 'link', attrs: { href: 'javascript:alert(1)' } },
      { type: 'textStyle', attrs: { fontFamily: 'Arial', color: 'red; position: fixed', fontSize: '16px', style: 'bad' } },
    ],
  }] }] };
  const clean = validateTemplate(dirty);
  assert.equal(clean.attrs, undefined);
  assert.deepEqual(clean.content[0].attrs, { textAlign: 'center' });
  assert.deepEqual(clean.content[0].content[0].marks, [{ type: 'textStyle', attrs: { fontFamily: 'Arial', fontSize: '16px' } }]);
});
