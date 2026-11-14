const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { CURRENT_DATA_CONTRACT, DATA_SCHEMA_VERSION, applicationSupportsDataContract } = require('./data-compatibility.cjs');
const { parseVersion, compareVersions } = require('./update-version.cjs');

const CURRENT_DATA_SCHEMA = DATA_SCHEMA_VERSION;

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

async function ensureDataSchema(filename, version = CURRENT_DATA_SCHEMA, dataContract = CURRENT_DATA_CONTRACT) {
  const current = await readJson(filename, null);
  if (current === null) {
    const created = { schemaVersion: version, dataContract, updatedAt: new Date().toISOString() };
    await writeJsonAtomic(filename, created);
    return created;
  }
  if (!Number.isInteger(current.schemaVersion) || current.schemaVersion < 1) throw new Error('Версия формата пользовательских данных неизвестна.');
  if (current.dataContract === undefined && current.schemaVersion === version) {
    const upgraded = { ...current, dataContract };
    await writeJsonAtomic(filename, upgraded);
    return upgraded;
  }
  return current;
}

function canRollback({ installState, dataState, currentRoot }) {
  if (installState?.status !== 'stable') return { available: false, reason: 'Текущая установка ещё не подтверждена как стабильная.' };
  const previous = installState?.previous;
  const current = installState?.current;
  if (!previous || !current || typeof current.root !== 'string' || typeof currentRoot !== 'string'
      || !samePath(current.root, currentRoot))
    return { available: false, reason: 'Предыдущая установленная версия не зарегистрирована.' };
  if (!parseVersion(current.version) || !parseVersion(previous.version)
      || typeof previous.root !== 'string' || typeof previous.executable !== 'string' || !path.isAbsolute(previous.root) || !path.isAbsolute(previous.executable))
    return { available: false, reason: 'Сведения о предыдущей версии неполны.' };
  if (!Number.isInteger(dataState?.schemaVersion) || !Number.isInteger(previous.dataSchemaVersion)
      || previous.dataSchemaVersion !== dataState.schemaVersion
      || !applicationSupportsDataContract(previous.version, dataState.dataContract, dataState.schemaVersion))
    return { available: false, reason: 'Формат данных изменился и не подтверждён для предыдущей версии.' };
  return { available: true, currentVersion: current.version, previousVersion: previous.version, previousRoot: previous.root, previousExecutable: previous.executable, dataSchemaVersion: dataState.schemaVersion, dataContract: dataState.dataContract };
}

function canonicalPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return null;
  const resolved = path.resolve(value);
  try {
    const real = fsSync.realpathSync.native(resolved);
    const withoutWindowsNamespace = process.platform === 'win32'
      ? real.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '')
      : real;
    return path.resolve(withoutWindowsNamespace);
  } catch {
    return resolved;
  }
}

function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !path.isAbsolute(left) || !path.isAbsolute(right)) return false;
  const a = canonicalPath(left), b = canonicalPath(right);
  if (a === null || b === null) return false;
  return process.platform === 'win32' ? a.toLocaleLowerCase('en-US') === b.toLocaleLowerCase('en-US') : a === b;
}

function isVersionedInstallRoot(root, version) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || !parseVersion(version)) return false;
  const name = path.basename(root);
  return name === `App_${version}` || new RegExp(`^App_${version.replaceAll('.', '\\.')}[-_][a-f0-9]{8}$`, 'i').test(name);
}

