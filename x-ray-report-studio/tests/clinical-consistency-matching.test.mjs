import test from 'node:test';
import assert from 'node:assert/strict';
import { ClinicalConsistencyEngine } from '../src/clinical-review.ts';

const engine=new ClinicalConsistencyEngine();
const review=(description,conclusion)=>engine.validate({description,conclusion});

test('does not cross-match multiple same-type findings by size, site or side',()=>{
  const cases=[
    ['two equal-size foci in different lobes',
      'МРТ: Очаг 4 мм в лобной доле. Очаг 4 мм в затылочной доле.',
      'МРТ: Очаг 4 мм в лобной доле. Очаг 4 мм в затылочной доле.'],
    ['multiple same-site foci with sizes in a different order',
      'МРТ: Очаг в лобной доле 4 мм. Очаг в лобной доле 8 мм.',
      'МРТ: Очаг в лобной доле 8 мм. Очаг в лобной доле 4 мм.'],
    ['independent right and left lung nodules',
      'КТ: Узел в правом легком 4 мм. Узел в левом легком 4 мм.',
      'КТ: Узел в правом легком 4 мм. Узел в левом легком 4 мм.'],
    ['multiple foci without a recognized location',
      'МРТ: Очаг 4 мм. Очаг 8 мм.',
      'МРТ: Очаг 4 мм. Очаг 8 мм.'],
    ['several findings in one sentence',
      'МРТ: Очаг 4 мм в лобной доле и очаг 8 мм в затылочной доле.',
      'МРТ: Очаг 4 мм в лобной доле и очаг 8 мм в затылочной доле.'],
  ];
  for(const [label,description,conclusion] of cases)assert.deepEqual(review(description,conclusion),[],label);
});

test('still compares a unique finding when its side or size differs',()=>{
  assert.equal(review('КТ: Узел плевры справа 3 мм.','КТ: Узел плевры слева 3 мм.').length,1);
  assert.equal(review('КТ: В печени образование 12 мм.','КТ: В печени образование 18 мм.').length,1);
});
