import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { makeTemplateDocument } from '../src/catalog.ts';

const output = 'test-output';
await mkdir(output, { recursive: true });
const server = createServer(async (_request, response) => {
  response.setHeader('Content-Type', 'text/html;charset=utf-8');
  response.end(await readFile('dist/index.html'));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser, page;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const base = makeTemplateDocument('head-gm');
  const sentence = 'Синтетическое описание без клинических сведений; размеры и форма исследуемой модели указаны условно.';
  const paragraph = (text, attrs = {}) => ({ type: 'paragraph', attrs: { fontFamily: 'Arial', fontSizePt: 12, lineHeight: 1.05, spaceAfterPt: 5, textAlign: 'justify', ...attrs }, content: [{ type: 'text', text }] });
  const cases = [
    { name: 'one page', paragraphs: 10, minPages: 1, maxPages: 1 },
    { name: 'two pages', paragraphs: 38, minPages: 2, maxPages: 2 },
    { name: 'three pages', paragraphs: 55, minPages: 3, maxPages: 3 },
    { name: 'four-page boundary', paragraphs: 65, minPages: 4, maxPages: 4 },
    { name: 'long paragraph', paragraphs: 0, long: true, minPages: 2, maxPages: 4 },
    { name: 'explicit conclusion page break', paragraphs: 10, breakConclusion: true, minPages: 2, maxPages: 2 },
    { name: 'table with mixed font sizes', paragraphs: 28, table: true, mixed: true, minPages: 2, maxPages: 3 },
  ];
  for (const scenario of cases) {
    const doc = structuredClone(base);
    doc.content = Array.from({ length: scenario.paragraphs }, (_, index) => paragraph(`${index + 1}. ${sentence}`, scenario.mixed ? { fontSizePt: index % 3 === 0 ? 14 : 10 } : {}));
    if (scenario.long) doc.content.push(paragraph(sentence.repeat(90)));
    if (scenario.table) doc.content.push({ type: 'table', content: Array.from({ length: 3 }, (_, row) => ({ type: 'tableRow', content: Array.from({ length: 2 }, (_, column) => ({ type: 'tableCell', content: [paragraph(`Синтетическая ячейка ${row + 1}.${column + 1}`)] })) })) });
    doc.content.push(paragraph('ЗАКЛЮЧЕНИЕ: синтетический результат для проверки границ страницы.', scenario.breakConclusion ? { pageBreakBefore: true } : {}));
    page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    await page.addInitScript(doc => {
      localStorage.setItem('mri-report-studio.workspace.v1', JSON.stringify({ activeId: 'synthetic-preview', reports: [{ id: 'synthetic-preview', templateId: 'head-gm', doc, dirty: false }] }));
      localStorage.removeItem('mri-report-studio.draft.v1');
    }, doc);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('#preview-report').waitFor();
    const restored = await page.locator('#editor .report-content').innerText();
    assert.match(restored, /Синтетическое описание/, `${scenario.name}: synthetic workspace restored`);
    await page.locator('#preview-report').click();
    const actual = await page.locator('.preview-page').count();
    const geometry = await page.locator('.preview-page').evaluateAll(nodes => nodes.map(page => {
      const paper = page.querySelector('.export-preview-paper');
      const content = paper.querySelector('.report-content');
      const style = getComputedStyle(content);
      return { fontSize: style.fontSize, paperHeight: paper.getBoundingClientRect().height, contentHeight: content.getBoundingClientRect().height, allowedHeight: (297 - 43 - 16) * 96 / 25.4, overflow: paper.hasAttribute('data-preview-overflow') };
    }));
    console.log(`${scenario.name}: ${actual} preview page(s), blocks ${await page.locator('.preview-page .report-content').evaluateAll(nodes => nodes.map(node => node.children.length).join('/'))}`);
    assert.ok(actual >= scenario.minPages && actual <= scenario.maxPages, `${scenario.name}: got ${actual} pages`);
    assert.ok(geometry.every(item => item.fontSize === '16px'), `${scenario.name}: preview uses Word's 12 pt`);
    assert.ok(geometry.every(item => item.contentHeight <= item.allowedHeight + 3 && !item.overflow), `${scenario.name}: content fits the Word page: ${JSON.stringify(geometry)}`);
    assert.match(await page.locator('.preview-page').last().innerText(), /ЗАКЛЮЧЕНИЕ/);
    await page.locator('.dialog [data-close]').last().click();
    await page.close();
  }
  console.log('PASS: synthetic page geometry, long paragraph, table, mixed font sizes, explicit break and conclusion position.');
} catch (error) {
  if (page) await page.screenshot({ path: `${output}/preview-pagination-failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
