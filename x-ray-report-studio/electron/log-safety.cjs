function copyPrimitiveFields(value, allowed) {
  return Object.fromEntries(allowed.filter(key => value?.[key] !== undefined && ['string', 'number', 'boolean'].includes(typeof value[key]))
    .map(key => [key, value[key]]));
}

const SAFE_PROFILE_PATH_PARTS = new Set([
  'profile', 'shared-dictionary.json', 'dictionary.json', 'preferences', 'local state',
  'local storage', 'session data', 'indexeddb', 'leveldb', 'network', 'cookies',
  'web data', 'login data', 'current', 'lock', 'log', 'manifest', 'journal',
  'code cache', 'cache', 'service worker', 'databases', 'blob_storage', 'gpu cache',
]);

function sanitizeDiagnosticPath(value) {
  if (typeof value !== 'string' || !value) return undefined;
  const normalized = value.replaceAll('\\', '/');
  const marker = normalized.toLowerCase().lastIndexOf('/profile/');
  let parts = normalized.toLowerCase().startsWith('profile/')
    ? normalized.split('/')
    : marker >= 0 ? ['profile', ...normalized.slice(marker + 9).split('/')]
      : normalized.split('/').slice(-4);
  parts = parts.filter(Boolean).map((part, index) => {
    const lower = part.toLowerCase();
    if (SAFE_PROFILE_PATH_PARTS.has(lower) || /^manifest-[0-9]+$/i.test(part) || /^\d+\.ldb$/i.test(part)) return part;
    if (index === parts.length - 1 && /^\d+\.(log|ldb)$/i.test(part)) return `<${part.slice(-3).toLowerCase()}>`;
    if (index === parts.length - 1 && /^\.[a-z0-9_-]{1,12}$/i.test(part)) return `<extension:${part.slice(1).toLowerCase()}>`;
    return '<redacted>';
  });
  return parts.join('/').slice(0, 240);
}

function sanitizeUpdateLogEvent(event) {
  const safe = copyPrimitiveFields(event, ['event', 'applicationVersion', 'platform', 'currentVersion', 'targetVersion', 'version', 'bytes', 'files', 'schemaVersion', 'expected', 'actual', 'percent', 'stage', 'restored', 'errorCode', 'phase', 'code', 'syscall', 'operation', 'attempt', 'processState', 'processCount', 'waitedMs', 'recoveryAction']);
  if (Array.isArray(event?.blockingProcesses)) {
    safe.blockingProcesses = event.blockingProcesses.slice(0, 12).flatMap(item => {
      if (!Number.isSafeInteger(item?.pid) || item.pid <= 0 || typeof item?.processType !== 'string'
          || !/^(?:electron-main|electron-[a-z0-9_-]{1,32}|update-worker|unknown)$/.test(item.processType)) return [];
      return [{ ...copyPrimitiveFields(item, ['pid', 'parentPid', 'processType', 'matchesInstall', 'matchesProfile', 'matchesWorker']) }];
    });
  }
  const diagnosticPath = sanitizeDiagnosticPath(event?.path);
  if (diagnosticPath) safe.path = diagnosticPath;
  const reasons = {
    EACCES: 'Access denied', EPERM: 'Operation not permitted', EBUSY: 'Resource busy',
    ENOSPC: 'Insufficient free space', ENOENT: 'File or directory not found',
    EEXIST: 'File or directory already exists', EINVAL: 'Invalid file or argument',
    ENAMETOOLONG: 'Path is too long', ENOTDIR: 'Expected a directory', EIO: 'Disk I/O error',
    EROFS: 'Storage is read-only', ETIMEDOUT: 'Operation timed out',
  };
  if (reasons[safe.code ?? safe.errorCode]) safe.reason = reasons[safe.code ?? safe.errorCode];
  return safe;
}

function sanitizeStartupLogEvent(event) {
  const safe = copyPrimitiveFields(event, ['event', 'version', 'platform', 'hardwareAcceleration', 'gpuCompositing', 'directComposition', 'action', 'errorCode', 'isMainFrame', 'level', 'lineNumber', 'rendererReady']);
  if(event?.event==='renderer-exception'){safe.errorType=['Error','TypeError','RangeError','SyntaxError','ReferenceError'].includes(event.errorType)?event.errorType:'Unknown';safe.frames=Array.isArray(event.frames)?event.frames.filter(x=>typeof x==='string'&&/^\d{1,8}:\d{1,8}$/.test(x)).slice(0,12):[];}
  if (event?.details && typeof event.details === 'object') {
    safe.details = copyPrimitiveFields(event.details, ['exitCode', 'appRoot', 'templateCount', 'textLength', 'bodyColor']);
    if(['clean-exit','abnormal-exit','killed','crashed','oom','launch-failed','integrity-failure'].includes(event.details.reason))safe.details.reason=event.details.reason;
    for (const key of ['viewport', 'shell']) if (event.details[key] && typeof event.details[key] === 'object')
      safe.details[key] = copyPrimitiveFields(event.details[key], key === 'viewport' ? ['width', 'height'] : ['width', 'height', 'display', 'visibility', 'opacity']);
  }
  if (event?.summary && typeof event.summary === 'object') {
    safe.summary = copyPrimitiveFields(event.summary, ['width', 'height', 'sampledPixels', 'distinctSampleColors']);
    if (Array.isArray(event.summary.dominantColors)) safe.summary.dominantColors = event.summary.dominantColors.slice(0, 6).map(color => copyPrimitiveFields(color, ['color', 'count']));
  }
  return safe;
}

module.exports = { sanitizeUpdateLogEvent, sanitizeStartupLogEvent };
