const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');

const MAX_ZIP_ENTRIES = 20000;
const MAX_ZIP_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let errorText = '';
    child.stderr?.on('data', chunk => { errorText = (errorText + chunk.toString()).slice(-3000); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(errorText.trim() || `${command} завершился с кодом ${code}.`)));
  });
}

function zipNameIsSafe(name) {
  if (!name || name.includes('\0') || name.includes('\\') || name.includes(':') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false;
  const parts = name.replace(/\/$/, '').split('/');
  return parts.length > 0 && parts.every(part => part && part !== '.' && part !== '..');
}

/** Validate ZIP central-directory names and metadata before invoking an extractor. */
function validateZipEntries(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  const minimum = Math.max(0, bytes.length - 65557);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= minimum; offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0 || eocd + 22 > bytes.length) throw new Error('Архив обновления не является корректным ZIP-файлом.');
  const disk = bytes.readUInt16LE(eocd + 4), centralDisk = bytes.readUInt16LE(eocd + 6);
  const diskEntries = bytes.readUInt16LE(eocd + 8), totalEntries = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12), centralOffset = bytes.readUInt32LE(eocd + 16);
  const commentLength = bytes.readUInt16LE(eocd + 20);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries || totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff
      || totalEntries > MAX_ZIP_ENTRIES || eocd + 22 + commentLength !== bytes.length
      || centralOffset + centralSize > eocd) throw new Error('Структура архива обновления повреждена или не поддерживается.');

  const entries = [];
  const seen = new Set();
  let offset = centralOffset, totalUncompressed = 0;
  for (let index = 0; index < totalEntries; index++) {
    if (offset + 46 > centralOffset + centralSize || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Каталог архива обновления повреждён.');
    const creator = bytes.readUInt8(offset + 5), flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20), uncompressed = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28), extraLength = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32);
    const startDisk = bytes.readUInt16LE(offset + 34), externalAttributes = bytes.readUInt32LE(offset + 38);
    const end = offset + 46 + nameLength + extraLength + comment;
    if (end > centralOffset + centralSize || startDisk !== 0 || (flags & 1) || ![0, 8].includes(method)) throw new Error('Архив содержит неподдерживаемую или зашифрованную запись.');
    const rawName = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const name = rawName.toString(flags & 0x800 ? 'utf8' : 'latin1');
    if (!zipNameIsSafe(name)) throw new Error('В архиве обнаружен небезопасный путь.');
    const normalized = name.replace(/\/$/, ''), key = normalized.toLocaleLowerCase('en-US');
    if (seen.has(key)) throw new Error('Архив содержит повторяющиеся пути.');
    seen.add(key);
    const unixMode = creator === 3 ? externalAttributes >>> 16 : 0;
    const fileType = unixMode & 0o170000;
    if (fileType === 0o120000 || (fileType !== 0 && fileType !== 0o100000 && fileType !== 0o040000)) throw new Error('В архиве обнаружен неподдерживаемый тип файла.');
    totalUncompressed += uncompressed;
    if (uncompressed > MAX_ZIP_UNCOMPRESSED_BYTES || totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES || (uncompressed > 0 && compressed === 0)) throw new Error('Размер распакованного архива превышает допустимый предел.');
    if (compressed > 0 && uncompressed / compressed > 1000) throw new Error('Архив имеет недопустимую степень сжатия.');
    entries.push({ name: normalized, directory: name.endsWith('/') || fileType === 0o040000 });
    offset = end;
  }
  if (offset !== centralOffset + centralSize) throw new Error('Каталог архива содержит лишние или повреждённые данные.');
  const files = new Set(entries.filter(entry => !entry.directory).map(entry => entry.name.toLocaleLowerCase('en-US')));
  for (const entry of entries) {
    const parts = entry.name.split('/');
    for (let i = 1; i < parts.length; i++) if (files.has(parts.slice(0, i).join('/').toLocaleLowerCase('en-US'))) throw new Error('Структура путей в архиве конфликтует.');
  }
  return entries;
}

