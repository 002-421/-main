import assert from 'node:assert/strict';
import test from 'node:test';
import { areas, reportTemplates, reportBlocks, makeTemplateDocument, PATIENT_FIELD_ID, DOCTOR_FIELD_ID, DEFAULT_TEMPLATE_ID } from '../src/catalog.ts';
import { validateTemplate } from '../src/model.ts';
import { collectInlineFields, prepareInlineDocument } from '../src/inline-fields.ts';
import { initializeReportFooter } from '../src/report-footer.ts';
import { highlightDeletionNotes } from '../src/table-layout.ts';

function walk(node, callback) { callback(node); node.content?.forEach(child => walk(child, callback)); }
function plain(node) { return (node.text ?? '') + (node.content ?? []).map(plain).join(''); }
const mriTemplates = reportTemplates.filter(template => !template.id.startsWith('ct-'));
const mriAreas = areas.filter(area => !area.id.startsWith('ct-'));

function visible(node) { return node.type === 'reportField' ? `⟦${node.attrs.hint}⟧` : (node.text ?? '') + (node.content ?? []).map(visible).join(''); }

test('catalog contains the six archive zones and all imported protocols', () => {
  assert.deepEqual(mriAreas.map(a => a.title), [
    'Брюшная полость и забрюшинное пространство', 'Голова', 'Малый таз', 'Остальные', 'Позвоночник', 'Суставы',
  ]);
  assert.equal(mriTemplates.length, 55);
  for (const area of mriAreas) assert.ok(reportTemplates.some(t => t.areaId === area.id));
  assert.equal(reportBlocks.length, 13);
  assert.equal(makeTemplateDocument().attrs.templateId, DEFAULT_TEMPLATE_ID);
});

test('CT archive templates use the MRI-style editable patient, study and physician header', () => {
  const ctTemplates = reportTemplates.filter(template => template.id.startsWith('ct-'));
  assert.equal(ctTemplates.length, 58);
  assert.equal(mriAreas.length, 6);
  const ctAreas = areas.filter(area => area.id.startsWith('ct-'));
  assert.equal(ctAreas.length, 8);
  for (const template of ctTemplates) {
    const doc = makeTemplateDocument(template.id);
    validateTemplate(doc);
    const text = plain(doc);
    assert.match(text, /Протокол КТ-исследования №/);
    assert.match(text, /Ф\.И\.О\. пациента:/);
    assert.match(text, /Дата рождения:/);
    assert.match(text, /Вид исследования:/);
    assert.match(text, /Врач-рентгенолог:/);
    assert.doesNotMatch(text, /Халиуллина Анастасия Игоревна|Протокол исследования № 2/);
  }
});

test('all MRI and CT templates have stable study-number, patient and birth-date field suffixes', () => {
  for (const template of reportTemplates) {
    const ids = collectInlineFields(makeTemplateDocument(template.id)).map(field => field.id);
    for (const suffix of ['number', 'patient', 'birthdate']) {
      assert.ok(ids.some(id => id.endsWith(`.${suffix}`)), `${template.id} is missing its ${suffix} field`);
    }
  }
});

test('CT report paragraphs have the same first-line indent as MRI while metadata and date stay flush', () => {
  const metadata = /^\s*(?:Фамилия\s*,\s*имя\s*,\s*отчество|Исследование\s*:|Контрастный\s+препарат\s*:|Доза\s*:|Протокол\s+исследования\s*№|Мультиспиральная\s+компьютерная\s+томография|Toshiba\b)/i;
  for (const template of reportTemplates.filter(item => item.id.startsWith('ct-'))) {
    const paragraphs = makeTemplateDocument(template.id).content.filter(node => node.type === 'paragraph');
    for (const paragraph of paragraphs.slice(4)) {
      const text = plain(paragraph).trim();
      if (metadata.test(text) || /^Дата\s*:/i.test(text) || /^Врач(?:-рентгенолог)?\s*:/i.test(text)) {
        assert.notEqual(paragraph.attrs?.firstLineIndentPt, 17.717, `${template.title}: metadata/footer should stay flush`);
      } else {
        assert.equal(paragraph.attrs?.firstLineIndentPt, 17.717, `${template.title}: ${text.slice(0, 60)}`);
      }
    }
  }
});

