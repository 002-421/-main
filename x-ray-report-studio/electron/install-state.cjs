const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const CURRENT_DATA_SCHEMA = 1;

async function readJson(filename, fallback = null) {
  try { return JSON.parse(await fs.readFile(filename, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error('Файл состояния установки повреждён.'); }
}

async function writeJsonAtomic(filename, value) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = path.join(path.dirname(filename), `.xrs-state-${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    await fs.rename(temporary, filename);
  } finally { await fs.unlink(temporary).catch(() => {}); }
}

async function ensureDataSchema(filename, version = CURRENT_DATA_SCHEMA) {
  const current = await readJson(filename, null);
  if (current === null) {
    const created = { schemaVersion: version, updatedAt: new Date().toISOString() };
    await writeJsonAtomic(filename, created);
    return created;
  }
  if (!Number.isInteger(current.schemaVersion) || current.schemaVersion < 1) throw new Error('Версия формата пользовательских данных неизвестна.');
  return current;
}

function canRollback({ installState, dataState, currentRoot }) {
  if (installState?.status !== 'stable') return { available: false, reason: 'Текущая установка ещё не подтверждена как стабильная.' };
  const previous = installState?.previous;
  const current = installState?.current;
  if (!previous || !current || typeof current.root !== 'string' || typeof currentRoot !== 'string'
      || !path.isAbsolute(current.root) || !path.isAbsolute(currentRoot) || path.resolve(current.root) !== path.resolve(currentRoot))
    return { available: false, reason: 'Предыдущая установленная версия не зарегистрирована.' };
  if (!/^\d+\.\d+\.\d+$/.test(String(current.version)) || !/^\d+\.\d+\.\d+$/.test(String(previous.version))
      || typeof previous.root !== 'string' || typeof previous.executable !== 'string' || !path.isAbsolute(previous.root) || !path.isAbsolute(previous.executable))
    return { available: false, reason: 'Сведения о предыдущей версии неполны.' };
  if (!Number.isInteger(dataState?.schemaVersion) || !Number.isInteger(previous.dataSchemaVersion)
      || previous.dataSchemaVersion !== dataState.schemaVersion)
    return { available: false, reason: 'Формат данных изменился и не подтверждён для предыдущей версии.' };
  return { available: true, currentVersion: current.version, previousVersion: previous.version, previousRoot: previous.root, previousExecutable: previous.executable, dataSchemaVersion: dataState.schemaVersion };
}

module.exports = { CURRENT_DATA_SCHEMA, readJson, writeJsonAtomic, ensureDataSchema, canRollback };
