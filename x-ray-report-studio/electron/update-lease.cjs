const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const FORMAT = 'xrs-update-lease';
const STARTUP_GRACE_MS = 20000;
const HEARTBEAT_STALE_MS = 30000;

function profileKey(userDataDir) {
  let normalized = path.resolve(userDataDir).replaceAll('\\', '/');
  if (process.platform === 'win32') normalized = normalized.toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

function getUpdateLeaseFile(cacheRoot, userDataDir) {
  return path.join(path.resolve(cacheRoot), `profile-${profileKey(userDataDir)}.update-lock`);
}

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}

function leaseError(code) {
  const error = new Error(code === 'UPDATE_ALREADY_RUNNING'
    ? 'An update is already running for this profile.'
    : 'The active update lease could not be verified safely.');
  error.code = code;
  return error;
}

async function readLease(filename) {
  let value;
  try { value = JSON.parse(await fs.readFile(filename, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw leaseError('UPDATE_LEASE_UNVERIFIABLE');
  }
  if (value?.format !== FORMAT || value.schemaVersion !== 1 || typeof value.profileKey !== 'string'
      || !/^[a-f0-9]{32}$/.test(value.profileKey) || typeof value.attemptId !== 'string'
      || !/^[a-f0-9-]{36}$/i.test(value.attemptId) || !Number.isSafeInteger(value.ownerPid)
      || value.ownerPid <= 0 || !Number.isFinite(Date.parse(value.heartbeatAt)))
    throw leaseError('UPDATE_LEASE_UNVERIFIABLE');
  return value;
}

function leaseIsActive(value, now = Date.now(), alive = isProcessAlive) {
  if (!value) return false;
  const age = now - Date.parse(value.heartbeatAt);
  return alive(value.ownerPid) || age <= STARTUP_GRACE_MS || age <= HEARTBEAT_STALE_MS;
}

async function removeStaleLease(filename, expectedAttemptId) {
  const cleanupFile = `${filename}.cleanup`;
  let cleanup;
  try { cleanup = await fs.open(cleanupFile, 'wx'); }
  catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  }
  try {
    const current = await readLease(filename);
    if (!current || current.attemptId !== expectedAttemptId || leaseIsActive(current)) return false;
    await fs.unlink(filename).catch(error => { if (error?.code !== 'ENOENT') throw error; });
    return true;
  } finally {
    await cleanup.close().catch(() => {});
    await fs.unlink(cleanupFile).catch(() => {});
  }
}

async function removeOldUnverifiableLease(filename, now = Date.now()) {
  const cleanupFile = `${filename}.cleanup`;
  let cleanup;
  try { cleanup = await fs.open(cleanupFile, 'wx'); }
  catch (error) { if (error?.code === 'EEXIST') return false; throw error; }
  try {
    const stat = await fs.stat(filename).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error));
    if (!stat || now - stat.mtimeMs <= HEARTBEAT_STALE_MS) return false;
    await fs.unlink(filename).catch(error => { if (error?.code !== 'ENOENT') throw error; });
    return true;
  } finally {
    await cleanup.close().catch(() => {});
    await fs.unlink(cleanupFile).catch(() => {});
  }
}

async function inspectUpdateLease({ cacheRoot, userDataDir, now = Date.now(), alive = isProcessAlive }) {
  const filename = getUpdateLeaseFile(cacheRoot, userDataDir);
  let current;
  try { current = await readLease(filename); }
  catch (error) {
    if (error?.code !== 'UPDATE_LEASE_UNVERIFIABLE') throw error;
    if (await removeOldUnverifiableLease(filename, now)) return { active: false, leaseFile: filename, staleRemoved: true };
    throw error;
  }
  if (!current) return { active: false, leaseFile: filename, staleRemoved: false };
  if (current.profileKey !== profileKey(userDataDir)) throw leaseError('UPDATE_LEASE_UNVERIFIABLE');
  if (leaseIsActive(current, now, alive)) return { active: true, leaseFile: filename, ownerPid: current.ownerPid, attemptId: current.attemptId };
  const staleRemoved = await removeStaleLease(filename, current.attemptId);
  current = await readLease(filename);
  if (current) return { active: true, leaseFile: filename, ownerPid: current.ownerPid, attemptId: current.attemptId };
  return { active: false, leaseFile: filename, staleRemoved };
}