test('CT recommendation paragraphs use black text in every template', () => {
  const ctTemplates = reportTemplates.filter(template => template.id.startsWith('ct-'));
  for (const template of ctTemplates) {
    const recommendations = [];
    walk(makeTemplateDocument(template.id), node => {
      if (node.type === 'paragraph' && /^\s*(?:Рекоменд|Рекоменду)/i.test(plain(node))) recommendations.push(node);
    });
    for (const paragraph of recommendations) {
      const runs = [];
      walk(paragraph, node => { if (node.type === 'text') runs.push(node); });
      assert.ok(runs.length > 0, `${template.title}: recommendation has text`);
      for (const run of runs) {
        const style = run.marks?.find(mark => mark.type === 'textStyle');
        assert.equal(style?.attrs?.color, '#000000', `${template.title}: ${run.text}`);
      }
    }
  }
});

test('source protocols preserve wording and have editable unique fields', () => {
  for (const template of mriTemplates) {
    const doc = makeTemplateDocument(template.id);
    validateTemplate(doc);
    const fields = collectInlineFields(prepareInlineDocument(doc));
    assert.equal(new Set(fields.map(f => f.id)).size, fields.length, template.title);
    assert.ok(fields.every(f => !f.filled), template.title);
    assert.ok(doc.content.length > 0);
    const copy = makeTemplateDocument(template.id);
    doc.content.length = 0;
    assert.ok(copy.content.length > 0, template.title);
  }
  assert.throws(() => makeTemplateDocument('missing'), /не найден/);
});

test('all protocol templates separate the closing block and fill its date automatically', () => {
  for (const template of mriTemplates) {
    const doc = initializeReportFooter(prepareInlineDocument(makeTemplateDocument(template.id)), '03.11.2026');
    const physician = doc.content.findIndex(node => node.type === 'paragraph' && plain(node).includes('Врач:'));
    assert.ok(physician >= 0, template.title);
    assert.equal(doc.content[physician - 1].type, 'paragraph');
    assert.equal(plain(doc.content[physician - 1]), '');
    assert.doesNotMatch(plain(doc), /Данное заключение не является диагнозом|Исследование выполнено на магнитно-резонансном томографе/);
    const date = doc.content[physician + 1].content.find(node => node.marks?.some(mark => mark.type === 'templateField' && mark.attrs?.id.endsWith('.reportdate')));
    assert.equal(date.text, '03.11.2026', template.title);
    assert.equal(date.marks.find(mark => mark.type === 'templateField').attrs.filled, true, template.title);
  }
});

test('all CT templates fill the physician date on opening', () => {
  const date = '04.11.2026';
  for (const template of reportTemplates.filter(item => item.id.startsWith('ct-'))) {
    const doc = initializeReportFooter(makeTemplateDocument(template.id), date);
    const dateFields = [];
    walk(doc, node => {
      const field = node.marks?.find(mark => mark.type === 'templateField' && String(mark.attrs?.id ?? '').endsWith('.reportdate'));
      if (field && node.type === 'text') dateFields.push({ text: node.text, filled: field.attrs.filled });
      if (node.type === 'reportField' && String(node.attrs?.id ?? '').endsWith('.reportdate')) dateFields.push({ text: node.attrs.value, filled: true });
    });
    assert.equal(dateFields.length, 1, template.title);
    assert.equal(dateFields[0].text, date, template.title);
    assert.equal(dateFields[0].filled, true, template.title);
  }
});

test('tables in every template use compact widths, cell text and line breaks', () => {
  for (const template of mriTemplates) {
    const doc = makeTemplateDocument(template.id);
    walk(doc, node => {
      if (node.type !== 'table') return;
      const firstRow = node.content.find(child => child.type === 'tableRow');
      const widths = firstRow.content.flatMap(cell => cell.attrs?.colwidth ?? []);
      assert.ok(widths.reduce((sum, value) => sum + value, 0) <= 640, template.title);
      walk(node, cell => {
        if (cell.type === 'paragraph') {
          const highlightedNote = (cell.attrs?.fontSizePt ?? 0) === 10 && cell.content?.some(child => child.marks?.some(mark => mark.type === 'highlight' && mark.attrs?.color === '#ffff00'));
          assert.ok((cell.attrs?.fontSizePt ?? 9) <= 9 || highlightedNote, template.title);
        }
        for (let index = 1; index < (cell.content ?? []).length; index++) {
          assert.ok(!(cell.content[index - 1].type === 'hardBreak' && cell.content[index].type === 'hardBreak'), template.title);
        }
      });
    });
  }
});

