import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright-core';
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { importOwnDocx } from '../src/docx.ts';

const root = process.cwd();
const output = path.join(root, 'test-output');
await mkdir(output, { recursive: true });
const userData = await mkdtemp(path.join(output, 'electron-profile-'));
const errors = [];
const application = await _electron.launch({
  ...(process.env.ELECTRON_PATH ? { executablePath: process.env.ELECTRON_PATH } : {}),
  args: ['.', `--user-data-dir=${userData}`, '--no-sandbox', '--ozone-platform=headless', '--disable-gpu'],
  cwd: root,
  env: { ...process.env, XDG_CACHE_HOME: '/workspace/.cache', XDG_CONFIG_HOME: '/workspace/.config' },
});
const page = await application.firstWindow();
page.on('pageerror', error => errors.push(error.message));
try {
await page.locator('.report-content').waitFor();
assert.equal(await page.locator('[data-report-field]').count(), 39);
assert.equal(await page.locator('[data-field-id="base.3"], [data-field-id="base.6"]').count(), 0);
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

async function saveWord(name) {
  const filePath = path.join(output, name);
  await rm(filePath, { force: true });
  await application.evaluate(({ session }, destination) => {
    session.defaultSession.once('will-download', (_event, item) => item.setSavePath(destination));
  }, filePath);
  await page.locator('#save-draft').click();
  await page.getByRole('status').filter({ hasText: 'Документ Word подготовлен для сохранения' }).waitFor();
  let file;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await stat(filePath)).size > 0) {
        file = await readFile(filePath);
        const imported = await importOwnDocx(file);
        if (imported) return { filePath, file, imported };
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`Word download did not finish: ${filePath}`);
}
const { filePath: draftPath, file: docx, imported: draft } = await saveWord('saved-report.docx');
assert.equal(docx.subarray(0, 2).toString(), 'PK');
assert.equal(draft.kind, 'report');
assert.equal(draft.profile, 'brain');
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
console.log('PASS: local autosave survives reload; no renderer exceptions.');

// Template changes are deliberately separate from the current patient report.
await page.locator('#edit-template').click();
await page.locator('#save-template').waitFor();
await page.locator('.report-content h1').click();
await page.keyboard.press('Control+z');
assert.doesNotMatch(await page.locator('.report-content').innerText(), /Тестовый Пациент|Контрольная правка|Значение для проверки автосохранения/);
assert.equal(await page.locator('section[data-section-id="M02"]').count(), 0);
await page.locator('[data-field-id="base.1"]').click();
await page.locator('#field-value').fill('Ф.И.О. пациента (полностью)');
await page.locator('[data-section-action="rename"][data-section-id="method"]').click();
await page.locator('#section-name').fill('Техника исследования');
await page.locator('#rename-section').click();
await page.locator('[data-section-action="up"][data-section-id="method"]').click();
assert.equal(await page.locator('.report-content > section').first().getAttribute('data-section-id'), 'method');
await page.locator('[data-section-action="delete"][data-section-id="signature"]').click();
assert.equal(await page.locator('section[data-section-id="signature"]').count(), 0);
await page.locator('#add-template-section').click();
await page.locator('#section-name').fill('Проверочный раздел');
await page.locator('#section-text').fill('Наблюдения: [[Проверочное поле]].');
await page.locator('#create-section').click();
const newSection = page.locator('section[data-section-id^="template_"]');
const newSectionId = await newSection.getAttribute('data-section-id');
assert.match(await newSection.innerText(), /Проверочное поле/);
const { imported: template } = await saveWord('saved-template.docx');
assert.equal(template.kind, 'template');
assert.doesNotMatch(JSON.stringify(template.doc), /Тестовый Пациент|Контрольная правка|Значение для проверки автосохранения/);
assert.ok(JSON.stringify(template.doc).includes('Ф.И.О. пациента (полностью)'));
await page.locator('#save-template').click();
await page.locator('.report-content h1').click();
await page.keyboard.press('Control+z');
assert.equal(await page.locator('[data-field-id="base.1"]').innerText(), 'Тестовый Пациент');
assert.match(await page.locator('.report-content').innerText(), /Значение для проверки автосохранения/);
assert.equal(await page.locator('.report-content > section').first().getAttribute('data-section-id'), 'header');
assert.equal(await page.locator('section[data-section-id="signature"]').count(), 1);
console.log('PASS: template save edits hints/sections/order without changing the current patient report; template DOCX contains no patient values.');