async function acquireUpdateLease({ cacheRoot, userDataDir, ownerPid = process.pid, attemptId = crypto.randomUUID() }) {
  const filename = getUpdateLeaseFile(cacheRoot, userDataDir);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const value = { format: FORMAT, schemaVersion: 1, profileKey: profileKey(userDataDir), attemptId, ownerPid, startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() };
  const create = async () => {
    const handle = await fs.open(filename, 'wx');
    try { await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    return { leaseFile: filename, ...value };
  };
  try { return await create(); }
  catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const inspection = await inspectUpdateLease({ cacheRoot, userDataDir });
    if (inspection.active) throw leaseError('UPDATE_ALREADY_RUNNING');
    try { return await create(); }
    catch (retryError) {
      if (retryError?.code === 'EEXIST') throw leaseError('UPDATE_ALREADY_RUNNING');
      throw retryError;
    }
  }
}

async function writeLeaseOwner(leaseFile, current, ownerPid) {
  const updated = { ...current, ownerPid, heartbeatAt: new Date().toISOString() };
  const temporary = `${leaseFile}.${current.attemptId}.tmp`;
  const handle = await fs.open(temporary, 'wx');
  try { await handle.writeFile(`${JSON.stringify(updated)}\n`, 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
  try { await fs.rename(temporary, leaseFile); }
  finally { await fs.unlink(temporary).catch(() => {}); }
  return updated;
}

async function claimUpdateLease(leaseFile, attemptId, parentPid, workerPid = process.pid) {
  const current = await readLease(leaseFile);
  if (!current || current.attemptId !== attemptId) throw leaseError('UPDATE_LEASE_LOST');
  if (current.ownerPid !== parentPid && current.ownerPid !== workerPid)
    throw leaseError('UPDATE_LEASE_OWNED_BY_OTHER_WORKER');
  return writeLeaseOwner(leaseFile, current, workerPid);
}

async function updateLease(leaseFile, attemptId, ownerPid = process.pid) {
  const current = await readLease(leaseFile);
  if (!current || current.attemptId !== attemptId || current.ownerPid !== ownerPid) throw leaseError('UPDATE_LEASE_LOST');
  return writeLeaseOwner(leaseFile, current, ownerPid);
}

async function releaseUpdateLease(leaseFile, attemptId, ownerPid) {
  if (typeof leaseFile !== 'string' || typeof attemptId !== 'string') return false;
  const current = await readLease(leaseFile);
  if (!current || current.attemptId !== attemptId || (ownerPid !== undefined && current.ownerPid !== ownerPid)) return false;
  await fs.unlink(leaseFile).catch(error => { if (error?.code !== 'ENOENT') throw error; });
  return true;
}

function startUpdateLeaseHeartbeat(leaseFile, attemptId, ownerPid = process.pid, intervalMs = 5000) {
  let renewal = Promise.resolve();
  const timer = setInterval(() => {
    renewal = renewal.then(() => updateLease(leaseFile, attemptId, ownerPid)).catch(() => {});
  }, intervalMs);
  timer.unref?.();
  return async () => { clearInterval(timer); await renewal; await releaseUpdateLease(leaseFile, attemptId, ownerPid); };
}

module.exports = { getUpdateLeaseFile, acquireUpdateLease, inspectUpdateLease, claimUpdateLease, updateLease, releaseUpdateLease, startUpdateLeaseHeartbeat, profileKey, leaseIsActive };
