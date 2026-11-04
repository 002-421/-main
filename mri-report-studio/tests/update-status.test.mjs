import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { waitForUpdaterStatus } = require('../electron/update-status.cjs');

function clock() {
  let time = 0;
  return { now: () => time, wait: async ms => { time += ms; } };
}

test('updater waits for the final ready status after PowerShell exits', async () => {
  const timer = clock();
  let status = 'started';
  const result = await waitForUpdaterStatus({
    readStatus: async () => { if (timer.now() >= 500) status = 'ready'; return status; },
    getExitCode: () => 0,
    now: timer.now,
    wait: timer.wait,
    pollMs: 250,
  });
  assert.equal(result, 'ready');
});

test('updater reads a PowerShell error written just after process exit', async () => {
  const timer = clock();
  const result = await waitForUpdaterStatus({
    readStatus: async () => timer.now() < 500 ? 'started' : 'error: launch failed',
    getExitCode: () => 0,
    now: timer.now,
    wait: timer.wait,
    pollMs: 250,
  });
  assert.equal(result, 'error: launch failed');
});

test('updater reports a stable started status only after a grace period', async () => {
  const timer = clock();
  await assert.rejects(waitForUpdaterStatus({
    readStatus: async () => 'started',
    getExitCode: () => 0,
    now: timer.now,
    wait: timer.wait,
    pollMs: 250,
    exitGraceMs: 1000,
  }), /код 0; статус: started/);
  assert.equal(timer.now(), 1000);
});
