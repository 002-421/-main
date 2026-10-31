import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRussianChecker, MAX_PROOF_ISSUES } from '../src/proofreading-core.ts';

// Exercise the actual bundled Russian dictionary, not a mock word list.
const aff = await readFile(new URL('../node_modules/dictionary-ru/index.aff', import.meta.url), 'utf8');
const dic = await readFile(new URL('../node_modules/dictionary-ru/index.dic', import.meta.url), 'utf8');
const englishAff = await readFile(new URL('../node_modules/dictionary-en/index.aff', import.meta.url), 'utf8');
const englishDic = await readFile(new URL('../node_modules/dictionary-en/index.dic', import.meta.url), 'utf8');
const check = createRussianChecker(aff, dic, englishAff, englishDic);

test('Russian misspellings have native word suggestions and exact UTF-16 offsets', async () => {
  const text = '🧠 Иследование головного мозга: измененния не выявлены.';
  const issues = await check(text);
  const first = issues.find(issue => issue.text === 'Иследование');
  assert.ok(first);
  assert.equal(first.kind, 'spelling');
  assert.ok(first.suggestions.includes('Исследование'));
  assert.equal(first.start, text.indexOf('Иследование'));
  assert.equal(text.slice(first.start, first.end), first.text);
  assert.ok(issues.find(issue => issue.text === 'измененния')?.suggestions.includes('изменения'));
});

test('dictionary recognises normal Russian inflections and radiology terminology', async () => {
  const text = 'На МРТ головного мозга выявлены гиперинтенсивные перивентрикулярные очаги глиоза. Субарахноидальные пространства не расширены. Ликвородинамика без нарушений. Контрастирование не проводилось. МР-ангиография: без особенностей. Хиазмально-селлярная область. Аденогипофиз. Переднезадняя ось. Мосто-мозжечковые углы. T1, T2, DWI, ADC, FLAIR.';
  assert.deepEqual(await check(text), []);
});

test('Latin misspellings are underlined while common MRI abbreviations and English sequence names are accepted', async () => {
  const text = 'Мама мыла раму. safsaf T1 T2 DWI ADC FLAIR STIR diffusion-weighted.';
  const issues = await check(text);
  const typo = issues.find(issue => issue.text === 'safsaf');
  assert.ok(typo);
  assert.equal(typo.kind, 'spelling');
  assert.equal(text.slice(typo.start, typo.end), 'safsaf');
  assert.deepEqual(issues.filter(issue => ['T1', 'T2', 'DWI', 'ADC', 'FLAIR', 'STIR', 'diffusion-weighted'].includes(issue.text)), []);
});

test('contextual grammar rules catch infinitive, agreement and preposition errors', async () => {
  const text = 'Очаг может находится в центре. Согласно заключения, очаговые изменение отсутствуют. Данные свидетельствует о динамике. В отличии от предыдущего исследования, в течении дня состояние стабильно.';
  const issues = (await check(text)).filter(issue => issue.kind === 'grammar');
  const suggestions = issues.flatMap(issue => issue.suggestions);
  for (const expected of ['находиться', 'Согласно заключению', 'очаговые изменения', 'Данные свидетельствуют', 'В отличие от', 'в течение']) {
    assert.ok(suggestions.includes(expected), `missing contextual suggestion: ${expected}`);
  }
  const fixed = issues.reduceRight((value, issue) => value.slice(0, issue.start) + issue.suggestions[0] + value.slice(issue.end), text);
  assert.equal((await check(fixed)).filter(issue => issue.kind === 'grammar').length, 0);
});

test('punctuation rules identify repeats and spacing without changing decimals or initials', async () => {
  const text = 'Очаг очаг не выявлен ,размеры  2,5 мм. И. И. Иванов. Заключение: без изменений.';
  const issues = (await check(text)).filter(issue => issue.kind === 'grammar');
  assert.ok(issues.some(issue => issue.message.includes('повторено') && issue.suggestions.includes('Очаг')));
  assert.ok(issues.some(issue => issue.text === ' ,' && issue.suggestions.includes(',')));
  assert.ok(issues.some(issue => issue.text === ',' && issue.suggestions.includes(', ')));
  assert.ok(issues.some(issue => issue.text === '  ' && issue.suggestions.includes(' ')));
  assert.equal(issues.some(issue => /2,5|И\./.test(issue.text)), false);
});

test('valid infinitives, prepositions, dates, unit abbreviations and clinical negation are not grammar errors', async () => {
  const text = 'Очаг может находиться в центре и не должен увеличиваться. Согласно заключению, изменения не выявлены. В отличие от прошлого исследования. В течение дня. В течении реки. Размеры 12,5 × 10 мм. Дата 27.10.2026. Слева — без особенностей.';
  assert.equal((await check(text)).filter(issue => issue.kind === 'grammar').length, 0);
});

test('personal vocabulary is case insensitive and does not modify the shared base dictionary', async () => {
  const text = 'Джумалиева';
  assert.ok((await check(text)).some(issue => issue.kind === 'spelling'));
  assert.deepEqual(await check(text, ['джумалиева']), []);
  assert.ok((await check(text)).some(issue => issue.kind === 'spelling'));
});

test('long uppercase words are still checked while short MRI abbreviations are ignored', async () => {
  const issues = await check('ИСЛЕДОВАНИЕ МРТ МРА МРВ КУ');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].text, 'ИСЛЕДОВАНИЕ');
});

test('issue count is bounded and each suggested replacement addresses its original text only', async () => {
  const text = 'Иследование не выявило изменений. '.repeat(250);
  const issues = await check(text);
  assert.equal(issues.length, MAX_PROOF_ISSUES);
  assert.ok(issues.every(issue => text.slice(issue.start, issue.end) === issue.text));
  assert.ok(issues.every(issue => issue.suggestions.length <= 3));
  const first = issues[0];
  const replaced = text.slice(0, first.start) + first.suggestions[0] + text.slice(first.end);
  assert.ok(replaced.startsWith('Исследование не выявило изменений.'));
});
