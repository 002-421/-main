import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright-core';
import { mkdtemp, mkdir, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const root = process.cwd();
const output = path.join(root, 'test-output');
await mkdir(output, { recursive: true });
const userData = await mkdtemp(path.join(output, 'electron-profile-'));
const errors = [];
const application = await _electron.launch({
  args: ['.', `--user-data-dir=${userData}`, '--no-sandbox', '--ozone-platform=headless', '--disable-gpu'],
  cwd: root,
  env: { ...process.env, XDG_CACHE_HOME: '/workspace/.cache', XDG_CONFIG_HOME: '/workspace/.config' },
});
const page = await application.firstWindow();
page.on('pageerror', error => errors.push(error.message));
await page.locator('.report-content').waitFor();
assert.equal(await page.locator('[data-report-field]').count(), 41);
assert.equal(await page.evaluate(() => typeof window.desktop.exportPDF), 'function');

await page.locator('[data-field-id="base.1"]').click();
await page.locator('#field-value').fill('Тестовый Пациент');
assert.equal(await page.locator('[data-field-id="base.1"]').innerText(), 'Тестовый Пациент');

await page.locator('[data-module="M02"]').click();
const moduleField = page.locator('section[data-section-id="M02"] [data-report-field]').first();
await moduleField.click();
await page.locator('#field-value').fill('TOF 3D');
await page.locator('[data-module="M02"]').click();
assert.equal(await page.locator('section[data-section-id="M02"]').count(), 0);
await page.locator('[data-module="M02"]').click();
assert.equal(await page.locator('section[data-section-id="M02"] [data-report-field]').first().innerText(), 'TOF 3D');
assert.equal(await page.locator('[data-field-id="base.1"]').innerText(), 'Тестовый Пациент');
console.log('PASS: module selection and re-selection preserve field edits and patient data.');

await page.locator('section[data-section-id="brain"] p').first().evaluate(el => {
  el.closest('[contenteditable]').focus();
  const range = document.createRange(); range.selectNodeContents(el); range.collapse(false);
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
});
await page.keyboard.press('Control+b');
await page.keyboard.insertText(' Контрольная правка');
await page.keyboard.press('Control+b');
assert.match(await page.locator('.report-content strong').allTextContents().then(s => s.join(' ')), /Контрольная правка/);
console.log('PASS: manual rich-text editing and bold formatting.');

await page.locator('#library').click();
await page.locator('#create-module').click();
await page.locator('#module-name').fill('Мой блок');
await page.locator('#module-text').fill('Дополнительная область: [[Описание участка]].');
await page.locator('#save-module').click();
assert.equal(await page.locator('.report-content h2', { hasText: 'Мой блок' }).count(), 1);
const customField = page.locator('section[data-module-id^="custom_"] [data-report-field]').first();
await customField.click();
await page.locator('#field-value').fill('Проверка пользовательского модуля\nВторая строка поля');
assert.equal(await customField.evaluate(el => getComputedStyle(el).whiteSpace), 'pre-wrap');
assert.ok(await customField.evaluate(el => el.getClientRects().length > 1));
console.log('PASS: custom module creation and editable placeholders.');

const draftPath = path.join(output, 'saved-draft.mri.json');
await application.evaluate(({ session }, filePath) => {
  session.defaultSession.once('will-download', (_event, item) => item.setSavePath(filePath));
}, draftPath);
await page.locator('#save-draft').click();
await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Черновик сохранён');
for (let i = 0; i < 100; i++) {
  try { if ((await stat(draftPath)).size > 0) break; } catch {}
  await new Promise(r => setTimeout(r, 50));
}
const draft = JSON.parse(await readFile(draftPath, 'utf8'));
assert.equal(draft.format, 'mri-report-studio');
assert.ok(JSON.stringify(draft.doc).includes('Контрольная правка'));
assert.equal(draft.customModules.length, 1);

await page.locator('#new-report').click();
await page.locator('[data-profile="pituitary"]').click();
assert.equal(await page.locator('section[data-section-id="brain"]').count(), 0);
assert.equal(await page.locator('section[data-section-id="M04"]').count(), 1);
await page.locator('#draft-file').setInputFiles(draftPath);
const confirm = page.locator('#confirm-open');
if (await confirm.count()) await confirm.click();
await page.locator('section[data-section-id="brain"]').waitFor();
assert.equal(await page.locator('[data-field-id="base.1"]').innerText(), 'Тестовый Пациент');
assert.match((await page.locator('.report-content strong').allTextContents()).join(' '), /Контрольная правка/);
assert.equal(await page.locator('section[data-section-id="M02"] [data-report-field]').first().innerText(), 'TOF 3D');
console.log('PASS: save/open round-trip preserves profile, modules, field values and formatting.');

await page.locator('#copy-report').click();
await page.getByRole('status').filter({ hasText: 'Описание скопировано с форматированием' }).waitFor();
const clip = await application.evaluate(async ({ clipboard }) => {
  const items = await clipboard.read();
  const html = await (await items[0].getType('text/html')).text();
  return { html, text: await clipboard.readText() };
});
assert.match(clip.text, /Тестовый Пациент/);
assert.match(clip.html, /<strong>.*Контрольная правка/);
console.log('PASS: formatted copy includes clinical text and rich HTML.');

const pdfPath = path.join(output, 'native-export.pdf');
await application.evaluate(({ dialog }, filePath) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath });
}, pdfPath);
await page.locator('#export-pdf').click();
await page.locator('#confirm-pdf').click();
await page.getByRole('status', { exact: false }).filter({ hasText: 'PDF сохранён' }).waitFor({ timeout: 30000 });
const pdf = await readFile(pdfPath);
assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
assert.ok(pdf.length > 15000);
console.log('PASS: actual desktop PDF export writes a PDF through printToPDF.');

await page.locator('section[data-module-id^="custom_"] [data-report-field]').first().click();
await page.locator('#field-value').fill('Значение для проверки автосохранения');
await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Черновик сохранён');
await page.reload();
await page.locator('.report-content').waitFor();
assert.match(await page.locator('.report-content').innerText(), /Значение для проверки автосохранения/);
assert.equal(await page.locator('[data-field-id="base.1"]').innerText(), 'Тестовый Пациент');
assert.deepEqual(errors, []);
await page.screenshot({ path: path.join(output, 'app-desktop.png') });
await application.close();
console.log('PASS: local autosave survives reload; no renderer exceptions.');

// Test the production single-file build through HTTP because the managed system
// Chromium blocks file:// navigation by policy. The desktop test above loads it
// directly from disk with the same bundle.
const server = createServer(async (_req, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(await readFile(path.join(root, 'dist/index.html')));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
try {
  const browserPage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const requests = [];
  browserPage.on('request', req => requests.push(req.url()));
  await browserPage.goto(`http://127.0.0.1:${server.address().port}`);
  await browserPage.locator('.report-content').waitFor();
  await browserPage.locator('[data-field-id="base.1"]').click();
  await browserPage.locator('#field-value').fill('Проверка браузерной версии');
  await browserPage.waitForFunction(() => document.querySelector('#save-state').textContent === 'Черновик сохранён');
  await browserPage.reload();
  assert.equal(await browserPage.locator('[data-field-id="base.1"]').innerText(), 'Проверка браузерной версии');
  assert.equal(requests.some(url => !url.startsWith('http://127.0.0.1:')), false);
  console.log('PASS: standalone browser bundle works and makes no external requests.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
