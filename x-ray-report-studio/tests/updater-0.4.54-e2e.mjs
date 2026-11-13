import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { _electron } from 'playwright-core';
import { strToU8, unzipSync, zipSync } from 'fflate';

const require = createRequire(import.meta.url);
const { extractWithTar } = require('../electron/update-install.cjs');
const execFileAsync = promisify(execFile);
const EXPECTED_054_SHA256 = '04ae2cd7745edb92e2c115ca8a620deb0f86152b281a4747eef656f91a768cc3';
const TEST_MARKER = JSON.stringify({ format: 'xrs-isolated-test-kit', allowLocalUpdateFiles: true }, null, 2) + '\n';
const storageKeys = {
  workspace: 'mri-report-studio.workspace.v1',
  templates: 'mri-alliance.templates.v4',
  settings: 'mri-alliance.settings.v3',
  dictionary: 'mri-report-studio.dictionary.v1',
};

const oldSetupZip = process.env.XRS_054_SETUP_ZIP;
const candidateSetupZip = process.env.XRS_055_SETUP_ZIP;
assert.ok(oldSetupZip && candidateSetupZip, 'Set XRS_054_SETUP_ZIP and XRS_055_SETUP_ZIP to verified setup packages.');

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'XRS-09-updater-054-e2e-'));
const kitRoot = path.join(root, 'test-kit');
let application;
let page;
let oldExecutable;
let newExecutable;
let relaunchProcessId = null;
let phase = 'initialize isolated test kit';

function sha256(bytes) {
  return require('node:crypto').createHash('sha256').update(bytes).digest('hex');
}

async function powershell(command) {
  return execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
}

function psLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function processIdsFor(executable) {
  const encoded = Buffer.from(executable, 'utf16le').toString('base64');
  const command = `$target=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}')); Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.Equals($target,[StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $_.ProcessId }`;
  const { stdout } = await powershell(command);
  return stdout.split(/\s+/).filter(Boolean).map(Number).filter(Number.isInteger);
}

async function waitForProcessState(executable, expectedRunning, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const running = (await processIdsFor(executable)).length > 0;
    if (running === expectedRunning) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.equal((await processIdsFor(executable)).length > 0, expectedRunning,
    `${path.basename(executable)} should be ${expectedRunning ? 'running' : 'stopped'}`);
}

async function stopTestProcesses() {
  const targets = [oldExecutable, newExecutable].filter(Boolean);
  for (const target of targets) {
    for (const pid of await processIdsFor(target).catch(() => [])) {
      if (pid === process.pid) continue;
      await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
    }
  }
}

async function readShortcutTarget(shortcut) {
  const electronExe = path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe');
  const worker = path.join(process.cwd(), 'tests', 'windows-shortcut-worker.cjs');
  const inspectorProfile = path.join(kitRoot, 'ShortcutInspector');
  const { stdout } = await execFileAsync(electronExe, [worker, `--user-data-dir=${inspectorProfile}`], {
    windowsHide: true,
    env: {
      ...process.env,
      APPDATA: path.join(kitRoot, 'ShortcutInspectorAppData'),
      LOCALAPPDATA: path.join(kitRoot, 'ShortcutInspectorLocalAppData'),
      PUBLIC: path.join(kitRoot, 'ShortcutInspectorPublic'),
      MRI_REPORT_STUDIO_DICTIONARY_DIR: path.join(kitRoot, 'ShortcutInspectorDictionary'),
      XRS_SHORTCUT_PATH: shortcut,
    },
  });
  return JSON.parse(stdout).target;
}