await page.locator('#edit-template').click();
await page.keyboard.press('Escape');
await page.locator('[data-field-id="base.1"]').click();
await page.locator('#field-value').fill('Отменённая подсказка');
await page.locator(`[data-section-action="delete"][data-section-id="${newSectionId}"]`).click();
await page.locator('#cancel-template').click();
assert.equal(await page.locator('[data-field-id="base.1"]').innerText(), 'Тестовый Пациент');
await page.locator('#new-report').click();
await page.locator('[data-profile="brain"]').click();
await page.locator('.report-content h1').click();
await page.keyboard.press('Control+z');
assert.equal(await page.locator('.report-content > section').first().getAttribute('data-section-id'), 'method');
assert.equal(await page.locator('section[data-section-id="method"] h2').innerText(), 'Техника исследования');
assert.equal(await page.locator('section[data-section-id="signature"]').count(), 0);
assert.equal(await page.locator(`section[data-section-id="${newSectionId}"]`).count(), 1);
assert.match(await page.locator('[data-field-id="base.1"]').innerText(), /Ф.И.О. пациента \(полностью\)/);
assert.doesNotMatch(await page.locator('.report-content').innerText(), /Тестовый Пациент|Отменённая подсказка/);
await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Черновик сохранён');
await page.reload();
await page.locator('.report-content').waitFor();
await page.locator('#edit-template').click();
assert.equal(await page.locator(`section[data-section-id="${newSectionId}"]`).count(), 1);
assert.match(await page.locator('[data-field-id="base.1"]').innerText(), /Ф.И.О. пациента \(полностью\)/);
await page.locator('#cancel-template').click();
assert.deepEqual(errors, []);
console.log('PASS: saved template applies only to new reports, survives reload, and canceled changes are discarded.');

// Correct both rich document text and text inside a field atom without
// replacing the report, dropping bold formatting, or removing clinical negation.
const checkSection = page.locator(`section[data-section-id="${newSectionId}"]`);
await checkSection.locator('p').first().evaluate(el => {
  el.closest('[contenteditable]').focus();
  const range = document.createRange(); range.selectNodeContents(el); range.collapse(true);
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
});
await page.keyboard.press('Control+b');
await page.keyboard.insertText('Иследование. ');
await page.keyboard.press('Control+b');
await page.keyboard.press('Escape');
await checkSection.locator('[data-report-field]').click();
await page.locator('#field-value').fill('измененния. Очаг очаг не выявлен. Джумалиева.');
await page.locator('#proofread').click();
await page.locator('.proof-summary').waitFor();
const proofIssue = word => page.locator('.proof-issue').filter({ has: page.locator('mark', { hasText: new RegExp(`^${word}$`) }) });
await proofIssue('Иследование').locator('[data-proof-suggestion][data-value="Исследование"]').click();
await page.locator('.proof-summary').waitFor();
assert.match(await checkSection.locator('strong').innerText(), /Исследование/);
await proofIssue('измененния').locator('[data-proof-suggestion][data-value="изменения"]').click();
await page.locator('.proof-summary').waitFor();
await proofIssue('Очаг очаг').locator('[data-proof-suggestion][data-value="Очаг"]').click();
await page.locator('.proof-summary').waitFor();
assert.equal(await checkSection.locator('[data-report-field]').getAttribute('data-value'), 'изменения. Очаг не выявлен. Джумалиева.');
await proofIssue('Джумалиева').locator('[data-proof-word]').click();
await page.locator('.proof-summary').waitFor();
assert.equal(await proofIssue('Джумалиева').count(), 0);
await page.locator('.dialog-footer [data-close]').click();
await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Черновик сохранён');
await page.reload();
await page.locator('.report-content').waitFor();
await page.keyboard.press('F7');
await page.locator('.proof-summary').waitFor();
assert.equal(await proofIssue('Джумалиева').count(), 0);
assert.match(await page.locator('.report-content strong').allTextContents().then(t => t.join(' ')), /Исследование/);
await page.locator('.dialog-footer [data-close]').click();
assert.deepEqual(errors, []);
await page.screenshot({ path: path.join(output, 'app-updated.png') });
console.log('PASS: offline Russian spelling and grammar corrections preserve field values and bold formatting; personal dictionary survives reload.');
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failed-desktop.png') });
  console.error(await page.locator('#template-banner,.inspector-head,#save-template,.workspace').evaluateAll(elements => elements.map(el => ({ selector: el.id || el.className, box: el.getBoundingClientRect().toJSON(), position: getComputedStyle(el).position, flexShrink: getComputedStyle(el).flexShrink }))));
  throw error;
} finally { await application.close(); }

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
  await browserPage.screenshot({ path: path.join(root, 'downloads', 'MRI_Alliance_Preview.png') });
  await browserPage.locator('[data-field-id="base.1"]').click();
  await browserPage.locator('#field-value').fill('Иследование');
  await browserPage.locator('#proofread').click();
  await browserPage.locator('.proof-summary').waitFor();
  assert.equal(await browserPage.locator('.proof-issue mark', { hasText: /^Иследование$/ }).count(), 1);
  assert.equal(requests.some(url => !url.startsWith('http://127.0.0.1:')), false);
  console.log('PASS: standalone browser bundle, autosave and Russian proofreading work without external requests.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
