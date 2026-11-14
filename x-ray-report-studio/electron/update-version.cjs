function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/.exec(String(value));
  if (!match) return null;
  const parts = match.slice(1, 4).map(Number), beta = match[4] === undefined ? null : Number(match[4]);
  if (parts.some(part => !Number.isSafeInteger(part)) || (beta !== null && (!Number.isSafeInteger(beta) || beta < 1))) return null;
  return { parts, beta };
}
function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  if (!a || !b) throw new Error('Некорректная версия приложения.');
  for (let index = 0; index < 3; index++) {
    const delta = a.parts[index] - b.parts[index];
    if (delta) return Math.sign(delta);
  }
  if (a.beta === null) return b.beta === null ? 0 : 1;
  if (b.beta === null) return -1;
  return Math.sign(a.beta - b.beta);
}

function isUpdateAvailable(candidate, installed) {
  const next = parseVersion(candidate), current = parseVersion(installed);
  return Boolean(next && current && next.beta === null && compareVersions(candidate, installed) > 0);
}

module.exports = { parseVersion, compareVersions, isUpdateAvailable };
