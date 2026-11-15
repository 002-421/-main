const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

async function hasOtherXrsProcess({ installRoot, userDataDir, workerPid = process.pid, run = execFileAsync }) {
  if (process.platform !== 'win32') return false;
  const script = [
    "$install=$env:XRS_INSTALL_ROOT; $profile=$env:XRS_PROFILE_PATH; $self=[int]$env:XRS_WORKER_PID;",
    "$busy=Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {",
    "  $_.ProcessId -ne $self -and $_.Name -ieq 'X-ray Report Studio.exe' -and (",
    "    ($_.ExecutablePath -and ($_.ExecutablePath.Equals($install,[System.StringComparison]::OrdinalIgnoreCase) -or $_.ExecutablePath.StartsWith(($install.TrimEnd('\\')+'\\'),[System.StringComparison]::OrdinalIgnoreCase))) -or",
    "    ($_.CommandLine -and $_.CommandLine.IndexOf($profile,[System.StringComparison]::OrdinalIgnoreCase) -ge 0)",
    "  )",
    "}; if ($busy) { 'busy' } else { 'clear' }",
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
  const state = String(stdout).trim().toLowerCase();
  if (!['busy', 'clear'].includes(state)) {
    const error = new Error('Windows process inspection returned an unknown state.');
    error.code = 'PROCESS_STATE_UNKNOWN';
    throw error;
  }
  return state === 'busy';
}

async function waitForNoProfileProcesses(options, { timeoutMs = 120000, pollMs = 500, query = hasOtherXrsProcess, onState = async () => {} } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (await query(options)) {
    await onState('other-process-running');
    if (Date.now() >= deadline) {
      const error = new Error('An XRS process still has the profile or install directory open.');
      error.code = 'PROFILE_STILL_IN_USE';
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  await onState('clear');
}

module.exports = { hasOtherXrsProcess, waitForNoProfileProcesses };
