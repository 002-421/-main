import { assertNoPrintPreview } from './print-export-helpers.mjs';
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
    await page.locator('#save-menu-toggle').click();await page.locator('#save-docx').click();
    await assertNoPrintPreview(page);
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
  await fillPatient('Абрамович-Барановский');
  assert.match(await page.locator('.report-tab.active .report-tab-select').getAttribute('title'), /Абрамович-Барановский/);
  await exportDocx();
  const secondId = await addByTemplate('Иванов');
  assert.equal(await count(), 2, 'two open reports are supported');
  await exportDocx();
  const thirdId = await addByTemplate('Иванов');
  while (await count() < 5) await page.locator('#add-report-tab').click();
  assert.equal(await count(), 5, 'five open reports are supported');
  const openingStarted=Date.now();
  for(const capacity of [13,20,30,50]){
    while(await count()<capacity)await page.locator('#new-report').click();
    assert.equal(await count(),capacity);
  }
  console.log(`Opened from 5 to 50 tabs in ${Date.now()-openingStarted} ms including browser interactions and persistence.`);
  const fiftieth=await activeId();
  await fillPatient('Длиннофамильский-Экспериментальный');
  const last=page.locator(`[data-report-select="${fiftieth}"]`);
  assert.match(await last.innerText(), /Длиннофамильский-Экспериментальный · /);
  assert.match(await last.getAttribute('title'), /Длиннофамильский-Экспериментальный · /);
  assert.ok(await last.evaluate(tab=>tab.scrollWidth<=tab.clientWidth));
  assert.ok(await page.locator('#report-tabs').evaluate(strip=>strip.scrollWidth>strip.clientWidth),'long workspaces scroll horizontally');
  const ids = await page.locator('.report-tab-select').evaluateAll(nodes => nodes.map(node => node.dataset.reportSelect));
  assert.equal(new Set(ids).size, 50, 'all reports have unique identities');
  assert.ok(ids.includes(firstId) && ids.includes(secondId) && ids.includes(thirdId), 'the fifty-tab workspace retains exported patient reports');

  for (const [id, surname] of [[firstId, 'Абрамович-Барановский'], [secondId, 'Иванов'], [thirdId, 'Иванов']]) {
    const tab = page.locator(`[data-report-select="${id}"]`);
    assert.match(await tab.getAttribute('title'), new RegExp(surname));
    await tab.click();
    assert.equal(await activeId(), id);
    assert.match(await page.locator('.report-tab.active .report-tab-select').getAttribute('title'), new RegExp(surname));
  }

  const beforeReload = await page.locator('.report-tab-select').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.reportSelect, title: node.title })));
  await page.reload();
  await page.locator('.report-content').waitFor();
  assert.equal(await count(), 50, 'all fifty report tabs recover after reload');
  for (const report of beforeReload) {
    const tab = page.locator(`[data-report-select="${report.id}"]`);
    assert.equal(await tab.count(), 1, 'workspace recovery retains report identity');
    assert.equal(await tab.getAttribute('title'), report.title, 'patient title remains stable after workspace recovery');
  }
  await last.click();
  await page.keyboard.press('Control+z');
  assert.doesNotMatch(await last.innerText(),/Длиннофамильский-Экспериментальный/);
  await page.keyboard.press('Control+y');
  assert.match(await last.innerText(),/Длиннофамильский-Экспериментальный/);
  assert.match(await page.locator(`[data-report-select="${secondId}"]`).getAttribute('title'),/Иванов/);
  await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='Сохранено на компьютере');
  const beforeQuota=await page.evaluate(key=>{
    const set=Storage.prototype.setItem;
    window.xrsFixtureQuota=true;
    Storage.prototype.setItem=function(k,v){if(k===key&&window.xrsFixtureQuota)throw new DOMException('Quota exceeded','QuotaExceededError');return set.call(this,k,v);};
    return localStorage.getItem(key);
  },workspaceKey);
  await fillPatient('Несохранённый-Синтетический');
  await page.getByRole('alert').filter({hasText:'Не удалось сохранить рабочее пространство'}).waitFor();
  assert.match(await last.innerText(),/Несохранённый-Синтетический/,'unsaved text stays in its tab');
  assert.equal(await count(),50,'no tabs are closed on quota failure');
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),workspaceKey),beforeQuota,'the last saved workspace survives');
  await page.evaluate(()=>{window.xrsFixtureQuota=false;});
  await page.keyboard.press('Control+z');
  assert.match(await last.innerText(),/Длиннофамильский-Экспериментальный/,'history remains available after quota failure');
  console.log('PASS: DOCX export before and after new patients, template selection retains prior tabs, unique identities and stable surnames across 1/2/5/13/20/30/50 tabs and workspace reload.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