async function assertEditorData(expectedVersion, markers) {
  assert.equal(await page.evaluate(() => window.desktop.getApplicationVersion()), expectedVersion);
  assert.equal(await page.locator('.report-tab').count(), 2, 'both synthetic report tabs remain open');
  const workspace = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), storageKeys.workspace);
  assert.ok(workspace, 'the report workspace remains readable');
  const serializedWorkspace = JSON.stringify(workspace);
  for (const marker of markers) assert.ok(serializedWorkspace.includes(marker), `workspace retains ${marker}`);
  const persisted = await page.evaluate(keys => Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, localStorage.getItem(key)])), storageKeys);
  assert.ok(persisted.templates?.includes('XRS_SYNTHETIC_TEMPLATE_SENTINEL'), 'custom template survives the update');
  assert.ok(persisted.settings?.includes('XRS Synthetic Doctor'), 'doctor settings survive the update');
  assert.ok(persisted.dictionary?.includes('xrs-synthetic-word'), 'personal dictionary survives the update');
}

async function fillSyntheticPatient(marker) {
  const field = page.locator('[data-field-id$=".patient"]').first();
  await field.waitFor({ state: 'visible' });
  await field.evaluate(element => {
    element.closest('[contenteditable]').focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.insertText(marker);
  await page.waitForFunction(({ key, marker }) => localStorage.getItem(key)?.includes(marker), { key: storageKeys.workspace, marker });
}

try {
  assert.equal(process.platform, 'win32', 'the official updater E2E must run on Windows');
  phase = 'verify official 0.4.54 package and candidate 0.4.55 package';
  const oldBytes = await fs.readFile(oldSetupZip);
  assert.equal(sha256(oldBytes), EXPECTED_054_SHA256, 'the updater under test must come from the official 0.4.54 ZIP');
  const runtimeVersion = JSON.parse(await fs.readFile(path.join(process.cwd(), 'node_modules', 'electron', 'package.json'), 'utf8')).version;

  const oldExtract = path.join(root, 'old-setup');
  const candidateExtract = path.join(root, 'candidate-setup');
  await fs.mkdir(oldExtract, { recursive: true });
  await fs.mkdir(candidateExtract, { recursive: true });
  await extractWithTar(oldSetupZip, oldExtract, 'tar.exe');
  await extractWithTar(candidateSetupZip, candidateExtract, 'tar.exe');
  const oldSetup = path.join(oldExtract, 'X-ray Report Studio Setup');
  const candidateSetup = path.join(candidateExtract, 'X-ray Report Studio Setup');
  const oldApp = path.join(oldSetup, 'app');
  const candidateApp = path.join(candidateSetup, 'app');
  const oldMetadata = JSON.parse(await fs.readFile(path.join(oldApp, 'package.json'), 'utf8'));
  const candidateMetadata = JSON.parse(await fs.readFile(path.join(candidateApp, 'package.json'), 'utf8'));
  assert.equal(oldMetadata.version, '0.4.54');
  assert.equal(candidateMetadata.version, '0.4.55');
  const oldMainSource = await fs.readFile(path.join(oldApp, 'electron', 'main.cjs'), 'utf8');
  const publishedZipUrl = 'https://raw.githubusercontent.com/002-421/-main/codex/mri-report-studio/x-ray-report-studio/releases/0.4.55/downloads/X-ray_Report_Studio_Windows_Setup.zip';
  const parsedPublishedZipUrl = new URL(publishedZipUrl);
  assert.equal(parsedPublishedZipUrl.protocol, 'https:');
  assert.equal(parsedPublishedZipUrl.hostname, 'raw.githubusercontent.com');
  assert.ok(oldMainSource.includes("artifact.pathname.endsWith('/downloads/X-ray_Report_Studio_Windows_Setup.zip')"), 'the exact official 0.4.54 updater retains its suffix allowlist');
  assert.ok(oldMainSource.includes("['raw.githubusercontent.com','github.com'].includes(artifact.hostname)"), 'the exact official 0.4.54 updater restricts update hosts to GitHub');
  assert.ok(parsedPublishedZipUrl.pathname.endsWith('/downloads/X-ray_Report_Studio_Windows_Setup.zip'), 'the immutable 0.4.55 URL is accepted by 0.4.54');
  const installerText = await fs.readFile(path.join(oldSetup, 'Install.ps1'), 'utf8');
  const runtimePin = installerText.match(/electron-v([^/\\]+)-win32-x64\.zip/i)?.[1];
  assert.equal(runtimePin, runtimeVersion, 'the test runtime must match the official 0.4.54 Electron pin');

  phase = 'prepare the isolated packaged 0.4.54 runtime';
  const appRuntime = path.join(kitRoot, 'App_0.4.54');
  await fs.mkdir(appRuntime, { recursive: true });
  await fs.cp(path.join(process.cwd(), 'node_modules', 'electron', 'dist'), appRuntime, { recursive: true });
  const electronExe = path.join(appRuntime, 'electron.exe');
  oldExecutable = path.join(appRuntime, 'X-ray Report Studio.exe');
  await fs.rename(electronExe, oldExecutable);
  const oldRuntimeApp = path.join(appRuntime, 'resources', 'app');
  await fs.mkdir(oldRuntimeApp, { recursive: true });
  await fs.cp(oldApp, oldRuntimeApp, { recursive: true });
  await fs.writeFile(path.join(oldRuntimeApp, 'xrs-test-mode.json'), TEST_MARKER, 'utf8');

  const updates = path.join(kitRoot, 'Updates');
  await fs.mkdir(updates, { recursive: true });
  const candidateBytes = await fs.readFile(candidateSetupZip);
  const entries = unzipSync(candidateBytes);
  entries['X-ray Report Studio Setup/app/xrs-test-mode.json'] = strToU8(TEST_MARKER);
  const localUpdateName = 'XRS_Test_Update_0.4.55.zip';
  const localUpdateBytes = zipSync(entries, { level: 0 });
  await fs.writeFile(path.join(updates, localUpdateName), localUpdateBytes);
  await fs.writeFile(path.join(updates, 'latest.json'), JSON.stringify({
    // Start at the installed version so the 0.4.54 automatic check cannot open
    // the update prompt before the synthetic workspace has been prepared.
    version: '0.4.54',
    url: localUpdateName,
    sha256: sha256(localUpdateBytes),
    notes: 'Синтетическая проверка штатного updater 0.4.54.',
  }, null, 2) + '\n');

  phase = 'launch the official 0.4.54 executable in the isolated test kit';
  application = await _electron.launch({
    executablePath: oldExecutable,
    cwd: appRuntime,
    args: [],
    env: { ...process.env, XRS_TEST_ROOT: kitRoot },
  });
  page = await application.firstWindow();
  await page.locator('.report-content').waitFor();
  assert.equal(await page.evaluate(() => window.desktop.getApplicationVersion()), '0.4.54');

  await page.evaluate(keys => {
    const key = keys.settings;
    const settings = JSON.parse(localStorage.getItem(key) ?? '{}');
    settings.autoUpdate = false;
    localStorage.setItem(key, JSON.stringify(settings));
  }, storageKeys);
  phase = 'create synthetic documents, template, settings, and dictionary';
  await fillSyntheticPatient('XRS_SYNTHETIC_PATIENT_ALPHA');
  await page.locator('#new-report').click();
  await page.locator('.report-tab').nth(1).waitFor();
  await fillSyntheticPatient('XRS_SYNTHETIC_PATIENT_BETA');

  await page.locator('#edit-template').click();
  const editor = page.locator('#editor .ProseMirror');
  await editor.evaluate(element => {
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.insertText(' XRS_SYNTHETIC_TEMPLATE_SENTINEL');
  await page.locator('#save-template').click();
  await page.waitForFunction(key => localStorage.getItem(key)?.includes('XRS_SYNTHETIC_TEMPLATE_SENTINEL'), storageKeys.templates);

  phase = 'discover and explicitly confirm update 0.4.54 to 0.4.55';
  await page.locator('#settings').click();
  await page.locator('#doctor-name').fill('XRS Synthetic Doctor');
  await page.locator('#save-settings').click();
  await page.locator('#settings').click();
  await page.locator('#dictionary-settings').click();
  await page.locator('#personal-words').fill('xrs-synthetic-word');
  await page.locator('#save-dictionary').click();
  const dictionaryFile = path.join(kitRoot, 'Shared Dictionary', 'dictionary.json');
  await page.waitForFunction(({ key, word }) => localStorage.getItem(key)?.includes(word), { key: storageKeys.dictionary, word: 'xrs-synthetic-word' });
  assert.ok((await fs.readFile(dictionaryFile, 'utf8')).includes('xrs-synthetic-word'), 'the synthetic shared dictionary is written through the real application API');
  const syntheticMarkers = ['XRS_SYNTHETIC_PATIENT_ALPHA', 'XRS_SYNTHETIC_PATIENT_BETA'];
  await assertEditorData('0.4.54', syntheticMarkers);

  await fs.writeFile(path.join(updates, 'latest.json'), JSON.stringify({
    version: '0.4.55',
    url: localUpdateName,
    sha256: sha256(localUpdateBytes),
    notes: 'Синтетическая проверка штатного updater 0.4.54.',
  }, null, 2) + '\n');

  await page.locator('#settings').click();
  await page.locator('#check-updates').click();
  const prompt = page.getByText('Доступна новая версия X-ray Report Studio', { exact: true });
  await prompt.waitFor({ state: 'visible', timeout: 15000 });
  const promptText = await page.locator('body').innerText();
  assert.ok(promptText.includes('0.4.54') && promptText.includes('0.4.55'), 'the real updater presents the expected update');
  let installConfirmation = null;
  page.once('dialog', dialog => {
    installConfirmation = { type: dialog.type(), message: dialog.message() };
    void dialog.accept();
  });
  await page.locator('#install-update').click();
  phase = 'verify SHA-checked side-by-side installation and shortcut switch';
  await page.waitForFunction(async () => await window.desktop.getApplicationVersion() === '0.4.55', null, { timeout: 120000 });
  assert.equal(installConfirmation?.type, 'confirm', 'the test accepts an explicit confirmation for unsaved report exports');
  assert.match(installConfirmation.message, /не экспортированы в Word или PDF/);
  await assertEditorData('0.4.55', syntheticMarkers);

  const stateFile = path.join(kitRoot, 'Profile', 'install-state.json');
  const stateAfterInstall = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  assert.equal(stateAfterInstall.current.version, '0.4.55');
  assert.equal(stateAfterInstall.previous.version, '0.4.54');
  assert.ok(await fs.stat(stateAfterInstall.previous.executable));
  newExecutable = stateAfterInstall.current.executable;
  const shortcut = path.join(kitRoot, 'Shortcuts', 'X-ray Report Studio.lnk');
  assert.equal(path.resolve(await readShortcutTarget(shortcut)).toLowerCase(), path.resolve(newExecutable).toLowerCase(), 'the user shortcut points to 0.4.55');
  const backupRoot = path.join(kitRoot, 'AppData', 'X-ray Report Studio Backups');
  assert.ok((await fs.readdir(backupRoot)).length > 0, 'the actual updater created a verified user-data backup');

  phase = 'restart 0.4.55 and verify profile plus rollback availability';
  await application.close();
  application = await _electron.launch({ executablePath: newExecutable, cwd: path.dirname(newExecutable), args: [], env: { ...process.env, XRS_TEST_ROOT: kitRoot } });
  page = await application.firstWindow();
  await page.locator('.report-content').waitFor();
  await page.waitForFunction(async () => (await window.desktop.rollbackInfo()).available, null, { timeout: 45000 });
  await assertEditorData('0.4.55', syntheticMarkers);
  const rollbackInfo = await page.evaluate(() => window.desktop.rollbackInfo());
  assert.equal(rollbackInfo.previousVersion, '0.4.54');

  phase = 'execute user-confirmed rollback to 0.4.54';
  const currentProcess = application.process();
  const processExit = new Promise(resolve => currentProcess.once('exit', resolve));
  await page.locator('#settings').click();
  await page.locator('#rollback-update').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#rollback-update').isDisabled(), false);
  page.once('dialog', dialog => { void dialog.accept(); });
  await page.locator('#rollback-update').click();
  await processExit;
  application = undefined;

  const oldProcessDeadline = Date.now() + 45000;
  while (Date.now() < oldProcessDeadline) {
    const ids = await processIdsFor(oldExecutable);
    if (ids.length) { relaunchProcessId = ids[0]; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(relaunchProcessId, 'the real rollback relaunched the preserved 0.4.54 executable');
  await waitForProcessState(oldExecutable, true);
  let stateAfterRollback;
  const stableDeadline = Date.now() + 30000;
  while (Date.now() < stableDeadline) {
    stateAfterRollback = JSON.parse(await fs.readFile(stateFile, 'utf8'));
    if (stateAfterRollback.current?.version === '0.4.54' && stateAfterRollback.status === 'stable') break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(stateAfterRollback.current.version, '0.4.54');
  assert.equal(stateAfterRollback.status, 'stable');
  assert.equal(path.resolve(await readShortcutTarget(shortcut)).toLowerCase(), path.resolve(oldExecutable).toLowerCase(), 'the user shortcut points back to 0.4.54');
  assert.ok((await fs.readdir(backupRoot)).length >= 2, 'rollback creates a separate verified profile backup');

  phase = 'relaunch 0.4.54 and verify restored user profile';
  await execFileAsync('taskkill.exe', ['/PID', String(relaunchProcessId), '/T', '/F'], { windowsHide: true });
  await waitForProcessState(oldExecutable, false);
  relaunchProcessId = null;
  application = await _electron.launch({ executablePath: oldExecutable, cwd: path.dirname(oldExecutable), args: [], env: { ...process.env, XRS_TEST_ROOT: kitRoot } });
  page = await application.firstWindow();
  await page.locator('.report-content').waitFor();
  await assertEditorData('0.4.54', syntheticMarkers);

  console.log('PASS: official 0.4.54 updater discovered and prompted for 0.4.55, installed the SHA-verified package side-by-side, switched the shortcut, preserved synthetic workspace/tabs/template/settings/dictionary, launched 0.4.55, rolled back, relaunched 0.4.54, and recovered the same synthetic profile.');
} catch (error) {
  const diagnosticsDirectory = process.env.XRS_E2E_DIAGNOSTICS || path.join(process.cwd(), 'test-output', 'xrs-09-diagnostics');
  await fs.mkdir(diagnosticsDirectory, { recursive: true }).catch(() => {});
  const diagnostic = {
    phase,
    platform: process.platform,
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
    official054Sha256: EXPECTED_054_SHA256,
    syntheticDataOnly: true,
    testKitRoot: kitRoot,
    processIds: {
      old: oldExecutable ? await processIdsFor(oldExecutable).catch(() => []) : [],
      current: newExecutable ? await processIdsFor(newExecutable).catch(() => []) : [],
    },
  };
  if (page && !page.isClosed()) {
    diagnostic.renderer = await page.evaluate(() => ({
      title: document.title,
      text: document.body?.innerText?.slice(0, 12000),
      reportTabs: [...document.querySelectorAll('.report-tab')].map(tab => tab.innerText),
      saveState: document.querySelector('#save-state')?.textContent,
      reportText: document.querySelector('.report-content')?.innerText?.slice(0, 12000),
      rendererErrors: window.__xrsRendererErrors ?? [],
    })).catch(() => null);
    await page.screenshot({ path: path.join(diagnosticsDirectory, 'updater-0.4.54-e2e-failure.png'), fullPage: true }).catch(() => {});
    await fs.writeFile(path.join(diagnosticsDirectory, 'updater-0.4.54-e2e-failure.html'), await page.content().catch(() => ''), 'utf8').catch(() => {});
  }
  await fs.writeFile(path.join(diagnosticsDirectory, 'updater-0.4.54-e2e-failure.json'), JSON.stringify(diagnostic, null, 2), 'utf8').catch(() => {});
  console.error('Updater 0.4.54 E2E diagnostics:', JSON.stringify(diagnostic, null, 2));
  throw error;
} finally {
  if (application) await application.close().catch(() => {});
  await stopTestProcesses();
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
}
