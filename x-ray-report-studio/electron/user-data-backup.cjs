const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const EXCLUDED_TOP_LEVEL = new Set(['logs', 'cache', 'code cache', 'gpucache', 'dawncache', 'crashpad', 'crash reports']);
const CHROMIUM_SINGLETON_MARKERS = new Set(['singletonlock', 'singletoncookie', 'singletonsocket']);

function inside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

async function runWithFileRetry(action, onRetry = async () => {}, maxRetries = 4) {
  for (let attempt = 0; ; attempt++) {
    try { return await action(); }
    catch (error) {
      if (attempt >= maxRetries || !['EBUSY', 'EPERM'].includes(error?.code)) throw error;
      await onRetry(error, attempt + 1);
      await new Promise(resolve => setTimeout(resolve, 200 * (2 ** attempt)));
    }
  }
}

async function rejectSymlinkedPath(root, candidate) {
  const resolvedRoot = path.resolve(root), resolvedCandidate = path.resolve(candidate);
  if (!inside(resolvedRoot, resolvedCandidate)) throw new Error('Каталог резервных копий должен находиться в локальной папке профиля Windows.');
  let current = resolvedRoot;
  for (const part of path.relative(resolvedRoot, resolvedCandidate).split(path.sep).filter(Boolean)) {
    const stat = await fs.lstat(current).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (stat?.isSymbolicLink() || (stat && !stat.isDirectory())) throw new Error('Каталог резервных копий содержит небезопасный путь.');
    if (!stat) return;
    current = path.join(current, part);
  }
  const finalStat = await fs.lstat(current).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (finalStat?.isSymbolicLink() || (finalStat && !finalStat.isDirectory())) throw new Error('Каталог резервных копий имеет небезопасный тип.');
}

function isChromiumLevelDbLock(source) {
  const parts = path.resolve(source).split(path.sep);
  return path.basename(source).toLowerCase() === 'lock' && parts.slice(0, -1).some(part => part.toLowerCase() === 'leveldb');
}

function isChromiumSingletonMarker(source, profileRoot) {
  return path.dirname(path.resolve(source)) === path.resolve(profileRoot)
    && CHROMIUM_SINGLETON_MARKERS.has(path.basename(source).toLowerCase());
}

