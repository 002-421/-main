import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportFilename, initials, shortPatientName } from '../src/report-filename.ts';

test('report filenames use protocol, doctor initials, patient surname and initials, template, and report date', () => {
  assert.equal(initials('Кочетов Сергей Владимирович'), 'КСВ');
  assert.equal(shortPatientName('Пигарева Елена Александровна'), 'Пигарева Е.А.');
  assert.equal(buildReportFilename({ number: '4018', doctor: 'Кочетов Сергей Владимирович', patient: 'Пигарева Елена Александровна', template: 'ШОП', date: '21.10.2026' }, '.docx', '01.11.2026'), '4018 КСВ Пигарева Е.А. ШОП 21.10.2026.docx');
});

test('filename falls back to today when report date is empty and removes invalid path characters', () => {
  assert.equal(buildReportFilename({ number: '4018/2', template: 'ШОП' }, '.pdf', '01.11.2026'), '4018_2 ШОП 01.11.2026.pdf');
});
