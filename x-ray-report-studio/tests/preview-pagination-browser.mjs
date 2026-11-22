import { capturePrintLayout, renderCapturedPdf, removePrintCapture } from './print-export-helpers.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { unzipSync, strFromU8 } from 'fflate';
import { exportDocx } from '../src/docx.ts';
import { makeTemplateDocument } from '../src/catalog.ts';

const output = 'test-output';
await mkdir(output, { recursive: true });
const server = createServer(async (_request, response) => {
  response.setHeader('Content-Type', 'text/html;charset=utf-8');
  response.end(await readFile('dist/index.html'));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser, page;
let scenarioName = 'new builtin template', diagnostic = {};
const px = pt => pt * 96 / 72;
const assertSize = (actual, pt, message) => assert.ok(Math.abs(Number.parseFloat(actual) - px(pt)) < 0.02, `${message}: ${actual}, expected ${pt} pt`);
// ProseMirror may append an empty cursor paragraph outside report sections.
// Measure authored text here; the page-fit checks below still include all blocks.
const paragraphSizes = locator => locator.evaluateAll(nodes => nodes.filter(node => node.textContent.trim()).map(node => ({ text: node.textContent, inlineSize: node.style.fontSize, computedSize: getComputedStyle(node).fontSize, fontFamily:getComputedStyle(node).fontFamily })));
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const base = makeTemplateDocument('head-gm');
  const sentence = 'Синтетическое описание без клинических сведений; размеры и форма исследуемой модели указаны условно.';
  const paragraph = (text, attrs = {}) => ({ type: 'paragraph', attrs: { fontFamily: 'Arial', fontSizePt: 12, lineHeight: 1.05, spaceAfterPt: 5, textAlign: 'justify', ...attrs }, content: [{ type: 'text', text }] });
  page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await page.addInitScript(()=>{localStorage.setItem('xrs.doctor-format.v1',JSON.stringify({version:1,activeId:'baseline',profiles:{baseline:{id:'baseline',name:'',fontSize:11,optimize:false}}}));});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#editor .report-content p').first().waitFor();
  const builtinSizes = await paragraphSizes(page.locator('#editor .report-content p'));
  diagnostic = { builtinSizes };
  assert.ok(builtinSizes.every(item=>item.fontFamily.split(',')[0].trim()==='Arial'),'new builtin computed family is Arial');
  if(process.platform==='win32'){const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');const tree=await cdp.send('DOM.getDocument');const node=await cdp.send('DOM.querySelector',{nodeId:tree.root.nodeId,selector:'#editor .report-content p :not(:has(*))'});const rendered=await cdp.send('CSS.getPlatformFontsForNode',{nodeId:node.nodeId});assert.ok(rendered.fonts.some(font=>font.familyName==='Arial'&&font.glyphCount>0&&!font.isCustomFont),'Windows renders actual system Arial glyphs: '+JSON.stringify(rendered.fonts));await cdp.detach();}
  for (const item of builtinSizes) assertSize(item.computedSize, 11, 'new builtin editor paragraph');
  await capturePrintLayout(page);
  const builtinContainer = await page.locator('.preview-page .report-content').first().evaluate(node => getComputedStyle(node).fontSize);
  assertSize(builtinContainer, 11, 'new builtin preview container');
  for (const item of await paragraphSizes(page.locator('.preview-page .report-content p'))) assertSize(item.computedSize, 11, 'new builtin preview paragraph');
  console.log(`new builtin template: container ${builtinContainer}, ordinary paragraph ${builtinSizes[12].computedSize}`);
  await page.close();
  const cases = [
    { name: 'one page', paragraphs: 10, minPages: 1, maxPages: 1 },
    { name: 'legacy document with explicit 12 pt base', paragraphs: 10, baseSize: 12, minPages: 1, maxPages: 1 },
    { name: 'two pages', paragraphs: 30, minPages: 2, maxPages: 2 },
    { name: 'three pages', paragraphs: 50, minPages: 3, maxPages: 3 },
    { name: 'four-page boundary', paragraphs: 65, minPages: 4, maxPages: 4 },
    { name: 'five pages', paragraphs: 95, minPages: 5, maxPages: 5 },
    { name: 'long conclusion', paragraphs: 30, closing: 70, minPages: 2, maxPages: 8 },
    { name: 'multi-paragraph conclusion', paragraphs: 30, multi: true, minPages: 2, maxPages: 3 },
    { name: 'long recommendations', paragraphs: 30, recommendations: true, minPages: 2, maxPages: 5 },
    { name: 'physician date and stamp', paragraphs: 30, signature: true, minPages: 2, maxPages: 3 },
    { name: 'last description almost fills a page', paragraphs: 10, tail: true, minPages: 1, maxPages: 3 },
    { name: 'description ends near page boundary', paragraphs: 21, minPages: 1, maxPages: 2 },
    { name: 'long paragraph', paragraphs: 0, long: true, minPages: 2, maxPages: 4 },
    { name: 'explicit conclusion page break', paragraphs: 10, breakConclusion: true, minPages: 2, maxPages: 2 },
    { name: 'custom margins and spacing', paragraphs: 28, custom: true, minPages: 2, maxPages: 5 },
    { name: 'table with mixed font sizes', paragraphs: 28, table: true, mixed: true, minPages: 2, maxPages: 3 },
  ];
  for (const scenario of cases) {
    scenarioName = scenario.name;
    diagnostic = {};
    const doc = structuredClone(base);
    if (scenario.baseSize) doc.attrs.fontSizePt = scenario.baseSize;
    if(scenario.custom)doc.attrs={...doc.attrs,marginBottomMm:4,marginLeftMm:25,marginRightMm:25,lineHeight:1.4};
    doc.content = Array.from({ length: scenario.paragraphs }, (_, index) => paragraph(`${index + 1}. ${sentence}`, scenario.mixed ? { fontSizePt: index % 3 === 0 ? 14 : 10 } : scenario.custom ? {lineHeight:1.4} : {}));
    if(scenario.tail)doc.content.push(paragraph(sentence.repeat(16)));
    if (scenario.long) doc.content.push(paragraph(sentence.repeat(90)));
    if (scenario.table) doc.content.push({ type: 'table', content: Array.from({ length: 3 }, (_, row) => ({ type: 'tableRow', content: Array.from({ length: 2 }, (_, column) => ({ type: 'tableCell', content: [paragraph(`Синтетическая ячейка ${row + 1}.${column + 1}`)] })) })) });
    doc.content.push(paragraph('ЗАКЛЮЧЕНИЕ: синтетический результат для проверки границ страницы.', scenario.breakConclusion ? { pageBreakBefore: true } : {}));
    if(scenario.closing)doc.content[doc.content.length-1].content[0].text+=' '+sentence.repeat(scenario.closing);
    if(scenario.multi)doc.content.push(paragraph('Продолжение заключения. '+sentence),paragraph('Заключительный абзац. '+sentence));
    if(scenario.recommendations)doc.content.push(paragraph('Рекомендована консультация. '+sentence.repeat(30)),paragraph('Врач: Синтетический тест. Дата: 01.01.2000'));
    if(scenario.signature)doc.content.push(paragraph('Врач: Синтетический врач. Дата: 01.01.2000'),{type:'image',attrs:{src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW+0AAAAASUVORK5CYII=',alt:'Синтетическая печать',width:100,height:40}});
    page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    await page.addInitScript(doc => {
      localStorage.setItem('xrs.doctor-format.v1',JSON.stringify({version:1,activeId:'baseline',profiles:{baseline:{id:'baseline',name:'',fontSize:11,optimize:false}}}));
      localStorage.setItem('mri-report-studio.workspace.v1', JSON.stringify({ activeId: 'synthetic-preview', reports: [{ id: 'synthetic-preview', templateId: 'head-gm', doc, dirty: false }] }));
      localStorage.removeItem('mri-report-studio.draft.v1');
    }, doc);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('#save-menu-toggle').waitFor();
    const restored = await page.locator('#editor .report-content').innerText();
    assert.match(restored, /Синтетическое описание/, `${scenario.name}: synthetic workspace restored`);
    const editorSizes = await paragraphSizes(page.locator('#editor .report-content p'));
    const expectedSizes = scenario.mixed ? [10, 12, 14] : [12];
    assert.deepEqual([...new Set(editorSizes.map(item => Number.parseFloat(item.inlineSize)))].sort((a,b) => a-b), [...expectedSizes].sort((a,b) => a-b), `${scenario.name}: opening preserves explicit paragraph sizes`);
    for (const item of editorSizes) assertSize(item.computedSize, Number.parseFloat(item.inlineSize), `${scenario.name}: editor paragraph`);
    await page.emulateMedia({ media: 'print' });
    for (const item of await paragraphSizes(page.locator('#editor .report-content p'))) assertSize(item.computedSize, Number.parseFloat(item.inlineSize), `${scenario.name}: PDF print paragraph`);
    await page.emulateMedia({ media: null });
    await capturePrintLayout(page);
    if(scenario.custom)await page.locator('#test-print-layout').evaluate(el=>{el.style.zoom='0.8';});
    const actual = await page.locator('.preview-page').count();
    const geometry = await page.locator('.preview-page').evaluateAll(nodes => nodes.map(page => {
      const paper = page.querySelector('.export-preview-paper');
      const content = paper.querySelector('.report-content');
      const style = getComputedStyle(content);
      return { fontSize: style.fontSize, pageNumberFontSize: getComputedStyle(paper.querySelector('.preview-word-page-number')).fontSize, paperHeight: paper.getBoundingClientRect().height, contentHeight: content.getBoundingClientRect().height, allowedHeight: (297 - 43 - 16) * 96 / 25.4, footerTop: paper.querySelector('.preview-word-footer').getBoundingClientRect().top, textBottom: Math.max(...[...content.querySelectorAll('*')].map(n=>n.getBoundingClientRect().bottom)), overflow: paper.hasAttribute('data-preview-overflow') };
    }));
    const previewSizes = await paragraphSizes(page.locator('.preview-page .report-content p'));
    diagnostic = { scenario: scenario.name, geometry, editorSizes, previewSizes };
    console.log(`${scenario.name}: ${actual} preview page(s), blocks ${await page.locator('.preview-page .report-content').evaluateAll(nodes => nodes.map(node => node.children.length).join('/'))}`);
    assert.ok(actual >= scenario.minPages && actual <= scenario.maxPages, `${scenario.name}: got ${actual} pages`);
    for (const item of geometry) assertSize(item.fontSize, doc.attrs.fontSizePt, `${scenario.name}: preview container follows document base size`);
    for (const item of geometry) assertSize(item.pageNumberFontSize, 10.5, `${scenario.name}: page number remains on its independent 10.5 pt print setting`);
    assert.deepEqual([...new Set(previewSizes.map(item => Number.parseFloat(item.inlineSize)))].sort((a,b) => a-b), [...expectedSizes].sort((a,b) => a-b), `${scenario.name}: preview preserves explicit 12 pt or mixed 10/14 pt`);
    for (const item of previewSizes) assertSize(item.computedSize, Number.parseFloat(item.inlineSize), `${scenario.name}: preview paragraph overrides container base`);
    assert.deepEqual(await paragraphSizes(page.locator('#editor .report-content p')), editorSizes, `${scenario.name}: preview does not change the editor document`);
    console.log(`${scenario.name}: base ${geometry[0].fontSize}, paragraph sizes ${[...new Set(previewSizes.map(item => item.computedSize))].join('/')}`);
    assert.ok(geometry.every(item => item.contentHeight <= item.allowedHeight + 3 && !item.overflow), `${scenario.name}: content fits the Word page: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.every(item=>item.textBottom < item.footerTop), `${scenario.name}: text never overlaps footer: ${JSON.stringify(geometry)}`);
    assert.match(await page.locator('.preview-page .report-content').allTextContents().then(parts=>parts.join(' ')), /ЗАКЛЮЧЕНИЕ/);
    const conclusionContext=await page.locator('.preview-page .report-content').evaluateAll(contents=>{for(const content of contents){const ps=[...content.querySelectorAll('p')];const index=ps.findIndex(p=>/^ЗАКЛЮЧЕНИЕ/u.test(p.textContent));if(index>=0)return ps.slice(0,index).some(p=>p.textContent.trim());}return false;});
    const plain=node=>node.text??(node.content??[]).map(plain).join('');
    const printed=await page.locator('.preview-page .report-content').allTextContents();
    assert.equal(printed.join('').replace(/\s/gu,''),plain(doc).replace(/\s/gu,''),`${scenario.name}: every medical character survives pagination`);
    assert.ok(conclusionContext, `${scenario.name}: first conclusion page includes description text`);
    const word=await exportDocx(doc,{templateId:'head-gm'});
    const xml=strFromU8(unzipSync(new Uint8Array(await word.arrayBuffer()))['word/document.xml']);
    const wordText=[...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m=>m[1].replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>')).join('');
    assert.equal(wordText.replace(/\s/gu,''),plain(doc).replace(/\s/gu,''),`${scenario.name}: DOCX retains all medical text`);
    const pdf = await renderCapturedPdf(page,{path:`${output}/pagination-${scenario.name.replace(/[^a-z0-9]/gi,'-')}.pdf`,margin:{top:0,bottom:0,left:0,right:0}});
    assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,actual,`${scenario.name}: real Chromium PDF matches the print layout`);
    await removePrintCapture(page);
    await page.close();
  }
  console.log('PASS: synthetic page geometry, long paragraph, table, mixed font sizes, explicit break and conclusion position.');
} catch (error) {
  await writeFile(`${output}/preview-pagination-failure.json`, JSON.stringify({ scenario: scenarioName, error: error.message, ...diagnostic }, null, 2));
  const annotation = JSON.stringify({ scenario: scenarioName, message: error.message, geometry: diagnostic.geometry }).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  console.log(`::error title=Preview pagination regression::${annotation}`);
  if (page) await page.screenshot({ path: `${output}/preview-pagination-failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
