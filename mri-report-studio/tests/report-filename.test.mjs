import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportFilename, extractFilenameFields, initials, shortPatientName } from '../src/report-filename.ts';

test('report filenames use protocol, doctor initials, patient surname and initials, template, and report date', () => {
  assert.equal(initials('Кочетов Сергей Владимирович'), 'КСВ');
  assert.equal(shortPatientName('Пигарева Елена Александровна'), 'Пигарева Е.А.');
  assert.equal(shortPatientName('Русакова Г.Г.'), 'Русакова Г.Г.');
  assert.equal(buildReportFilename({ number: '4018', doctor: 'Кочетов Сергей Владимирович', patient: 'Пигарева Елена Александровна', template: 'ШОП', date: '21.10.2026' }, '.docx', '01.11.2026'), '4018 КСВ Пигарева Е.А. ШОП 21.10.2026.docx');
});

test('filename falls back to today when report date is empty and removes invalid path characters', () => {
  assert.equal(buildReportFilename({ number: '4018/2', template: 'ШОП' }, '.pdf', '01.11.2026'), '4018_2 ШОП 01.11.2026.pdf');
});

test('filename fields are recovered from visible report lines even when editable spans split a value', () => {
  const text = 'Протокол МРТ-исследования № 4214\nФ.И.О. пациента: Иванов Иван Андреевич\nДата рождения: 11.01.1990\nВрач: Кочетов Сергей Владимирович дата: 21.10.2026';
  const found = extractFilenameFields(text);
  assert.deepEqual(found, { number: '4214', patient: 'Иванов Иван Андреевич', doctor: 'Кочетов Сергей Владимирович', date: '21.10.2026' });
  assert.equal(buildReportFilename({ ...found, template: 'ГМ+Эпизиндром' }, '.docx', '01.11.2026'), '4214 КСВ Иванов И.А. ГМ+Эпизиндром 21.10.2026.docx');
});
