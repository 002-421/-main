const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

function pathApi(value) { return /\\/.test(value) ? require('node:path').win32 : require('node:path'); }

function isWithin(root, candidate) {
  const api = pathApi(root);
  const left = api.resolve(root).replace(/[\\/]+$/, '').toLowerCase();
  const right = api.resolve(candidate).toLowerCase();
  return right === left || right.startsWith(`${left}${api.sep}`);
}

function profileArgumentMatches(commandLine, profile) {
  if (typeof commandLine !== 'string' || !commandLine) return false;
  const escaped = profile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|\\s)--user-data-dir=(?:"${escaped}"|'${escaped}'|${escaped}(?=\\s|$))`, 'i');
  return pattern.test(commandLine);
}

function findDescendants(processes, rootPid) {
  const descendants = new Set([Number(rootPid)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of processes) {
      const pid = Number(item.ProcessId ?? item.pid);
      const parent = Number(item.ParentProcessId ?? item.parentPid);
      if (Number.isSafeInteger(pid) && Number.isSafeInteger(parent) && descendants.has(parent) && !descendants.has(pid)) {
        descendants.add(pid);
        changed = true;
      }
    }
  }
  descendants.delete(Number(rootPid));
  return descendants;
}

function classifyOtherXrsProcesses(processes, { installRoot, userDataDir, workerPid = process.pid, processTree = processes } = {}) {
  const rows = Array.isArray(processes) ? processes : processes ? [processes] : [];
  const descendants = findDescendants(Array.isArray(processTree) ? processTree : [], workerPid);
  const result = [];
  for (const item of rows) {
    const pid = Number(item.ProcessId ?? item.pid);
    const parentPid = Number(item.ParentProcessId ?? item.parentPid);
    const name = String(item.Name ?? item.name ?? '');
    if (!Number.isSafeInteger(pid) || pid === Number(workerPid) || descendants.has(pid) || name.toLowerCase() !== 'x-ray report studio.exe') continue;
    const executablePath = String(item.ExecutablePath ?? item.executablePath ?? '');
    const commandLine = String(item.CommandLine ?? item.commandLine ?? '');
    const hasExplicitProfile = /(?:^|\s)--user-data-dir=/i.test(commandLine);
    // Normal XRS launches use the established default profile without a switch.
    // The independent worker always supplies its isolated worker profile.
    const matchesProfile = hasExplicitProfile ? profileArgumentMatches(commandLine, userDataDir) : true;
    const matchesInstall = Boolean(executablePath && isWithin(installRoot, executablePath) && !hasExplicitProfile);
    const isUpdateWorker = /(?:^|\s)--xrs-update-worker(?:\s|$)/i.test(commandLine);
    if (!matchesInstall && !matchesProfile && !isUpdateWorker) continue;
    const typeMatch = commandLine.match(/(?:^|\s)--type=([a-z0-9_-]+)/i);
    result.push({
      pid,
      ...(Number.isSafeInteger(parentPid) ? { parentPid } : {}),
      name: 'X-ray Report Studio.exe',
      processType: isUpdateWorker ? 'update-worker'
        : typeMatch ? `electron-${typeMatch[1].toLowerCase()}` : 'electron-main',
      matchesInstall,
      matchesProfile,
      matchesWorker: isUpdateWorker,
    });
  }
  return result;
}

async function inspectOtherXrsProcesses({ installRoot, userDataDir, workerPid = process.pid, run = execFileAsync, platform = process.platform }) {
  if (platform !== 'win32') return [];
  const script = [
    "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue';",
    "$all = @(Get-CimInstance Win32_Process -ErrorAction Stop);",
    "$rows = @($all | Where-Object { $_.Name -ieq 'X-ray Report Studio.exe' } | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine);",
    "$tree = @($all | Select-Object ProcessId,ParentProcessId);",
    "ConvertTo-Json -InputObject ([ordered]@{processes=$rows; processTree=$tree}) -Compress -Depth 4",
  ].join(' ');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    windowsHide: true, timeout: 15000, env: {
      ...process.env,
      XRS_INSTALL_ROOT: installRoot,
      XRS_PROFILE_PATH: userDataDir,
      XRS_WORKER_PID: String(workerPid),
    },
  });
  let snapshot;
  try { snapshot = JSON.parse(String(stdout).replace(/^\uFEFF/, '').trim() || '[]'); }
  catch {
    const error = new Error('Windows process inspection returned invalid process data.');
    error.code = 'PROCESS_STATE_UNKNOWN';
    throw error;
  }
  // Windows PowerShell 5.1 can unwrap a one-item array while serializing a
  // nested object. A single live XRS process is a common case, so accept that
  // shape and normalize it without accepting missing process data.
  const normalizeRows = value => Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : null;
  const processes = normalizeRows(snapshot?.processes);
  const processTree = normalizeRows(snapshot?.processTree);
  if (!snapshot || !processes || !processTree) {
    const error = new Error('Windows process inspection returned an incomplete process tree.');
    error.code = 'PROCESS_STATE_UNKNOWN';
    throw error;
  }
  return classifyOtherXrsProcesses(processes, { installRoot, userDataDir, workerPid, processTree });
}

async function hasOtherXrsProcess(options) {
  return (await inspectOtherXrsProcesses(options)).length > 0;
}

async function waitForNoProfileProcesses(options, { timeoutMs = 45000, pollMs = 500, query = inspectOtherXrsProcesses, onState = async () => {} } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = '';
  let lastReportedAt = 0;
  let lastBlockingProcesses = [];
  let attempt = 0;
  while (true) {
    attempt++;
    const result = await query(options);
    const blockingProcesses = Array.isArray(result) ? result : result ? [{ processType: 'unknown' }] : [];
    if (!blockingProcesses.length) {
      await onState('clear', { attempt, waitedMs: timeoutMs - Math.max(0, deadline - Date.now()), blockingProcesses: [] });
      return;
    }
    lastBlockingProcesses = blockingProcesses;
    const snapshot = JSON.stringify(blockingProcesses);
    if (snapshot !== lastSnapshot || Date.now() - lastReportedAt >= 5000) {
      await onState('other-process-running', { attempt, waitedMs: timeoutMs - Math.max(0, deadline - Date.now()), blockingProcesses });
      lastSnapshot = snapshot;
      lastReportedAt = Date.now();
    }
    if (Date.now() >= deadline) {
      const error = new Error('An XRS process still has the profile or install directory open.');
      error.code = 'PROFILE_STILL_IN_USE';
      error.blockingProcesses = lastBlockingProcesses;
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}

module.exports = { hasOtherXrsProcess, inspectOtherXrsProcesses, classifyOtherXrsProcesses, waitForNoProfileProcesses };
