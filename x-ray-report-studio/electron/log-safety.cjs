function copyPrimitiveFields(value, allowed) {
  return Object.fromEntries(allowed.filter(key => value?.[key] !== undefined && ['string', 'number', 'boolean'].includes(typeof value[key]))
    .map(key => [key, value[key]]));
}

function safeSystemErrorReason(code) {
  return ({
    EACCES: 'Access denied', EPERM: 'Operation not permitted', EBUSY: 'Resource busy',
    ENOSPC: 'Insufficient free space', ENOENT: 'File or directory not found',
    EEXIST: 'File or directory already exists', EINVAL: 'Invalid file or argument',
    ENAMETOOLONG: 'Path is too long', ENOTDIR: 'Expected a directory', EIO: 'Disk I/O error',
    EROFS: 'Storage is read-only', ETIMEDOUT: 'Operation timed out',
  })[code] ?? '';
}

function sanitizeUpdateLogEvent(event) {
  const safe = copyPrimitiveFields(event, ['event', 'applicationVersion', 'platform', 'currentVersion', 'targetVersion', 'version', 'bytes', 'files', 'schemaVersion', 'expected', 'actual', 'percent', 'stage', 'restored', 'errorCode', 'phase', 'code', 'syscall']);
  const reason = safeSystemErrorReason(safe.code);
  if (reason) safe.reason = reason;
  return safe;
}

function sanitizeStartupLogEvent(event) {
  const safe = copyPrimitiveFields(event, ['event', 'version', 'platform', 'hardwareAcceleration', 'gpuCompositing', 'directComposition', 'action', 'errorCode', 'isMainFrame', 'level', 'lineNumber', 'rendererReady']);
  if (event?.details && typeof event.details === 'object') {
    safe.details = copyPrimitiveFields(event.details, ['appRoot', 'templateCount', 'textLength', 'bodyColor']);
    for (const key of ['viewport', 'shell']) if (event.details[key] && typeof event.details[key] === 'object')
      safe.details[key] = copyPrimitiveFields(event.details[key], key === 'viewport' ? ['width', 'height'] : ['width', 'height', 'display', 'visibility', 'opacity']);
  }
  if (event?.summary && typeof event.summary === 'object') {
    safe.summary = copyPrimitiveFields(event.summary, ['width', 'height', 'sampledPixels', 'distinctSampleColors']);
    if (Array.isArray(event.summary.dominantColors)) safe.summary.dominantColors = event.summary.dominantColors.slice(0, 6).map(color => copyPrimitiveFields(color, ['color', 'count']));
  }
  return safe;
}

module.exports = { sanitizeUpdateLogEvent, sanitizeStartupLogEvent, safeSystemErrorReason };