async function extractWithTar(archive, destination, tarCommand = 'tar.exe') {
  const bytes = await fs.readFile(archive);
  const isZip = bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50;
  if (isZip || String(archive).toLowerCase().endsWith('.zip')) validateZipEntries(bytes);
  await run(tarCommand, ['-xf', archive, '-C', destination]);
}

function verifySha256(bytes, expected) {
  if (!/^[a-f0-9]{64}$/i.test(String(expected))) return false;
  return createHash('sha256').update(bytes).digest('hex') === String(expected).toLowerCase();
}

/** Install app files beside the running copy. The caller commits the shortcut only after smoke checks. */
async function installUpdateArchive({ archive, currentRoot, version, extractArchive = extractWithTar, log = () => {} }) {
  if (!/^\d+\.\d+\.\d+(?:-beta\.[1-9]\d*)?$/.test(String(version))) throw new Error('Некорректная версия обновления.');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'XRayReportStudio_Update_'));
  const parent = path.dirname(currentRoot);
  const stage = path.join(parent, `.X-ray_Report_Studio_stage_${randomUUID()}`);
  let newRoot;
  try {
    await log({ event: 'extract-start' });
    await extractArchive(archive, temporary);
    const sourceApp = path.join(temporary, 'X-ray Report Studio Setup', 'app');
    if (!(await fs.stat(path.join(sourceApp, 'electron', 'main.cjs')).catch(() => null))) throw new Error('В архиве обновления отсутствуют файлы приложения.');
    const packageInfo = JSON.parse(await fs.readFile(path.join(sourceApp, 'package.json'), 'utf8'));
    if (packageInfo.version !== version) throw new Error('Версия приложения в архиве не совпадает с манифестом обновления.');

    const safeVersion = String(version);
    newRoot = path.join(parent, `App_${safeVersion}`);
    if (await fs.stat(newRoot).then(() => true, () => false)) newRoot = path.join(parent, `App_${safeVersion}_${randomUUID().slice(0, 8)}`);
    await log({ event: 'runtime-copy-start' });
    await fs.cp(currentRoot, stage, {
      recursive: true, errorOnExist: true, force: false,
      filter: async source => path.basename(source).toLowerCase() !== 'default_app.asar',
    });
    const targetApp = path.join(stage, 'resources', 'app');
    await fs.rm(targetApp, { recursive: true, force: true });
    await fs.mkdir(path.dirname(targetApp), { recursive: true });
    await fs.cp(sourceApp, targetApp, { recursive: true, errorOnExist: true, force: false });
    const executable = path.join(stage, 'X-ray Report Studio.exe');
    if (!(await fs.stat(executable).catch(() => null))) throw new Error('В установленной копии не найден файл приложения.');
    await fs.rename(stage, newRoot);
    await log({ event: 'install-folder-ready', version });
    return { root: newRoot, executable: path.join(newRoot, 'X-ray Report Studio.exe'), icon: path.join(newRoot, 'resources', 'app', 'dist', 'x-ray-report-studio.ico'), version };
  } catch (error) {
    await log({ event: 'install-error', message: error.message });
    if (newRoot) await fs.rm(newRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
    await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
  }
}

async function writeShortcutAtomically({ shortcutPath, target, cwd, icon, writeShortcutLink }) {
  const directory = path.dirname(shortcutPath);
  const staged = path.join(directory, `.XRS-${randomUUID()}.lnk`);
  try {
    const written = await writeShortcutLink(staged, { target, cwd, icon, description: 'X-ray Report Studio' });
    if (!written) throw new Error('Не удалось подготовить ярлык приложения.');
    await fs.rename(staged, shortcutPath);
  } finally { await fs.unlink(staged).catch(() => {}); }
}

module.exports = { extractWithTar, installUpdateArchive, validateZipEntries, verifySha256, writeShortcutAtomically };
