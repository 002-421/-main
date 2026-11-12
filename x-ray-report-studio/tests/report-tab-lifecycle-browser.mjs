import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const workspaceKey = 'mri-report-studio.workspace.v1';
const server = createServer(async (_request, response) => {
  response.setHeader('Content-Type', 'text/html;charset=utf-8');
  response.end(await readFile(process.env.ISOLATION_BUNDLE || 'dist/index.html'));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('.report-content').waitFor();

  const activeId = () => page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select');
  const count = () => page.locator('.report-tab').count();
  async function fillPatient(surname) {
    const field = page.locator('[data-field-id$=".patient"]').first();
    await field.evaluate(el => {
      el.closest('[contenteditable]').focus();
      const range = document.createRange(); range.selectNodeContents(el);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    await page.keyboard.insertText(`${surname} Синтетический Пациент`);
  }
  async function exportDocx() {
    const before = await activeId();
    const download = page.waitForEvent('download');
    await page.locator('#save-docx').click();
    await page.locator('#preview-save-word').click();
    if (await page.locator('#continue-yellow-export').count()) await page.locator('#continue-yellow-export').click();
    const file = await download;
    assert.match(file.suggestedFilename(), /\.docx$/i);
    await page.waitForFunction(id => {
      const active = document.querySelector('.report-tab.active [data-report-select]');
      return active?.dataset.reportSelect === id && !active.closest('.report-tab').querySelector('.report-tab-select').textContent.startsWith('●');
    }, before);
    assert.equal(await activeId(), before, 'DOCX export keeps the same report selected');
    return before;
  }
  async function addByTemplate(surname) {
    const before = await activeId();
    await page.locator('.template-card').nth(1).click();
    assert.notEqual(await activeId(), before, 'selecting a template opens a separate report tab');
    assert.equal(await page.locator(`[data-report-select="${before}"]`).count(), 1, 'the previous report remains open');
    if (surname) await fillPatient(surname);
    return activeId();
  }

  const firstId = await activeId();
  await fillPatient('Петров');
  assert.match(await page.locator('.report-tab.active .report-tab-select').getAttribute('title'), /Петров/);
  await exportDocx();
  const secondId = await addByTemplate('Иванов');
  assert.equal(await count(), 2, 'two open reports are supported');
  await exportDocx();
  const thirdId = await addByTemplate('Смирнова');
  while (await count() < 5) await page.locator('#add-report-tab').click();
  assert.equal(await count(), 5, 'five open reports are supported');
  while (await count() < 12) await page.locator('#add-report-tab').click();
  assert.equal(await count(), 12, 'twelve open reports are supported');
  const ids = await page.locator('.report-tab-select').evaluateAll(nodes => nodes.map(node => node.dataset.reportSelect));
  assert.equal(new Set(ids).size, 12, 'all reports have unique identities');
  assert.ok(ids.includes(firstId) && ids.includes(secondId) && ids.includes(thirdId), 'the twelve-tab workspace retains exported patient reports');

  for (const [id, surname] of [[firstId, 'Петров'], [secondId, 'Иванов'], [thirdId, 'Смирнова']]) {
    const tab = page.locator(`[data-report-select="${id}"]`);
    assert.match(await tab.getAttribute('title'), new RegExp(surname));
    await tab.click();
    assert.equal(await activeId(), id);
    assert.match(await page.locator('.report-tab.active .report-tab-select').getAttribute('title'), new RegExp(surname));
  }

  const beforeReload = await page.locator('.report-tab-select').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.reportSelect, title: node.title })));
  await page.reload();
  await page.locator('.report-content').waitFor();
  assert.equal(await count(), 12, 'all twelve report tabs recover after reload');
  for (const report of beforeReload) {
    const tab = page.locator(`[data-report-select="${report.id}"]`);
    assert.equal(await tab.count(), 1, 'workspace recovery retains report identity');
    assert.equal(await tab.getAttribute('title'), report.title, 'patient title remains stable after workspace recovery');
  }
  console.log('PASS: DOCX export before and after new patients, template selection retains prior tabs, unique identities and stable surnames across 1/2/5/12 tabs and workspace reload.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
