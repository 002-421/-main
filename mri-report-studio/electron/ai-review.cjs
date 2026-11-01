const MAX_REPORT_CHARS = 100_000;
const MAX_BLOCK_CHARS = 8_000;
const MAX_BLOCKS = 500;

const findingSchema = {
  type: 'object', additionalProperties: false, required: ['findings'],
  properties: {
    findings: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['blockId', 'quote', 'category', 'severity', 'explanation', 'suggestion'],
      properties: {
        blockId: { type: 'string' },
        quote: { type: 'string' },
        category: { type: 'string', enum: ['grammar', 'style', 'meaning'] },
        severity: { type: 'string', enum: ['low', 'medium', 'high'] },
        explanation: { type: 'string' },
        suggestion: { type: 'string' },
      },
    } },
  },
};

function validateBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length > MAX_BLOCKS) throw new Error('Некорректная структура описания.');
  let chars = 0;
  const ids = new Set();
  return blocks.map(block => {
    if (!block || typeof block.id !== 'string' || !/^b\d+$/.test(block.id) || ids.has(block.id) || typeof block.text !== 'string' || block.text.length > MAX_BLOCK_CHARS) {
      throw new Error('Некорректный блок описания.');
    }
    ids.add(block.id);
    chars += block.text.length;
    if (chars > MAX_REPORT_CHARS) throw new Error('Описание слишком длинное для локальной проверки (максимум 100 000 символов).');
    return { id: block.id, text: block.text };
  }).filter(block => block.text.trim());
}

function normalizeFindings(raw, allowedBlocks) {
  let data;
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new Error('Локальная модель вернула ответ, который не удалось разобрать. Повторите проверку.');
  }
  if (!data || !Array.isArray(data.findings)) throw new Error('Локальная модель вернула ответ неизвестного формата.');
  const blocks = new Map(allowedBlocks.map(block => [block.id, block.text]));
  const seen = new Set();
  return data.findings.slice(0, 100).flatMap(item => {
    if (!item || !blocks.has(item.blockId) || typeof item.quote !== 'string' || item.quote.length < 2 || item.quote.length > 500) return [];
    const original = blocks.get(item.blockId);
    const start = original.indexOf(item.quote);
    if (start < 0 || original.indexOf(item.quote, start + 1) >= 0) return [];
    if (!['grammar', 'style', 'meaning'].includes(item.category) || !['low', 'medium', 'high'].includes(item.severity)) return [];
    const explanation = String(item.explanation ?? '').trim().slice(0, 800);
    const suggestion = String(item.suggestion ?? '').trim().slice(0, 800);
    const key = `${item.blockId}\u0000${start}\u0000${item.quote}`;
    if (!explanation || seen.has(key)) return [];
    seen.add(key);
    return [{ blockId: item.blockId, quote: item.quote, start, end: start + item.quote.length, category: item.category, severity: item.severity, explanation, suggestion }];
  });
}

function makeBatches(blocks, maxChars = 8_000) {
  const batches = [];
  let current = [];
  let length = 0;
  for (const block of blocks) {
    if (block.text.length > maxChars) throw new Error(`Блок ${block.id} слишком длинный. Разделите его на несколько абзацев.`);
    if (current.length && length + block.text.length > maxChars) {
      batches.push(current);
      current = [];
      length = 0;
    }
    current.push(block);
    length += block.text.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

function createAIReviewer({
  getLlama = async options => (await import('node-llama-cpp')).getLlama(options),
  createSession = async options => { const { LlamaChatSession } = await import('node-llama-cpp'); return new LlamaChatSession(options); },
} = {}) {
  let modelPath;
  let llamaPromise;
  let modelPromise;

  async function loadModel(path, onProgress) {
    if (modelPromise && modelPath === path) return modelPromise;
    if (modelPromise && modelPath !== path) throw new Error('Уже загружается другая модель.');
    modelPath = path;
    llamaPromise ??= getLlama({ gpu: false, build: 'never', progressLogs: false, logLevel: 'error' });
    onProgress({ phase: 'loading' });
    modelPromise = (async () => {
      const llama = await llamaPromise;
      const model = await llama.loadModel({ modelPath: path, gpuLayers: 0, useMmap: true });
      onProgress({ phase: 'loaded' });
      return { llama, model };
    })();
    try { return await modelPromise; } catch (error) {
      modelPromise = undefined;
      modelPath = undefined;
      const wrapped = new Error(error?.message === 'Failed to load model'
        ? 'Встроенный движок не смог открыть файл Qwen из кэша.'
        : `Не удалось запустить встроенный движок модели: ${error?.message ?? 'неизвестная ошибка'}`);
      wrapped.code = 'AI_MODEL_LOAD_FAILED';
      throw wrapped;
    }
  }

  async function review(blocksInput, path, onProgress = () => {}) {
    const blocks = validateBlocks(blocksInput);
    if (!blocks.length) return [];
    const { llama, model } = await loadModel(path, event => onProgress({ phase: 'loading', ...event }));
    const grammar = await llama.createGrammarForJsonSchema(findingSchema);
    const batches = makeBatches(blocks);
    const findings = [];
    for (let index = 0; index < batches.length; index++) {
      const batch = batches[index];
      const context = await model.createContext({ contextSize: 8192 });
      try {
        const session = await createSession({ contextSequence: context.getSequence() });
        const payload = batch.map(({ id, text }) => ({ id, text }));
        const answer = await session.prompt(
          `/no_think\nПроверь русскоязычный медицинский протокол МРТ только на ошибки русского языка, профессиональную ясность формулировок и очевидные внутренние смысловые противоречия. Не ставь диагноз, не добавляй факты и не меняй медицинский смысл. Сохраняй числа, единицы, стороны, отрицания, даты и клиническую неопределённость. Не считай намеренно незаполненные поля ошибками. Возвращай замечание только при конкретной причине для правки. Для каждого замечания укажи точную непрерывную цитату из одного блока без изменений, его id, категорию grammar/style/meaning, важность low/medium/high, краткое объяснение и осторожный вариант исправления. Если замечаний нет, верни пустой массив findings.\nБлоки протокола:\n${JSON.stringify(payload)}`,
          { grammar, maxTokens: 1400, temperature: 0 },
        );
        findings.push(...normalizeFindings(answer, batch));
      } finally { await context.dispose(); }
      onProgress({ phase: 'review', completed: index + 1, total: batches.length });
    }
    const deduped = new Map();
    for (const finding of findings) deduped.set(`${finding.blockId}:${finding.start}:${finding.quote}`, finding);
    return [...deduped.values()];
  }

  return { review };
}

module.exports = { MAX_REPORT_CHARS, findingSchema, validateBlocks, normalizeFindings, makeBatches, createAIReviewer };
