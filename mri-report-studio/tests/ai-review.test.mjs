import test from 'node:test';
import assert from 'node:assert/strict';
import { createAIReviewer, makeBatches, normalizeFindings, validateBlocks } from '../electron/ai-review.cjs';

test('review input is bounded and block ids are unique', () => {
  assert.deepEqual(validateBlocks([{ id: 'b0', text: 'Описание' }, { id: 'b1', text: '   ' }]), [{ id: 'b0', text: 'Описание' }]);
  assert.throws(() => validateBlocks([{ id: 'b0', text: 'one' }, { id: 'b0', text: 'two' }]), /Некорректный блок/);
  assert.throws(() => validateBlocks([{ id: 'b0', text: 'x'.repeat(8_001) }]), /Некорректный блок/);
});

test('long report blocks are batched without splitting a paragraph', () => {
  assert.deepEqual(makeBatches([{ id: 'b0', text: 'a'.repeat(5) }, { id: 'b1', text: 'b'.repeat(5) }, { id: 'b2', text: 'c' }], 8).map(batch => batch.map(block => block.id)), [['b0'], ['b1', 'b2']]);
  assert.throws(() => makeBatches([{ id: 'b0', text: 'x'.repeat(9) }], 8), /слишком длинный/);
});

test('model findings must cite an exact unambiguous passage from the report', () => {
  const blocks = [{ id: 'b0', text: 'В белом веществе определяется очаги.' }];
  const result = normalizeFindings({ findings: [
    { blockId: 'b0', quote: 'определяется очаги', category: 'grammar', severity: 'medium', explanation: 'Нарушено согласование.', suggestion: 'определяются очаги' },
    { blockId: 'b0', quote: 'придуманный фрагмент', category: 'meaning', severity: 'high', explanation: '...', suggestion: '...' },
    { blockId: 'b9', quote: 'очаги', category: 'grammar', severity: 'low', explanation: '...', suggestion: '...' },
  ] }, blocks);
  assert.equal(result.length, 1);
  assert.deepEqual({ start: result[0].start, end: result[0].end }, { start: 17, end: 35 });
});

test('local reviewer loads the model once and reports progress for each batch', async () => {
  let loads = 0;
  let prompts = 0;
  const events = [];
  const getLlama = async options => {
    assert.equal(options.gpu, false);
    return {
      createGrammarForJsonSchema: async schema => { assert.ok(schema.properties.findings); return {}; },
      loadModel: async options => { loads++; assert.equal(options.gpuLayers, 0); return { createContext: async () => ({ getSequence: () => ({}), dispose: async () => {} }) }; },
    };
  };
  const createSession = async () => ({ prompt: async prompt => {
    prompts++;
    assert.match(prompt, /не добавляй факты/);
    return JSON.stringify({ findings: [{ blockId: 'b0', quote: 'очаги определяется', category: 'grammar', severity: 'medium', explanation: 'Согласование.', suggestion: 'очаги определяются' }] });
  } });
  const reviewer = createAIReviewer({ getLlama, createSession });
  const blocks = [{ id: 'b0', text: 'В протоколе очаги определяется.' }];
  const first = await reviewer.review(blocks, '/cache/model.gguf', event => events.push(event));
  const second = await reviewer.review(blocks, '/cache/model.gguf', event => events.push(event));
  assert.equal(loads, 1);
  assert.equal(prompts, 2);
  assert.equal(first[0].suggestion, 'очаги определяются');
  assert.equal(second.length, 1);
  assert.ok(events.some(event => event.phase === 'loading'));
  assert.equal(events.filter(event => event.phase === 'review').length, 2);
});
