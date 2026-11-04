async function waitForUpdaterStatus({ readStatus, getExitCode, timeoutMs = 10 * 60 * 1000, exitGraceMs = 5000, pollMs = 250, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
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
        throw new Error(`Установщик завершился без подтверждения запуска новой версии (код ${exitCode}; статус: ${observed || 'не записан'}).`);
      }
    }
    await wait(pollMs);
  }
  throw new Error('Установщик не подтвердил запуск новой версии. Повторите проверку или используйте установочный пакет вручную.');
}

module.exports = { waitForUpdaterStatus };
