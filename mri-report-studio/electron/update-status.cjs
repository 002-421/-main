async function waitForUpdaterStatus({ readStatus, getExitCode, getFailureDetail = async () => '', timeoutMs = 10 * 60 * 1000, exitGraceMs = 5000, pollMs = 250, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const deadline = now() + timeoutMs;
  let exitedAt = null;
  let observed = '';
  while (now() < deadline) {
    try { observed = String(await readStatus()).trim(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; observed = ''; }
    if (observed === 'ready' || observed.startsWith('error:')) return observed;
    const exitCode = getExitCode();
    if (exitCode !== null) {
      exitedAt ??= now();
      if (now() - exitedAt >= exitGraceMs) {
        const detail = String(await getFailureDetail()).trim().slice(-1800).replace(/\s+/g, ' ');
        throw new Error(`Установщик завершился без подтверждения запуска новой версии (код ${exitCode}; статус: ${observed || 'не записан'}).${detail ? ` Вывод установщика: ${detail}` : ''}`);
      }
    }
    await wait(pollMs);
  }
  throw new Error('Установщик не подтвердил запуск новой версии. Повторите проверку или используйте установочный пакет вручную.');
}

function buildPowerShellUpdaterArgs({ script, archive, currentRoot, version, statusFile }) {
  return ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Archive', archive, '-CurrentRoot', currentRoot, '-Version', version, '-StatusFile', statusFile];
}

module.exports = { buildPowerShellUpdaterArgs, waitForUpdaterStatus };