test('templates default to Arial 12 and separate conclusion and recommendations', () => {
  for (const template of mriTemplates) {
    const doc = makeTemplateDocument(template.id);
    assert.equal(doc.attrs.fontFamily, 'Arial', template.title);
    assert.equal(doc.attrs.fontSizePt, 12, template.title);
    const check = (node, inTable = false) => {
      const table = inTable || node.type === 'table';
      if (node.type === 'paragraph' || node.type === 'heading') {
        assert.equal(node.attrs.fontFamily, 'Arial', template.title);
        const highlightedNote = node.attrs.fontSizePt === 10 && node.content?.some(child => child.marks?.some(mark => mark.type === 'highlight' && mark.attrs?.color === '#ffff00'));
        assert.ok(node.attrs.fontSizePt === (table ? 9 : 12) || highlightedNote, template.title);
      }
      for (const mark of node.marks ?? []) if (mark.type === 'textStyle') {
        assert.equal(mark.attrs.fontFamily, 'Arial', template.title);
        const highlighted = node.marks?.some(candidate => candidate.type === 'highlight' && candidate.attrs?.color === '#ffff00');
        assert.ok(mark.attrs.fontSize === (table ? '12px' : '16px') || highlighted && mark.attrs.fontSize === '13.333px', template.title);
      }
      node.content?.forEach(child => check(child, table));
      for (let index = 0; index < (node.content ?? []).length; index++) {
        const child = node.content[index];
        const text = plain(child).trim();
        if (child.type === 'paragraph' && (/^(?:Рекоменд|Рекоменду)/i.test(text) || /^Заключение\s*:?/i.test(text))) {
          assert.ok(['paragraph', 'horizontalRule'].includes(node.content[index - 1]?.type), `${template.title}: section separator`);
          // Section spacing is carried by paragraph margins, without blank rows.
        }
      }
    };
    check(doc);
  }
});

test('removal notes are italic, 10 pt and highlighted yellow', () => {
  const deletionNotes = [];
  for (const template of mriTemplates) walk(makeTemplateDocument(template.id), node => {
    if (node.type !== 'paragraph') return;
    const text = plain(node).trim();
    if (/(?:нужно\s+)?удалять\s*!?/i.test(text) || /^По структуре, выделяют 4 типа молочных жел[её]з \(по Wolfe\)/i.test(text) || /^Тип\s*[1-4]\s*:/i.test(text)) deletionNotes.push({ template: template.title, node, text });
  });
  assert.ok(deletionNotes.length >= 8);
  for (const { template, node, text } of deletionNotes) {
    assert.equal(node.attrs.fontSizePt, 10, `${template}: ${text}`);
    const runs = [];
    walk(node, child => { if (child.type === 'text') runs.push(child); });
    assert.ok(runs.length > 0, `${template}: ${text}`);
    for (const run of runs) {
      assert.ok(run.marks.some(mark => mark.type === 'italic'), `${template}: ${text}`);
      assert.ok(run.marks.some(mark => mark.type === 'highlight' && mark.attrs?.color === '#ffff00'), `${template}: ${text}`);
      assert.ok(run.marks.some(mark => mark.type === 'textStyle' && mark.attrs?.fontSize === '13.333px'), `${template}: ${text}`);
    }
  }
});

test('all non-footer notes after the physician line are marked for deletion', () => {
  let styledParagraphs = 0;
  for (const template of mriTemplates) {
    const doc = makeTemplateDocument(template.id);
    const physician = doc.content.findIndex(node => node.type === 'paragraph' && plain(node).includes('Врач:')
     );
    if (physician < 0) continue;
    const check = node => {
      const text = plain(node).trim();
      if (/^(?:Дата:|Данное заключение не является диагнозом|Исследование выполнено на магнитно-резонансном томографе)/i.test(text)) return;
      if (node.type === 'paragraph' && text) {
        styledParagraphs++;
        assert.equal(node.attrs.fontSizePt, 10, `${template.title}: ${text}`);
        const runs = [];
        walk(node, child => { if (child.type === 'text') runs.push(child); });
        for (const run of runs) {
          assert.ok(run.marks.some(mark => mark.type === 'italic'), `${template.title}: ${text}`);
          assert.ok(run.marks.some(mark => mark.type === 'highlight' && mark.attrs?.color === '#ffff00'), `${template.title}: ${text}`);
        }
        return;
      }
      node.content?.forEach(check);
    };
    doc.content.slice(physician + 1).forEach(check);
  }
  assert.ok(styledParagraphs >= 20, `Expected post-signature notes; got ${styledParagraphs}`);
});

