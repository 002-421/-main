const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createWriteStream, createReadStream } = require('node:fs');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

const QWEN3_8B = Object.freeze({
  id: 'qwen3-8b-q4_k_m-v1',
  filename: 'Qwen3-8B-Q4_K_M.gguf',
  url: 'https://huggingface.co/bartowski/Qwen_Qwen3-8B-GGUF/resolve/main/Qwen_Qwen3-8B-Q4_K_M.gguf?download=true',
  maxBytes: 10 * 1024 * 1024 * 1024,
});

function modelDirectory({ platform = process.platform, localAppData = process.env.LOCALAPPDATA, userData } = {}) {
  if (platform === 'win32' && localAppData) return path.join(localAppData, 'MRI Report Studio', 'ai-models');
  if (userData) return path.join(userData, 'ai-models');
  throw new Error('Не удалось определить постоянную папку для локальной модели.');
}

function createModelManager({ root, model = QWEN3_8B, fetchImpl = globalThis.fetch }) {
  if (!root || typeof fetchImpl !== 'function') throw new Error('Не настроено локальное хранилище модели.');
  const modelPath = path.join(root, model.filename);
  const partialPath = `${modelPath}.part`;
  const metadataPath = `${modelPath}.json`;

  async function status() {
    try {
      const [stat, metadata] = await Promise.all([
        fs.stat(modelPath), fs.readFile(metadataPath, 'utf8').then(JSON.parse),
      ]);
      const handle = await fs.open(modelPath, 'r');
      const magic = Buffer.alloc(4);
      try { await handle.read(magic, 0, 4, 0); } finally { await handle.close(); }
      if (magic.toString('ascii') === 'GGUF' && metadata.modelId === model.id && metadata.size === stat.size && metadata.size > 0 && /^[a-f0-9]{64}$/i.test(metadata.sha256 ?? '')) {
        return { ready: true, modelId: model.id, size: stat.size, path: modelPath };
      }
    } catch { /* Missing or incomplete cache; the downloader can resume its .part file. */ }
    let partialSize = 0;
    try { partialSize = (await fs.stat(partialPath)).size; } catch { /* Not downloaded yet. */ }
    return { ready: false, modelId: model.id, partialSize, path: modelPath };
  }

  async function verifyIntegrity() {
    const cached = await status();
    if (!cached.ready) return { valid: false, reason: 'missing' };
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(modelPath)) hash.update(chunk);
    if (hash.digest('hex') !== metadata.sha256) {
      await fs.rm(metadataPath, { force: true });
      return { valid: false, reason: 'checksum', size: cached.size };
    }
    return { valid: true, size: cached.size };
  }

  async function ensure(onProgress = () => {}) {
    const cached = await status();
    if (cached.ready) return cached;
    await fs.mkdir(root, { recursive: true });
    let offset = 0;
    try { offset = (await fs.stat(partialPath)).size; } catch { /* Start a new download. */ }
    if (offset > model.maxBytes) { await fs.rm(partialPath, { force: true }); offset = 0; }

    const response = await fetchImpl(model.url, {
      redirect: 'follow',
      ...(offset ? { headers: { Range: `bytes=${offset}-` } } : {}),
    });
    if (!(response.ok || response.status === 206) || !response.body) throw new Error(`Не удалось загрузить модель (HTTP ${response.status}).`);
    const range = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(response.headers.get('content-range') ?? '');
    const append = Boolean(offset && response.status === 206 && range && Number(range[1]) === offset);
    if (response.status === 206 && !append) throw new Error('Сервер прислал неполный файл модели с неверным диапазоном. Повторите загрузку.');
    if (!append) offset = 0;
    const contentLengthHeader = response.headers.get('content-length');
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : NaN;
    const total = range && range[3] !== '*'
      ? Number(range[3])
      : Number.isFinite(contentLength) ? offset + contentLength : 0;
    if (total > model.maxBytes) throw new Error('Размер файла модели превышает допустимый предел.');

    const hash = createHash('sha256');
    if (append) {
      for await (const chunk of createReadStream(partialPath)) hash.update(chunk);
    }
    let loaded = offset;
    const digest = new Transform({ transform(chunk, _encoding, done) { hash.update(chunk); loaded += chunk.length; onProgress({ loaded, total }); done(null, chunk); } });
    await pipeline(Readable.fromWeb(response.body), digest, createWriteStream(partialPath, { flags: append ? 'a' : 'w' }));
    const stat = await fs.stat(partialPath);
    if (total && stat.size !== total) throw new Error('Загрузка модели прервалась. Повторите запуск — загрузка продолжится с сохранённого места.');
    if (stat.size < 1024 * 1024) throw new Error('Загруженный файл модели слишком мал и не прошёл проверку.');

    await fs.rm(modelPath, { force: true });
    await fs.rm(metadataPath, { force: true });
    await fs.rename(partialPath, modelPath);
    const metadata = { modelId: model.id, size: stat.size, sha256: hash.digest('hex'), etag: response.headers.get('etag') ?? '', url: model.url };
    const temporaryMetadata = `${metadataPath}.tmp`;
    await fs.writeFile(temporaryMetadata, JSON.stringify(metadata), { flag: 'w' });
    await fs.rename(temporaryMetadata, metadataPath);
    return { ready: true, modelId: model.id, size: stat.size, path: modelPath };
  }

  return { model, modelPath, status, ensure, verifyIntegrity };
}

module.exports = { QWEN3_8B, modelDirectory, createModelManager };
