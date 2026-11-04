import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildPowerShellUpdaterArgs, waitForUpdaterStatus } = require('../electron/update-status.cjs');

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

test('updater includes captured PowerShell output when no status is written', async () => {
  const timer = clock();
  await assert.rejects(waitForUpdaterStatus({
    readStatus: async () => 'launching',
    getExitCode: () => 0,
    getFailureDetail: async () => 'Cannot find script file.',
    now: timer.now,
    wait: timer.wait,
    pollMs: 250,
    exitGraceMs: 500,
  }), /Вывод установщика: Cannot find script file\./);
});

test('PowerShell updater receives native -File named parameters with full Unicode paths', () => {
  const args = buildPowerShellUpdaterArgs({
    script: "C:\\Users\\Имя О'Connor\\resources\\app\\updater\\update_windows.ps1",
    archive: "C:\\Users\\Имя О'Connor\\Temp\\update.zip",
    currentRoot: "C:\\Users\\Имя О'Connor\\Desktop\\App_0.4.7",
    version: '0.4.8',
    statusFile: "C:\\Users\\Имя О'Connor\\Temp\\update.zip.status",
  });
  assert.deepEqual(args, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    "C:\\Users\\Имя О'Connor\\resources\\app\\updater\\update_windows.ps1",
    '-Archive', "C:\\Users\\Имя О'Connor\\Temp\\update.zip",
    '-CurrentRoot', "C:\\Users\\Имя О'Connor\\Desktop\\App_0.4.7",
    '-Version', '0.4.8', '-StatusFile', "C:\\Users\\Имя О'Connor\\Temp\\update.zip.status",
  ]);
});