async function copyTree(source, destination, relativeBase, files, excludedFiles, profileRoot, onOperation = async () => {}) {
  const stat = await fs.lstat(source);
  if (isChromiumSingletonMarker(source, profileRoot) && (stat.isFile() || stat.isSymbolicLink() || stat.isSocket())) {
    excludedFiles.push({ path: path.relative(relativeBase, destination).split(path.sep).join('/'), reason: 'ephemeral-singleton-marker' });
    return;
  }
  if (stat.isSymbolicLink()) throw new Error('В профиле обнаружена символическая ссылка; резервирование отменено.');
  if (stat.isDirectory()) {
    await fs.mkdir(destination, { recursive: true });
    const entries = await fs.readdir(source, { withFileTypes: true });
    for (const entry of entries) await copyTree(path.join(source, entry.name), path.join(destination, entry.name), relativeBase, files, excludedFiles, profileRoot, onOperation);
    return;
  }
  if (!stat.isFile()) throw new Error('В профиле обнаружен неподдерживаемый тип файла; резервирование отменено.');
  // Chromium keeps this transient LevelDB mutex open while the app is running.
  // It contains no user data and is recreated by LevelDB when the database opens.
  // Keep all other files subject to the normal copy and SHA-256 verification.
  if (isChromiumLevelDbLock(source)) {
    excludedFiles.push({
      path: path.relative(relativeBase, destination).split(path.sep).join('/'),
      reason: 'ephemeral-leveldb-lock',
    });
    return;
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const relative = path.relative(relativeBase, destination).split(path.sep).join('/');
  const runOperation = async (operation, operationPath, action) => {
    await onOperation({ event: 'file-operation-start', phase: 'user-data-backup', operation, path: operationPath });
    let attempts = 0;
    try {
      const result = await runWithFileRetry(action, async (error, attempt) => {
        attempts = attempt;
        const errorCode = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(error.code) ? error.code : 'FILE_OPERATION_FAILED';
        await onOperation({ event: 'file-operation-retry', phase: 'user-data-backup', operation, path: operationPath, errorCode, attempt, recoveryAction: 'retry-transient-lock' });
      });
      await onOperation({ event: 'file-operation-complete', phase: 'user-data-backup', operation, path: operationPath, attempt: attempts + 1 });
      return result;
    } catch (error) {
      const errorCode = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(error.code) ? error.code : 'FILE_OPERATION_FAILED';
      const syscall = typeof error?.syscall === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(error.syscall) ? error.syscall : undefined;
      Object.defineProperty(error, 'backupRelativePath', { value: operationPath, configurable: true });
      await onOperation({ event: 'file-operation-error', phase: 'user-data-backup', operation, path: operationPath, errorCode, ...(syscall ? { syscall } : {}) });
      throw error;
    }
  };
  await runOperation('copy-file', relative, () => fs.copyFile(source, destination, require('node:fs').constants.COPYFILE_EXCL));
  const [sourceBytes, copyBytes] = await Promise.all([
    runOperation('read-source-for-sha256', relative, () => fs.readFile(source)),
    runOperation('read-backup-for-sha256', `${relative} (backup)`, () => fs.readFile(destination)),
  ]);
  const sourceHash = digest(sourceBytes);
  if (sourceHash !== digest(copyBytes)) throw new Error('Не удалось проверить целостность локальной резервной копии.');
  files.push({ path: path.relative(relativeBase, destination).split(path.sep).join('/'), bytes: copyBytes.length, sha256: sourceHash });
}

async function verifyUserDataBackup(directory, { onOperation = async () => {} } = {}) {
  const operation = async (name, relativePath, action) => {
    await onOperation({ event: 'file-operation-start', phase: 'user-data-backup-verify', operation: name, path: relativePath });
    try {
      const value = await runWithFileRetry(action, async (_error, attempt) => onOperation({ event: 'file-operation-retry', phase: 'user-data-backup-verify', operation: name, path: relativePath, errorCode: 'EBUSY', attempt, recoveryAction: 'retry-transient-lock' }));
      await onOperation({ event: 'file-operation-complete', phase: 'user-data-backup-verify', operation: name, path: relativePath });
      return value;
    } catch (error) {
      const errorCode = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(error.code) ? error.code : 'FILE_OPERATION_FAILED';
      const syscall = typeof error?.syscall === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(error.syscall) ? error.syscall : undefined;
      await onOperation({ event: 'file-operation-error', phase: 'user-data-backup-verify', operation: name, path: relativePath, errorCode, ...(syscall ? { syscall } : {}) });
      throw error;
    }
  };
  const manifestPath = path.join(directory, 'manifest.json');
  const manifestStat = await operation('inspect-manifest', 'backup/manifest.json', () => fs.lstat(manifestPath));
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error('Файл описания резервной копии имеет недопустимый тип.');
  const manifest = JSON.parse(await operation('read-manifest', 'backup/manifest.json', async () => (await fs.readFile(manifestPath, 'utf8'))));
  if (manifest?.format !== 'xrs-user-data-backup' || manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new Error('Файл описания резервной копии повреждён.');
  const seen = new Set();
  const safeManifestPath = value => typeof value === 'string' && value.length > 0 && !value.includes('\\') && !path.posix.isAbsolute(value) && !value.split('/').some(part => !part || part === '.' || part === '..');
  for (const file of manifest.files) {
    if (!file || !safeManifestPath(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Резервная копия содержит недопустимый путь.');
    if (seen.has(file.path)) throw new Error('Резервная копия содержит повторяющиеся записи.');
    seen.add(file.path);
    const target = path.resolve(directory, 'data', ...file.path.split('/'));
    if (!inside(path.join(directory, 'data'), target)) throw new Error('Резервная копия содержит выход за пределы каталога.');
    let parent = path.join(directory, 'data');
    for (const part of file.path.split('/')) {
      parent = path.join(parent, part);
      const diagnosticPath = `backup/${file.path}`;
      const stat = await operation('inspect-backup-path', diagnosticPath, () => fs.lstat(parent));
      if (stat.isSymbolicLink()) throw new Error('Резервная копия содержит символическую ссылку.');
    }
    if (!(await operation('inspect-backup-file', `backup/${file.path}`, () => fs.lstat(target))).isFile()) throw new Error('Резервная копия содержит неподдерживаемый тип файла.');
    const bytes = await operation('read-backup-file-for-sha256', `backup/${file.path}`, () => fs.readFile(target));
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw new Error('Проверка целостности резервной копии не пройдена.');
  }
  const excludedFiles = manifest.excludedFiles ?? [];
  if (!Array.isArray(excludedFiles)) throw new Error('Файл описания резервной копии повреждён.');
  for (const excluded of excludedFiles) {
    const parts = excluded?.path?.split('/');
    const levelDbLock = excluded?.reason === 'ephemeral-leveldb-lock' && parts?.at(-1)?.toLowerCase() === 'lock' && parts?.slice(0, -1).some(part => part.toLowerCase() === 'leveldb');
    const singletonMarker = excluded?.reason === 'ephemeral-singleton-marker' && parts?.length === 2 && parts[0].toLowerCase() === 'profile' && CHROMIUM_SINGLETON_MARKERS.has(parts[1].toLowerCase());
    if (!excluded || !safeManifestPath(excluded.path) || (!levelDbLock && !singletonMarker)) throw new Error('Резервная копия содержит недопустимое исключение.');
    if (seen.has(excluded.path)) throw new Error('Резервная копия содержит повторяющиеся записи.');
    seen.add(excluded.path);
    const target = path.resolve(directory, 'data', ...parts);
    if (!inside(path.join(directory, 'data'), target)) throw new Error('Резервная копия содержит выход за пределы каталога.');
    const stat = await fs.lstat(target).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (stat) throw new Error('Исключённый файл неожиданно присутствует в резервной копии.');
  }
  return { files: manifest.files.length, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0), excludedFiles: excludedFiles.length };
}

async function createUserDataBackup({ userDataDir, sharedDictionaryFile, backupRoot, allowedBackupRoot, forbiddenRoots = [], version = 'unknown', id = crypto.randomUUID(), onOperation }) {
  const userRoot = path.resolve(userDataDir);
  const finalRoot = path.resolve(backupRoot);
  if (inside(userRoot, finalRoot) || inside(finalRoot, userRoot)) throw new Error('Каталог резервных копий должен быть отдельным от профиля приложения.');
  if (allowedBackupRoot) await rejectSymlinkedPath(allowedBackupRoot, finalRoot);
  for (const forbiddenRoot of forbiddenRoots) if (inside(path.resolve(forbiddenRoot), finalRoot))
    throw new Error('Резервные копии не могут находиться рядом с удаляемой версией приложения.');
  const existingRoot = await fs.lstat(finalRoot).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (existingRoot?.isSymbolicLink() || (existingRoot && !existingRoot.isDirectory())) throw new Error('Каталог резервных копий имеет небезопасный тип.');
  await fs.mkdir(finalRoot, { recursive: true });
  const realRoot = await fs.realpath(finalRoot), realUserRoot = await fs.realpath(userRoot);
  if (inside(realUserRoot, realRoot) || inside(realRoot, realUserRoot)) throw new Error('Каталог резервных копий должен быть отдельным от профиля приложения.');
  if (allowedBackupRoot && !inside(await fs.realpath(allowedBackupRoot), realRoot)) throw new Error('Резервные копии должны оставаться в локальной папке профиля Windows.');
  for (const forbiddenRoot of forbiddenRoots) {
    const realForbiddenRoot = await fs.realpath(forbiddenRoot).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (realForbiddenRoot && (inside(realForbiddenRoot, realRoot) || inside(realRoot, realForbiddenRoot))) throw new Error('Резервные копии не могут находиться рядом с удаляемой версией приложения.');
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupId = `${stamp}_${String(id).replace(/[^A-Za-z0-9_-]/g, '')}`;
  const stage = path.join(realRoot, `.staging-${backupId}`);
  const target = path.join(realRoot, backupId);
  const files = [];
  const excludedFiles = [];
  const reportOperation = typeof onOperation === 'function' ? onOperation : async () => {};
  try {
    await reportOperation({ event: 'file-operation-start', phase: 'user-data-backup', operation: 'create-staging-directory', path: 'backup/<staging>' });
    await fs.mkdir(path.join(stage, 'data'), { recursive: true });
    await reportOperation({ event: 'file-operation-complete', phase: 'user-data-backup', operation: 'create-staging-directory', path: 'backup/<staging>' });
    const entries = await fs.readdir(userRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (EXCLUDED_TOP_LEVEL.has(entry.name.toLowerCase())) continue;
      await copyTree(path.join(userRoot, entry.name), path.join(stage, 'data', 'profile', entry.name), path.join(stage, 'data'), files, excludedFiles, userRoot, reportOperation);
    }
    if (sharedDictionaryFile) {
      const shared = path.resolve(sharedDictionaryFile);
      if (!inside(userRoot, shared) && await fs.stat(shared).then(stat => stat.isFile(), () => false))
        await copyTree(shared, path.join(stage, 'data', 'shared-dictionary.json'), path.join(stage, 'data'), files, excludedFiles, path.dirname(shared), reportOperation);
    }
    const manifest = { format: 'xrs-user-data-backup', schemaVersion: 1, applicationVersion: version, createdAt: new Date().toISOString(), files, excludedFiles };
    await reportOperation({ event: 'file-operation-start', phase: 'user-data-backup', operation: 'write-manifest', path: 'backup/<staging>/manifest.json' });
    await fs.writeFile(path.join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    await reportOperation({ event: 'file-operation-complete', phase: 'user-data-backup', operation: 'write-manifest', path: 'backup/<staging>/manifest.json' });
    await verifyUserDataBackup(stage, { onOperation: reportOperation });
    await reportOperation({ event: 'file-operation-start', phase: 'user-data-backup', operation: 'commit-verified-backup', path: 'backup/<staging>-to-<backup-id>' });
    await fs.rename(stage, target);
    await reportOperation({ event: 'file-operation-complete', phase: 'user-data-backup', operation: 'commit-verified-backup', path: 'backup/<backup-id>' });
    const verified = await verifyUserDataBackup(target, { onOperation: reportOperation });
    return { directory: target, ...verified };
  } catch (error) {
    try {
      await reportOperation({ event: 'file-operation-start', phase: 'user-data-backup-cleanup', operation: 'remove-incomplete-staging-backup', path: 'backup/<staging>' });
      await fs.rm(stage, { recursive: true, force: true });
      await reportOperation({ event: 'file-operation-complete', phase: 'user-data-backup-cleanup', operation: 'remove-incomplete-staging-backup', path: 'backup/<staging>' });
    } catch (cleanupError) {
      const errorCode = typeof cleanupError?.code === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(cleanupError.code) ? cleanupError.code : 'CLEANUP_FAILED';
      await reportOperation({ event: 'file-operation-error', phase: 'user-data-backup-cleanup', operation: 'remove-incomplete-staging-backup', path: 'backup/<staging>', errorCode, recoveryAction: 'leave-incomplete-stage-untrusted' }).catch(() => {});
    }
    throw error;
  }
}

module.exports = { createUserDataBackup, verifyUserDataBackup, runWithFileRetry };