test('both age-specific alternatives are highlighted for choosing the matching norm', () => {
  const doc = makeTemplateDocument('head-gm');
  const paragraphs = [];
  walk(doc, node => { if (node.type === 'paragraph' && plain(node).includes('после 60 лет')) paragraphs.push(node); });
  assert.equal(paragraphs.length, 1);
  const paragraph = paragraphs[0];
  const markedRuns = paragraph.content.filter(node => node.marks?.some(mark => mark.type === 'highlight' && mark.attrs?.color === '#ffff00') && node.marks?.some(mark => mark.type === 'italic'));
  const marked = markedRuns.map(node => node.text ?? '').join('');
  assert.match(marked, /норма 18-22,1, после 60 лет 22,6-26,0/);
  assert.match(marked, /норма 24,0-26,3, после 50 лет - 28,2-29,4/);
  assert.ok(markedRuns.every(node => node.marks.some(mark => mark.type === 'textStyle' && mark.attrs.fontSize === '13.333px')));
});

test('patient-specific dimensions are highlighted while reference norms are left untouched', () => {
  const doc = highlightDeletionNotes({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Размеры 1,6x3,3 см, от 0,3 см до 0,0 см. Норма 0,5-0,8 см.' }] }] });
  const paragraph = doc.content[0];
  const highlighted = paragraph.content.filter(node => node.marks?.some(mark => mark.type === 'highlight' && mark.attrs?.color === '#ffff00')).map(node => node.text).join('');
  assert.equal(highlighted, '1,6x3,3 см0,3 см0,0 см');
  const norm = paragraph.content.filter(node => node.text?.includes('0,5-0,8 см'));
  assert.ok(norm.length > 0);
  assert.ok(norm.every(node => !node.marks?.some(mark => mark.type === 'highlight' && mark.attrs?.color === '#ffff00')));
});

test('CT measurements use editable yellow zero fields while norms and fixed slice parameters stay clean', () => {
  const input = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Очаг печени размером 4,2 мм. Диаметр справа мм, норма 0,15-0,38 мм. Толщина срезов 64x1,0 мм.' }] }] };
  const doc = highlightDeletionNotes(input, { ct: true });
  const paragraph = doc.content[0];
  const text = plain(paragraph);
  assert.match(text, /Очаг печени размером 0,0 мм/);
  assert.match(text, /Диаметр справа 0,0 мм/);
  assert.match(text, /норма 0,15-0,38 мм/);
  assert.match(text, /Толщина срезов 64x1,0 мм/);
  const marked = paragraph.content.filter(node => node.marks?.some(mark => mark.type === 'highlight' && mark.attrs?.color === '#ffff00')).map(node => node.text).join('');
  assert.match(marked, /0,0 мм/);
  assert.doesNotMatch(marked, /0,15-0,38 мм|64x1,0 мм/);
});

test('all CT templates fill blank millimeter measurements without highlighting norms or scan thickness', () => {
  const unit = /(?<![а-яё])мм(?![а-яё])/giu;
  const norms = /(?:норм(?:а|ы|альный|альные|атив)|референсн\w*)[^.!?;\n]*/giu;
  const slices = /(?:толщин[а-яё]*\s+срез[а-яё]*|шаг[а-яё]*\s+срез[а-яё]*)[^.!?;\n]{0,55}?\d+(?:[,.]\d+)?(?:\s*[xх×]\s*\d+(?:[,.]\d+)?)?\s*мм/giu;
  for (const template of reportTemplates.filter(item => item.id.startsWith('ct-'))) {
    const doc = makeTemplateDocument(template.id);
    walk(doc, node => {
      if (node.type !== 'paragraph' || !node.content) return;
      const text = node.content.map(child => child.text ?? '').join('');
      const excluded = [...text.matchAll(norms), ...text.matchAll(slices)].map(match => [match.index, match.index + match[0].length]);
      for (const match of text.matchAll(unit)) {
        const at = match.index;
        if (/дд\s*\.$/iu.test(text.slice(Math.max(0, at - 8), at)) && /^\s*\.\s*г{2,4}/iu.test(text.slice(at + 2, at + 12))) continue;
        if (excluded.some(([start, end]) => at >= start && at < end)) continue;
        assert.match(text.slice(Math.max(0, at - 12), at), /\d+(?:[,.]\d+)?(?:\s*[xх×]\s*\d+(?:[,.]\d+)?)?\s*$/u, `${template.title}: ${text.slice(Math.max(0, at - 50), at + 5)}`);
      }
    });
  }
});

test('every source template highlights patient dimensions but leaves reference ranges and the standard contrast dose unhighlighted', () => {
  const number = String.raw`\d+(?:[,.]\d+)?`;
  const dimension = new RegExp(`${number}(?:\\s*[xх×]\\s*${number})?\\s*(?:см|мм|мл|м)(?:²|2)?(?![а-яё])`, 'gi');
  const excludedPatterns = [
    /(?:норм(?:а|ы|альный|альные|атив)|референсн\w*)[^.!?;\n]*/gi,
    /Омнискан\s+в\s+дозе\s+\d+(?:[,.]\d+)?\s*мл\s+на\s+кг\s+массы\s+тела/gi,
  ];
  let dimensions = 0;
  for (const template of mriTemplates) {
    const visit = node => {
      if (node.type === 'paragraph' && node.content) {
        const pieces = []; let offset = 0;
        for (const child of node.content) {
          const text = child.type === 'text' ? child.text ?? '' : child.type === 'hardBreak' ? '\n' : '';
          if (text) pieces.push({ start: offset, end: offset + text.length, marks: child.marks ?? [] });
          offset += text.length;
        }
        const text = node.content.map(child => child.type === 'text' ? child.text ?? '' : child.type === 'hardBreak' ? '\n' : '').join('');
        const excluded = excludedPatterns.flatMap(pattern => [...text.matchAll(pattern)].map(match => [match.index, match.index + match[0].length]));
        for (const match of text.matchAll(dimension)) {
          const start = match.index, end = start + match[0].length;
          if (excluded.some(([from, to]) => start < to && end > from)) continue;
          dimensions++;
          const covered = pieces.filter(piece => piece.start < end && piece.end > start);
          assert.ok(covered.length && covered.every(piece => piece.marks.some(mark => mark.type === 'highlight' && mark.attrs?.color === '#ffff00')), `${template.title}: ${match[0]}`);
        }
      }
      node.content?.forEach(visit);
    };
    visit(makeTemplateDocument(template.id));
  }
  assert.ok(dimensions > 600, `audited ${dimensions} dimensions`);
});

test('female pelvis templates add an editable cycle-day zero and keep the standard Omniscan dose unhighlighted', () => {
  for (const id of ['pelvis-omt-zh', 'pelvis-omt-zh-ku']) {
    const doc = makeTemplateDocument(id);
    const cycle = doc.content.find(node => node.type === 'paragraph' && plain(node).includes('День цикла:'));
    assert.ok(cycle, id);
    const field = cycle.content.find(node => node.type === 'reportField');
    assert.equal(field.attrs.hint, '0');
    assert.ok(cycle.content.every(node => node.marks?.some(mark => mark.type === 'bold')), 'entire cycle-day line is bold');
    const inline = prepareInlineDocument(doc);
    let emptyCycle = false;
    walk(inline, node => { if (node.type === 'text' && node.text === '0' && node.marks?.some(mark => mark.type === 'templateField' && mark.attrs?.id === `${id}.cycle-day` && mark.attrs?.filled === false)) emptyCycle = true; });
    assert.ok(emptyCycle, 'cycle-day zero stays an empty highlighted entry field');
    assert.match(visible(cycle), /^День цикла: ⟦0⟧ день$/);
    if (id.endsWith('-ku')) {
      const dose = [];
      walk(doc, node => { if (node.type === 'text' && /0,2/.test(node.text ?? '')) dose.push(node); });
      assert.ok(dose.length > 0, id);
      assert.ok(!dose.some(node => node.marks?.some(mark => mark.type === 'highlight' && mark.attrs?.color === '#ffff00')), id);
    }
  }
});

test('male pelvis protocols include the restored PI-RADS reference image', () => {
  for (const id of ['pelvis-omt-m', 'pelvis-omt-m-ku']) {
    const doc = makeTemplateDocument(id);
    validateTemplate(doc);
    const imageIndex = doc.content.findIndex(node => node.type === 'image' && node.attrs?.alt === 'Справочная схема PI-RADS v2.1 (2019)');
    assert.ok(imageIndex > 0, `${id}: PI-RADS image`);
    assert.match(doc.content[imageIndex].attrs.src, /^data:image\/png;base64,/);
    assert.ok(plain(doc.content[imageIndex - 1]).includes('Справочная информация. Удалять!'));
  }
});

test('default head protocol retains editable patient and doctor fields and omits age and clinical goal', () => {
  const doc = makeTemplateDocument(DEFAULT_TEMPLATE_ID);
  const fields = collectInlineFields(prepareInlineDocument(doc));
  assert.ok(fields.some(f => f.id.endsWith('.patient')));
  assert.ok(fields.some(f => f.id === DOCTOR_FIELD_ID));
  assert.doesNotMatch(plain(doc), /возраст пациента|полных лет|клиническ(?:ая|ие) (?:цель|сведения)/i);
});

test('archive slash alternatives are yellow editable report text', () => {
  const doc = makeTemplateDocument(DEFAULT_TEMPLATE_ID);
  const highlights = [];
  walk(doc, node => { for (const mark of node.marks ?? []) if (mark.type === 'highlight') highlights.push(node.text ?? ''); });
  assert.ok(highlights.length > 0);
  assert.ok(highlights.some(value => value.includes('/')));
});

test('clinical variants that require a radiologist choice are highlighted without highlighting fixed MRI sequences', () => {
  const expected = 'прямолинейный ход/S-образный ход/ С-образно изогнута вправо/влево';
  const docs = reportTemplates.map(template => makeTemplateDocument(template.id));
  let foundChoice = false, foundFixedSequence = false;
  for (const doc of docs) walk(doc, node => {
    if (node.type !== 'paragraph') return;
    let text = '', yellow = [];
    for (const child of node.content ?? []) {
      if (child.type !== 'text') continue;
      const content = child.text ?? '';
      text += content;
      yellow.push(...[...content].map(() => child.marks?.some(mark => mark.type === 'highlight' && mark.attrs?.color === '#ffff00')));
    }
    const at = text.indexOf(expected);
    if (at >= 0) { foundChoice = true; assert.ok(yellow.slice(at, at + expected.length).every(Boolean), 'all artery-shape choices should be highlighted'); }
    const sequenceAt = text.indexOf('жироподавлением /Т2-STIR/');
    if (sequenceAt >= 0) { foundFixedSequence = true; assert.ok(!yellow.slice(sequenceAt, sequenceAt + 'жироподавлением /Т2-STIR/'.length).some(Boolean), 'fixed MRI sequence notation stays unhighlighted'); }
  });
  assert.ok(foundChoice, 'the source catalog includes the artery-shape choice');
  assert.ok(foundFixedSequence, 'the source catalog includes a fixed sequence label');
});

test('numeric dimensions and indices use Russian decimal commas while dates keep dots', () => {
  const text = mriTemplates.map(t => visible(t.doc)).join('\n');
  assert.match(text, /22,6-26,0/);
  assert.match(text, /28,2-29,4/);
  assert.match(text, /1,5 Тесла/);
  assert.match(text, /дд\.мм\.гггг/);
  assert.doesNotMatch(text, /22\.6-26\.0|28\.2-29\.4|1\.5 Тесла/);
  assert.match(text, /размерами - 0,0 см/);
  const yellowZeros=[];
  for(const template of mriTemplates)walk(template.doc,node=>{if(node.type==='text'&&node.text==='0,0'&&node.marks?.some(mark=>mark.type==='highlight'&&mark.attrs?.color==='#ffff00'))yellowZeros.push(node);});
  assert.ok(yellowZeros.length>0);
  for(const template of mriTemplates)walk(template.doc,node=>{
    if(node.type!=='paragraph')return;
    const paragraph=visible(node);
    for(const match of paragraph.matchAll(/\bсм(?:²|2)?\b/gi)) assert.match(paragraph.slice(0,match.index),/\d(?:,\d+)?\s*$/,`${template.title}: missing centimetre value in ${paragraph}`);
    assert.doesNotMatch(paragraph.replace(/\d{1,2}\.\d{1,2}\.\d{4}/g,''),/(?<!\d)\d+\.\d+(?!\d)/,`${template.title}: decimal period remains in ${paragraph}`);
  });
});
