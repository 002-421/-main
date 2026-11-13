import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const playwrightCorePath = process.env.XRS_SMOKE_PLAYWRIGHT_CORE;
assert.ok(playwrightCorePath, 'XRS_SMOKE_PLAYWRIGHT_CORE is required');
const { chromium } = require(playwrightCorePath);

const exe = process.env.XRS_SMOKE_EXE;
const profile = process.env.XRS_SMOKE_PROFILE;
assert.ok(exe, 'XRS_SMOKE_EXE is required');
assert.ok(profile, 'XRS_SMOKE_PROFILE is required');

const probe = spawnSync('node', ['-e', "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"], { encoding: 'utf8' });
assert.equal(probe.status, 0, probe.stderr);
const port = Number(probe.stdout.trim());
assert.ok(Number.isInteger(port) && port > 0, 'Could not allocate a loopback DevTools port');

const app = spawn(exe, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-first-run', '--disable-gpu'], {
  windowsHide: true,
  stdio: 'ignore',
});
let browser;
const externalRendererRequests = [];
try {
  const endpoint = `http://127.0.0.1:${port}`;
  let version;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (app.exitCode !== null) throw new Error(`Packaged EXE exited early (${app.exitCode})`);
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) { version = await response.json(); break; }
    } catch { /* Wait for Electron's local DevTools endpoint. */ }
    await delay(500);
  }
  assert.ok(version?.webSocketDebuggerUrl, 'Electron DevTools endpoint did not start');
  browser = await chromium.connectOverCDP(endpoint);
  const contexts = browser.contexts();
  assert.equal(contexts.length, 1, 'Expected one isolated Electron profile');
  let pages = contexts[0].pages();
  const pageDeadline = Date.now() + 60_000;
  while (!pages.some(candidate => candidate.url().startsWith('file:')) && Date.now() < pageDeadline) {
    await delay(250);
    pages = contexts[0].pages();
  }
  const page = pages.find(candidate => candidate.url().startsWith('file:'));
  assert.ok(page, 'Packaged renderer did not open from the portable app directory');
  page.on('request', request => {
    if (/^https?:/i.test(request.url())) externalRendererRequests.push(request.url());
  });
  const editor = page.locator('#editor .ProseMirror');
  await editor.waitFor({ state: 'visible', timeout: 60_000 });
  await page.locator('#report-tabs .report-tab-select').first().waitFor({ state: 'visible', timeout: 60_000 });
  assert.equal(await page.locator('#ai-review-open').count(), 0, 'AI Review feature flag must remain off in a fresh profile');

  const initial = await page.evaluate(() => ({
    text: document.querySelector('#editor .ProseMirror')?.textContent ?? '',
    sectionIds: [...document.querySelectorAll('#editor .ProseMirror section[data-section-id]')].map(section => section.getAttribute('data-section-id')),
    workspace: localStorage.getItem('mri-report-studio.workspace.v1'),
  }));
  assert.ok(initial.text.trim(), 'Fresh profile did not render the initial report document');
  assert.ok(initial.sectionIds.includes('description') && initial.sectionIds.includes('conclusion'), 'Initial report is missing its structured review sections');
  assert.equal(initial.workspace, null, 'Fresh profile unexpectedly contains a persisted workspace before user interaction');

  // XRS creates the initial report in memory. It persists the workspace on a
  // user action, so use the real New Report control before testing recovery.
  await page.locator('#new-report').click();
  await page.waitForFunction(() => {
    const workspaceKey = 'mri-report-studio.workspace.v1';
    const workspace = JSON.parse(localStorage.getItem(workspaceKey) || 'null');
    return workspace?.reports?.length === 2 && workspace.reports.some(report => report.id === workspace.activeId);
  }, null, { timeout: 15_000 });

  const descriptionText = 'Иследование  проведено , очаг очаг. Очаг 5 мм справа в лобной доле. На уровне L4-L5 определяется грыжа межпозвонкового диска. гиперинтенсвный участок.';
  const conclusionText = 'Очаг 5 мм слева в лобной доле. Грыж межпозвонковых дисков не выявлено.';
  const replaceSectionText = async (id, text) => {
    const section = page.locator(`#editor .ProseMirror section[data-section-id="${id}"]`);
    await section.waitFor({ state: 'visible', timeout: 15_000 });
    const selected = await section.evaluate(element => {
      const editorRoot = element.closest('.ProseMirror');
      const selection = window.getSelection();
      if (!editorRoot || !selection) return false;
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      editorRoot.focus();
      return true;
    });
    assert.equal(selected, true, `Could not select the ${id} section in the editor`);
    await page.keyboard.insertText(text);
  };
  await replaceSectionText('description', descriptionText);
  await replaceSectionText('conclusion', conclusionText);
  await page.waitForFunction(({ description, conclusion }) => {
    const workspace = JSON.parse(localStorage.getItem('mri-report-studio.workspace.v1') || 'null');
    const active = workspace?.reports?.find(report => report.id === workspace.activeId);
    const flatten = node => `${node?.text ?? ''}${(node?.content ?? []).map(flatten).join('')}`;
    const descriptionSection = active?.doc?.content?.find(node => node.type === 'reportSection' && node.attrs?.id === 'description');
    const conclusionSection = active?.doc?.content?.find(node => node.type === 'reportSection' && node.attrs?.id === 'conclusion');
    return flatten(descriptionSection).includes(description) && flatten(conclusionSection).includes(conclusion);
  }, { description: descriptionText, conclusion: conclusionText }, { timeout: 15_000 });
  await page.reload();
  await page.locator('#editor .ProseMirror section[data-section-id="description"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction(({ description, conclusion }) => {
    const workspace = JSON.parse(localStorage.getItem('mri-report-studio.workspace.v1') || 'null');
    const active = workspace?.reports?.find(report => report.id === workspace.activeId);
    const flatten = node => `${node?.text ?? ''}${(node?.content ?? []).map(flatten).join('')}`;
    const descriptionSection = active?.doc?.content?.find(node => node.type === 'reportSection' && node.attrs?.id === 'description');
    const conclusionSection = active?.doc?.content?.find(node => node.type === 'reportSection' && node.attrs?.id === 'conclusion');
    return flatten(descriptionSection).includes(description) && flatten(conclusionSection).includes(conclusion);
  }, { description: descriptionText, conclusion: conclusionText }, { timeout: 15_000 });
  await page.evaluate(() => localStorage.setItem('xrs.ai-review.experimental', 'enabled'));
  await page.reload();
  await page.locator('#ai-review-open').waitFor({ state: 'visible', timeout: 60_000 });
  await page.locator('#ai-review-open').click();
  assert.equal(await page.locator('#ai-mode').inputValue(), 'local');
  assert.equal(await page.locator('#ai-mode option[value="cloud"]').isDisabled(), true);
  const synthetic = await page.evaluate(() => {
    const workspace = JSON.parse(localStorage.getItem('mri-report-studio.workspace.v1'));
    const active = workspace.reports.find(report => report.id === workspace.activeId) ?? workspace.reports[0];
    return JSON.stringify(active.doc);
  });
  const categoryIds = ['spelling','punctuation','style','terminology','consistency','clinical'];
  assert.equal(await page.locator('[data-ai-category]').count(), categoryIds.length);

  const expectedLabels = {
    spelling: 'Орфография',
    punctuation: 'Пунктуация',
    style: 'Стиль и грамматика',
    terminology: 'Медицинская терминология',
    consistency: 'Согласованность описания и заключения',
    clinical: 'Клиническая логика',
  };
  const medicalCategories = new Set(['terminology','consistency','clinical']);
  const results = {};
  for (const selected of categoryIds) {
    for (const id of categoryIds) {
      const checkbox = page.locator(`[data-ai-category="${id}"]`);
      if (id === selected) await checkbox.check();
      else await checkbox.uncheck();
    }
    await page.locator('#ai-check').click();
    await page.waitForFunction(() => {
      const result = document.querySelector('#ai-results');
      return !!result && !result.textContent?.includes('Проверка…');
    }, null, { timeout: 60_000 });
    const rows = page.locator('#ai-results .notice');
    const count = await rows.count();
    const texts = [];
    for (let index = 0; index < count; index++) texts.push(await rows.nth(index).innerText());
    assert.ok(texts.some(text => text.includes(expectedLabels[selected])), `${selected} category did not produce its expected synthetic finding: ${texts.join(' | ')}`);
    if (medicalCategories.has(selected)) {
      const matching = rows.filter({ hasText: expectedLabels[selected] }).first();
      assert.equal(await matching.getByRole('button', { name: 'Принять' }).isDisabled(), true, `${selected} medical comment must not be auto-applicable`);
      assert.ok((await matching.innerText()).includes('(без замены)'), `${selected} medical comment must not propose a replacement`);
    }
    results[selected] = count;
  }

  const storedDocument = await page.evaluate(() => {
    const workspace = JSON.parse(localStorage.getItem('mri-report-studio.workspace.v1'));
    const active = workspace.reports.find(report => report.id === workspace.activeId) ?? workspace.reports[0];
    return JSON.stringify(active.doc);
  });
  assert.equal(storedDocument, synthetic, 'AI Review changed the medical document without explicit acceptance');

  for (const id of categoryIds) {
    const checkbox = page.locator(`[data-ai-category="${id}"]`);
    if (id === 'punctuation') await checkbox.uncheck();
    else await checkbox.check();
  }
  await page.locator('[data-ai-category="punctuation"]').uncheck();
  await page.reload();
  await page.locator('#ai-review-open').waitFor({ state: 'visible', timeout: 60_000 });
  await page.locator('#ai-review-open').click();
  assert.equal(await page.locator('[data-ai-category="punctuation"]').isChecked(), false, 'Category selection did not persist in the isolated profile');
  const savedCategories = await page.evaluate(() => JSON.parse(localStorage.getItem('xrs.ai-review.categories.v1') || '[]'));
  assert.ok(!savedCategories.includes('punctuation'));
  assert.ok(savedCategories.includes('terminology'));
  assert.deepEqual(externalRendererRequests, [], 'Renderer made a request to an external HTTP(S) URL');
  const packagedMain = await readFile(path.join(path.dirname(exe), 'resources', 'app', 'electron', 'main.cjs'), 'utf8');
  const updaterMatch = /const UPDATE_MANIFEST\s*=\s*'([^']+)'/u.exec(packagedMain);
  assert.ok(updaterMatch, 'Could not identify the separate Electron updater endpoint');

  console.log(JSON.stringify({
    result: 'PASS',
    profile: 'temporary --user-data-dir',
    syntheticCategories: results,
    categoryPreferencePersistence: 'PASS',
    medicalCommentsAutoApply: false,
    rendererExternalHttpRequests: externalRendererRequests.length,
    updaterCheck: {
      endpoint: new URL(updaterMatch[1]).origin,
      channel: 'Electron main-process version check, separate from AI Review renderer requests',
      outboundPolicy: 'blocked by the per-EXE Windows Firewall rule',
    },
  }, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (app.exitCode === null) {
    spawnSync('taskkill.exe', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
    app.kill();
  }
}
