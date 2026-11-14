const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { compareVersions, isUpdateAvailable, parseVersion } = require('./update-version.cjs');

const STABLE_MANIFEST = 'https://raw.githubusercontent.com/002-421/-main/codex/mri-report-studio/x-ray-report-studio/downloads/latest.json';
const STABLE_ARCHIVE = '/downloads/X-ray_Report_Studio_Windows_Setup.zip';

function validateManifest(manifest, testKitRoot = '') {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
      || typeof manifest.version !== 'string' || !parseVersion(manifest.version)
      || parseVersion(manifest.version).beta !== null
      || typeof manifest.url !== 'string' || typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(manifest.sha256)
      || (manifest.notes !== undefined && (typeof manifest.notes !== 'string' || manifest.notes.length > 10000)))
    throw new Error('Файл обновлений содержит некорректные данные.');
  let url;
  if (testKitRoot) {
    if (path.basename(manifest.url) !== manifest.url || !/^XRS_Test_Update_\d+\.\d+\.\d+\.zip$/.test(manifest.url)) throw new Error('Недопустимый файл локального тестового обновления.');
    url = pathToFileURL(path.join(testKitRoot, 'Updates', manifest.url)).toString();
  } else {
    let artifact;
    try { artifact = new URL(manifest.url); } catch { throw new Error('Недопустимая ссылка на установочный файл.'); }
    const githubBase = '/002-421/-main/raw/refs/heads/codex/mri-report-studio/x-ray-report-studio';
    const rawBase = '/002-421/-main/codex/mri-report-studio/x-ray-report-studio';
    const archivePaths = [
      `${githubBase}${STABLE_ARCHIVE}`,
      `${rawBase}${STABLE_ARCHIVE}`,
      `${githubBase}/releases/${manifest.version}${STABLE_ARCHIVE}`,
      `${rawBase}/releases/${manifest.version}${STABLE_ARCHIVE}`,
    ];
    if (artifact.protocol !== 'https:' || !((artifact.hostname === 'github.com' && archivePaths.includes(artifact.pathname))
        || (artifact.hostname === 'raw.githubusercontent.com' && archivePaths.includes(artifact.pathname)))
        || artifact.username || artifact.password || artifact.search || artifact.hash)
      throw new Error('Недопустимая ссылка на установочный файл.');
    url = artifact.toString();
  }
  return { version: manifest.version, url, sha256: manifest.sha256.toLowerCase(), notes: manifest.notes ?? '', channel: 'stable' };
}
function chooseUpdate(_channel, installed, candidates) {
  const allowed = candidates.filter(candidate => candidate?.channel === 'stable' && parseVersion(candidate.version)?.beta === null);
  allowed.sort((left, right) => compareVersions(right.version, left.version));
  const chosen = allowed[0];
  if (!chosen) throw new Error('Нет доступных сведений об обновлениях.');
  return { ...chosen, currentVersion: installed, available: isUpdateAvailable(chosen.version, installed) };
}

module.exports = { STABLE_MANIFEST, validateManifest, chooseUpdate };
