import test from 'node:test';
import assert from 'node:assert/strict';
import { ClinicalConsistencyEngine } from '../src/clinical-review.ts';

const engine = new ClinicalConsistencyEngine();
const review = (description, conclusion) => engine.validate({ description, conclusion });

test('decimal point survives sentence splitting and detects unequal NBSP sizes', () => {
  assert.equal(review('КТ: В печени образование 1.2\u00a0см.', 'КТ: В печени образование 18\u00a0мм.').length, 1);
});

test('equivalent decimal comma and point normalize to equal millimetres', () => {
  assert.equal(review('КТ: В печени образование 1,2 см.', 'КТ: В печени образование 12 мм.').length, 0);
  assert.equal(review('КТ: В печени образование 1.2\u00a0см.', 'КТ: В печени образование 12\u00a0мм.').length, 0);
});

test('ordinary, NBSP and narrow NBSP spacing are accepted for millimetre dimensions', () => {
  for (const gap of [' ', '\u00a0', '\u202f']) {
    assert.equal(review(`КТ: В печени образование 12${gap}мм.`, `КТ: В печени образование 18${gap}мм.`).length, 1, `U+${gap.codePointAt(0).toString(16)}`);
  }
});
