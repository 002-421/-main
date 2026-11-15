import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { acquireUpdateLease, inspectUpdateLease, claimUpdateLease, releaseUpdateLease, getUpdateLeaseFile } = require('../electron/update-lease.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xrs-update-lease-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, cacheRoot: path.join(root, 'verified'), userDataDir: path.join(root, 'Profile', 'MRI Report Studio') };
}

test('only one updater worker can acquire a lease for the same profile', async t => {
  const f = await fixture(t);
  const attempts = await Promise.allSettled([
    acquireUpdateLease(f),
    acquireUpdateLease(f),
  ]);
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(item => item.status === 'rejected' && item.reason.code === 'UPDATE_ALREADY_RUNNING').length, 1);
  const winner = attempts.find(item => item.status === 'fulfilled').value;
  const inspection = await inspectUpdateLease(f);
  assert.equal(inspection.active, true);
  assert.equal(inspection.attemptId, winner.attemptId);
});

test('worker adopts the parent lease, renews it, then releases only its own attempt', async t => {
  const f = await fixture(t);
  const lease = await acquireUpdateLease(f);
  await claimUpdateLease(lease.leaseFile, lease.attemptId, process.pid, process.pid);
  const value = JSON.parse(await fs.readFile(lease.leaseFile, 'utf8'));
  assert.equal(value.ownerPid, process.pid);
  assert.equal(await releaseUpdateLease(lease.leaseFile, '00000000-0000-4000-8000-000000000000'), false);
  assert.equal(await releaseUpdateLease(lease.leaseFile, lease.attemptId), true);
  assert.equal((await inspectUpdateLease(f)).active, false);
});

test('a second worker cannot claim or release the active attempt lease', async t => {
  const f = await fixture(t);
  const lease = await acquireUpdateLease({ ...f, ownerPid: process.pid });
  await claimUpdateLease(lease.leaseFile, lease.attemptId, process.pid, 43210);
  await assert.rejects(claimUpdateLease(lease.leaseFile, lease.attemptId, process.pid, 43211), { code: 'UPDATE_LEASE_OWNED_BY_OTHER_WORKER' });
  assert.equal(await releaseUpdateLease(lease.leaseFile, lease.attemptId, 43211), false);
  assert.equal((await inspectUpdateLease(f)).ownerPid, 43210);
  await releaseUpdateLease(lease.leaseFile, lease.attemptId, 43210);
});

test('a stale lease left by a crashed worker is cleared before a consecutive attempt', async t => {
  const f = await fixture(t);
  const filename = getUpdateLeaseFile(f.cacheRoot, f.userDataDir);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const old = {
    format: 'xrs-update-lease', schemaVersion: 1, profileKey: path.basename(filename).slice(8, 40),
    attemptId: '00000000-0000-4000-8000-000000000001', ownerPid: 987654321,
    startedAt: new Date(0).toISOString(), heartbeatAt: new Date(0).toISOString(),
  };
  await fs.writeFile(filename, JSON.stringify(old));
  const result = await acquireUpdateLease({ ...f, ownerPid: process.pid });
  assert.notEqual(result.attemptId, old.attemptId);
  assert.equal((await inspectUpdateLease(f)).attemptId, result.attemptId);
});

test('a fresh incomplete lease fails closed but an abandoned incomplete lock can be recovered', async t => {
  const f = await fixture(t);
  const filename = getUpdateLeaseFile(f.cacheRoot, f.userDataDir);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, '{partial');
  await assert.rejects(inspectUpdateLease(f), { code: 'UPDATE_LEASE_UNVERIFIABLE' });
  const recovered = await inspectUpdateLease({ ...f, now: Date.now() + 60000 });
  assert.equal(recovered.active, false);
  assert.equal(recovered.staleRemoved, true);
});
