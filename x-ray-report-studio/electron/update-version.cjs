function compareVersions(left, right) {
  const a = String(left).split('.').map(Number), b = String(right).split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta) return Math.sign(delta);
  }
  return 0;
}

function isUpdateAvailable(candidate, installed) {
  return /^\d+\.\d+\.\d+$/.test(String(candidate))
    && /^\d+\.\d+\.\d+$/.test(String(installed))
    && compareVersions(candidate, installed) > 0;
}

module.exports = { compareVersions, isUpdateAvailable };
