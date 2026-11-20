import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';

const helper = fileURLToPath(new URL('./windows-file-lock.py', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function holdWindowsFile(filename, root) {
  if (process.platform !== 'win32') throw new Error('Windows file-lock fixture requires Windows');
  const nonce = randomUUID();
  const started = Date.now();
  const readinessTimeoutMs = 10000;
  const diagnostic = {
    testPid: process.pid, startedAt: new Date(started).toISOString(),
    file: path.relative(root, filename), transport: 'Python _winapi.CreateFile, share mode 0',
    readinessTimeoutMs, events: [], childEvents: [], stderr: '',
  };
  const safe = value => String(value).replaceAll(root, '<synthetic-temp>');
  const record = (event, details = {}) => diagnostic.events.push({event, elapsedMs: Date.now() - started, ...details});
  const child = spawn('python', ['-I', '-S', '-u', helper, filename, nonce], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  diagnostic.childPid = child.pid;
  let ready, exit;
  const lines = createInterface({input: child.stdout});
  lines.on('line', line => {
    try {
      const event = JSON.parse(line);
      diagnostic.childEvents.push(event);
      if (event.event === 'LOCKED') {
        ready = event;
        record('ready-observed');
      }
    } catch {
      record('unexpected-stdout', {line: safe(line).slice(0, 1000)});
    }
  });
  child.stderr.setEncoding('utf8').on('data', chunk => {
    diagnostic.stderr = (diagnostic.stderr + safe(chunk)).slice(-8192);
  });
  child.on('spawn', () => record('spawn', {pid: child.pid}));
  child.on('error', error => record('spawn-error', {code: error.code}));
  child.stdin.on('error', error => record('stdin-error', {code: error.code}));
  child.on('close', (code, signal) => {
    exit = {code, signal};
    diagnostic.exit = exit;
    record('close', exit);
  });
  async function save() {
    const output = process.env.XRS_LOCK_DIAGNOSTICS_DIR ?? path.resolve('test-output/windows-backup-lock/holders');
    await fs.mkdir(output, {recursive: true});
    await fs.writeFile(path.join(output, nonce + '.json'), JSON.stringify(diagnostic, null, 2));
  }
  async function waitUntil(predicate, deadline) {
    while (!predicate() && Date.now() < deadline) await pause(25);
  }
  async function stop() {
    if (exit) return;
    record('release-request');
    child.stdin.end();
    await waitUntil(() => exit, Date.now() + 5000);
    if (exit) return;
    record('forced-fixture-stop');
    child.kill();
    await waitUntil(() => exit, Date.now() + 5000);
    if (!exit) throw new Error('Synthetic Windows lock holder did not terminate');
  }
  async function verifyUnlock() {
    const file = await fs.open(filename, 'r+');
    await file.close();
    record('unlock-verified');
  }

  try {
    await waitUntil(() => ready || exit, started + readinessTimeoutMs);
    if (!ready || exit) {
      const phase = diagnostic.childEvents.at(-1)?.event ?? 'before-helper-start';
      diagnostic.reason = exit ? 'child-exited-before-validation' : 'timeout-after-' + phase;
      throw new Error('Windows lock readiness was not received: ' + JSON.stringify(diagnostic));
    }
    if (ready.nonce !== nonce || ready.pid !== child.pid) throw new Error('Synthetic lock readiness identity mismatch');
    let lockCode;
    try {
      const file = await fs.open(filename, 'r+');
      await file.close();
    } catch (error) {
      lockCode = error.code;
    }
    if (!['EBUSY', 'EPERM', 'EACCES'].includes(lockCode)) {
      throw new Error('Windows helper announced readiness without an exclusive file lock: ' + lockCode);
    }
    record('lock-verified', {code: lockCode});
    await save();
    let released = false;
    return {ready, lockCode, async release() {
      if (released) return;
      released = true;
      try {
        await stop();
        await verifyUnlock();
        if (exit.code !== 0 || !diagnostic.childEvents.some(event => event.event === 'lock-disposed')) {
          throw new Error('Synthetic Windows lock holder did not exit cleanly: ' + JSON.stringify(exit));
        }
      } finally {
        await save();
      }
    }};
  } catch (error) {
    record('fixture-error', {message: safe(error.message)});
    try {
      await stop();
      await verifyUnlock();
    } catch (cleanup) {
      record('cleanup-error', {message: safe(cleanup.message)});
    }
    await save();
    throw error;
  }
}