// Repair only a stale Stable pointer when the live runtime, its bundled app
// metadata, the retained previous install, and the actual Windows shortcut all
// independently agree. This changes install metadata only; it never touches
// profile contents or promotes a pending/unknown installation.
function reconcileStableInstallState({ installState, dataState, runtimeVersion, runtimeRoot, runtimeExecutable, runtimeAppPath, shortcutTarget }) {
  if (installState?.status !== 'stable' || !parseVersion(runtimeVersion)
      || !Number.isInteger(dataState?.schemaVersion)
      || !applicationSupportsDataContract(runtimeVersion, dataState.dataContract, dataState.schemaVersion)
      || !isVersionedInstallRoot(runtimeRoot, runtimeVersion)
      || !isVersionedInstallRoot(installState.current?.root, installState.current?.version)
      || !parseVersion(installState.current?.version)
      || compareVersions(runtimeVersion, installState.current.version) <= 0
      || !Number.isInteger(installState.current?.dataSchemaVersion)
      || installState.current.dataSchemaVersion !== dataState.schemaVersion
      || !applicationSupportsDataContract(installState.current.version, dataState.dataContract, dataState.schemaVersion)
      || typeof installState.current.executable !== 'string'
      || !samePath(installState.current.executable, path.join(installState.current.root, 'X-ray Report Studio.exe'))) return null;

  const runtimeExe = path.join(runtimeRoot, 'X-ray Report Studio.exe');
  const runtimeResourcesApp = path.join(runtimeRoot, 'resources', 'app');
  if (!samePath(runtimeExecutable, runtimeExe) || !samePath(shortcutTarget, runtimeExe)
      || !samePath(runtimeAppPath, runtimeResourcesApp)
      || !samePath(path.dirname(canonicalPath(runtimeExe) ?? ''), canonicalPath(runtimeRoot) ?? '')
      || !samePath(path.dirname(canonicalPath(installState.current.executable) ?? ''), canonicalPath(installState.current.root) ?? '')) return null;
  const statIs = (filename, kind) => {
    try { const stat = fsSync.lstatSync(filename); return kind === 'directory' ? stat.isDirectory() : stat.isFile(); }
    catch { return false; }
  };
  if (!statIs(runtimeExe, 'file') || !statIs(runtimeResourcesApp, 'directory')
      || !statIs(installState.current.executable, 'file')) return null;
  try {
    const metadataFile = path.join(runtimeResourcesApp, 'package.json');
    const metadata = JSON.parse(fsSync.readFileSync(metadataFile, 'utf8'));
    if (metadata.version !== runtimeVersion || typeof metadata.main !== 'string' || !metadata.main
        || path.isAbsolute(metadata.main)) return null;
    const mainFile = path.resolve(runtimeResourcesApp, metadata.main);
    const relativeMain = path.relative(runtimeResourcesApp, mainFile);
    if (relativeMain.startsWith(`..${path.sep}`) || relativeMain === '..' || path.isAbsolute(relativeMain)
        || !statIs(mainFile, 'file')) return null;
  } catch { return null; }

  return {
    ...installState,
    status: 'stable',
    launchAttempts: 0,
    current: {
      version: runtimeVersion,
      root: runtimeRoot,
      executable: runtimeExe,
      dataSchemaVersion: dataState.schemaVersion,
    },
    previous: { ...installState.current },
  };
}

function getPendingFirstStartAction(installState, runtimeRoot, runtimeExecutable = path.join(runtimeRoot, 'X-ray Report Studio.exe'), runtimeVersion = installState?.current?.version) {
  if (installState?.status !== 'pending-first-start') return 'normal';
  const currentRoot = installState.current?.root;
  const currentExecutable = installState.current?.executable;
  const version = String(installState.current?.version ?? '');
  const rootName = path.basename(currentRoot ?? '');
  const expectedRootName = `App_${version}`;
  const versionPattern = parseVersion(version) ? new RegExp(`^App_${version.replaceAll('.', '\\.')}[-_][a-f0-9]{8}$`, 'i') : null;
  const validVersionRoot = rootName === expectedRootName || Boolean(versionPattern?.test(rootName));
  if (!parseVersion(version) || !validVersionRoot || !samePath(path.dirname(currentExecutable ?? ''), currentRoot)
      || !samePath(currentExecutable, path.join(currentRoot, 'X-ray Report Studio.exe'))) return 'blocked';
  if (runtimeVersion === version && samePath(currentRoot, runtimeRoot) && samePath(currentExecutable, runtimeExecutable)) return 'candidate';
  if (installState.previous?.version === runtimeVersion
      && samePath(installState.previous?.root, runtimeRoot)
      && samePath(installState.previous?.executable, runtimeExecutable)) return 'handoff-to-candidate';
  return 'blocked';
}

function isInstallConfirmed(installState, runtimeRoot, runtimeExecutable = path.join(runtimeRoot, 'X-ray Report Studio.exe'), runtimeVersion = installState?.current?.version) {
  if (installState == null) return true;
  return installState.status === 'stable'
    && typeof installState.current?.root === 'string'
    && runtimeVersion === installState.current.version
    && samePath(installState.current.root, runtimeRoot)
    && samePath(installState.current.executable, runtimeExecutable);
}

function recordFirstStartAttempt(installState, runtimeRoot, runtimeExecutable = path.join(runtimeRoot, 'X-ray Report Studio.exe'), runtimeVersion = installState?.current?.version, timestamp = new Date().toISOString()) {
  if (getPendingFirstStartAction(installState, runtimeRoot, runtimeExecutable, runtimeVersion) !== 'candidate'
      || Number(installState.launchAttempts) !== 0) throw new Error('Первый запуск должен выполняться из установленной версии.');
  return { ...installState, launchAttempts: 1, lastLaunchAt: timestamp };
}

function confirmFirstStart(installState, runtimeRoot, runtimeExecutable = path.join(runtimeRoot, 'X-ray Report Studio.exe'), runtimeVersion = installState?.current?.version, timestamp = new Date().toISOString()) {
  if (getPendingFirstStartAction(installState, runtimeRoot, runtimeExecutable, runtimeVersion) !== 'candidate'
      || Number(installState.launchAttempts) !== 1) throw new Error('Нельзя подтвердить запуск неподтверждённой версии.');
  return { ...installState, status: 'stable', launchAttempts: 0, healthyAt: timestamp };
}

module.exports = {
  CURRENT_DATA_SCHEMA, readJson, writeJsonAtomic, ensureDataSchema, canRollback,
  canonicalPath, samePath, isVersionedInstallRoot, reconcileStableInstallState,
  getPendingFirstStartAction, isInstallConfirmed, recordFirstStartAttempt, confirmFirstStart,
};
