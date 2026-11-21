import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {strFromU8, unzipSync} from 'fflate';
import {makeTemplateDocument} from '../src/catalog.ts';

const index = await readFile('dist/index.html');
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'text/html;charset=utf-8');
  response.end(index);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port;
const key = 'mri-report-studio.workspace.v1';
const doc = makeTemplateDocument('head-gm');
const p = (text, attrs = {}, marks = []) => ({
  type: 'paragraph', attrs: {fontFamily: 'Arial', fontSizePt: 11, ...attrs},
  content: [{type: 'text', text, marks}],
});
doc.content = [
  p('Синтетическая строка А. '.repeat(14), {lineHeight: 1.5, spaceBeforePt: 6, spaceAfterPt: 12, firstLineIndentPt: 10, textAlign: 'justify'}, [{type: 'bold'}]),
  p('Синтетическая строка Б.', {lineHeight: 1.5, spaceBeforePt: 0, spaceAfterPt: 0}, [{type: 'italic'}, {type: 'textStyle', attrs: {lineHeight: '1.5', color: '#574040'}}]),
  p('Синтетическая строка В.', {lineHeight: 1.5, spaceAfterPt: 7}),
  {type: 'horizontalRule'},
  p('ЗАКЛЮЧЕНИЕ: синтетический текст.'),
  p('Врач: Синтетический. Дата: 01.01.2000'),
];

let browser;
try {
  browser = await chromium.launch({headless: true, args: ['--no-sandbox'],
    ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
  const page = await browser.newPage({viewport: {width: 1500, height: 1000}, acceptDownloads: true});
  await page.addInitScript(({doc, key}) => {
    if (sessionStorage.getItem('format-test-loaded')) return;
    sessionStorage.setItem('format-test-loaded', 'true');
    localStorage.setItem('xrs.doctor-format.v1', JSON.stringify({version: 1, activeId: 'baseline', profiles: {
      baseline: {id: 'baseline', name: '', fontSize: 11, optimize: false},
    }}));
    localStorage.setItem(key, JSON.stringify({activeId: 'format-test', reports: [
      {id: 'format-test', templateId: 'head-gm', doc, dirty: false},
    ]}));
    localStorage.removeItem('mri-report-studio.draft.v1');
  }, {doc, key});
  await page.goto(url);
  const body = page.locator('#editor .report-content');
  const paragraphs = body.locator('p');
  await paragraphs.first().filter({hasText: 'Синтетическая строка А.'}).waitFor();
  const storage = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)).reports.find(r => r.id === 'format-test').doc, key);
  const select = (first, last = first, a = 4, b = a) => paragraphs.evaluateAll(async (ps, {first, last, a, b}) => {
    ps[0].closest('[contenteditable]').focus();
    const text = el => document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
    getSelection().setBaseAndExtent(text(ps[first]), a, text(ps[last]), b);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, {first, last, a, b});
  await select(2);
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).reports[0].doc.content[2].attrs.templateOriginal, key);
  const saved = await storage();
  const line = body.locator('hr[data-manual-rule]');
  const undo = page.locator('[data-command=undo]');
  const redo = page.locator('[data-command=redo]');
  const interval = page.locator('#line-height');
  assert.equal(await page.locator('[data-format=align]').count(), 4);
  const checkAfter = expected => page.waitForFunction(({key, expected}) => {
    const stored = JSON.parse(localStorage.getItem(key)).reports.find(r => r.id === 'format-test').doc;
    return Math.abs(stored.content[0].attrs.spaceAfterPt - expected) < .001;
  }, {key, expected});

  await select(0, 1);
  await interval.selectOption('1.05');
  await checkAfter(8.4);
  const compact = await storage();
  assert.equal(compact.content[0].attrs.spaceBeforePt, 4.2);
  assert.equal(compact.content[0].attrs.firstLineIndentPt, 10);
  assert.equal(compact.content[0].attrs.textAlign, 'justify');
  assert.deepEqual(compact.content[0].content, saved.content[0].content);
  assert.equal(compact.content[1].attrs.spaceBeforePt, 0);
  assert.equal(compact.content[1].attrs.spaceAfterPt, 0);
  assert.equal(compact.content[1].content[0].marks.find(mark => mark.type === 'textStyle').attrs.color, '#574040');
  assert.ok(compact.content[1].content[0].marks.some(mark => mark.type === 'italic'));
  assert.deepEqual(compact.content[2], saved.content[2], 'paragraph outside selection stays unchanged');

  await select(0);
  await interval.selectOption('1.5');
  await checkAfter(12);
  assert.equal((await storage()).content[1].attrs.lineHeight, 1.05, 'caret limits adjustment to its paragraph');
  await undo.click();
  await checkAfter(8.4);
  await redo.click();
  await checkAfter(12);
  for (const ratio of ['1', '1.15', '1.2', '2', '1.05', '1.5', '1.05']) {
    await select(0);
    await interval.selectOption(ratio);
    await checkAfter(12 * Number(ratio) / 1.5);
  }

  await select(0, 0, 4, 4);
  const beforeText = await paragraphs.allTextContents();
  await page.getByRole('button', {name: 'Линия', exact: true}).click();
  await line.waitFor();
  assert.deepEqual(await paragraphs.allTextContents(), beforeText, 'mid-word insertion does not split a multiline paragraph');
  const placement = await line.evaluate(el => {
    const selection = getSelection();
    const previous = el.previousElementSibling;
    return {afterA: previous.textContent.includes('строка А'), caret: previous.contains(selection.anchorNode) && selection.anchorOffset === 4,
      gap: getComputedStyle(el).marginTop, color: getComputedStyle(el).backgroundColor,
      height: el.getBoundingClientRect().height, width: el.getBoundingClientRect().width,
      paragraphWidth: previous.getBoundingClientRect().width, previousMargin: getComputedStyle(previous).marginBottom};
  });
  assert.ok(placement.afterA && placement.caret);
  assert.ok(Math.abs(placement.height - 1.5 * 4 / 3) < .02);
  assert.ok(Math.abs(parseFloat(placement.gap) - 3 * 4 / 3) < .02);
  assert.equal(placement.color, 'rgb(140, 156, 174)');
  assert.equal(placement.width, placement.paragraphWidth);
  assert.equal(placement.previousMargin, '0px');
  await undo.click();
  await line.waitFor({state: 'detached'});
  await redo.click();
  await line.waitFor();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).reports[0].doc.content[1].attrs?.manual === true, key);
  const withLine = await storage();
  assert.equal(withLine.content[1].attrs.manual, true);
  assert.equal(withLine.content.filter(n => n.type === 'paragraph').length, saved.content.filter(n => n.type === 'paragraph').length);
  await page.reload();
  await line.waitFor();
  assert.equal(await body.locator('hr:not([data-manual-rule])').count(), 1, 'old conclusion separator survives alongside the new rule');
  await select(1, 1, 0, 0);
  await page.keyboard.press('Backspace');
  await line.waitFor({state: 'detached'});
  await undo.click();
  await line.waitFor();
  assert.deepEqual(await paragraphs.allTextContents(), beforeText);

  // Keep one scaled paragraph beside the line and another away from it.
  await select(2);
  await interval.selectOption('1.05');
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).reports[0].doc.content[3].attrs.lineHeight === 1.05, key);
  await page.locator('#preview-report').click();
  const printed = page.locator('.preview-page .report-content');
  const previewLine = printed.locator('hr[data-manual-rule]');
  await previewLine.waitFor();
  const verified = await previewLine.evaluate(el => ({
    previous: el.previousElementSibling.style.marginBottom,
    next: el.nextElementSibling.style.marginTop,
    nextAfter: el.nextElementSibling.style.marginBottom,
  }));
  assert.deepEqual(verified, {previous: '0pt', next: '0pt', nextAfter: '0pt'});
  const remaining = printed.locator('p').filter({hasText: 'Синтетическая строка В.'});
  assert.equal(await remaining.evaluate(el => el.style.marginBottom), '4.9pt');

  const downloading = page.waitForEvent('download');
  await page.locator('#preview-save-word').click();
  const download = await downloading;
  const xml = strFromU8(unzipSync(await readFile(await download.path()))['word/document.xml']);
  const wordParagraphs = [...xml.matchAll(/<w:p(?: [^>]*)?>.*?<\/w:p>/gs)].map(match => match[0]);
  const wordRule = wordParagraphs.find(p => p.includes('w:color="8C9CAE"'));
  assert.ok(wordRule);
  assert.match(wordRule, /w:sz="12"/);
  assert.match(wordRule, /w:before="60"/);
  assert.match(wordRule, /w:after="60"/);
  assert.match(wordRule, /w:lineRule="exact"/);
  assert.match(wordParagraphs.find(p => p.includes('строка В.')), /w:after="98"/);
  assert.match(wordParagraphs.find(p => p.includes('строка В.')), /w:line="231"/);
  assert.match(wordParagraphs.find(p => p.includes('строка А.')), /w:after="0"/);

  await page.locator('#preview-report').click();
  await page.locator('.paginated-browser-preview').waitFor();
  await page.evaluate(() => {
    document.querySelector('#app').style.display = 'none';
    const copy = document.createElement('div');
    copy.className = 'export-only-editor';
    copy.innerHTML = document.querySelector('.paginated-browser-preview').innerHTML;
    document.body.append(copy);
  });
  await page.emulateMedia({media: 'print'});
  const printStyle = await page.locator('.export-only-editor hr[data-manual-rule]').evaluate(el => ({
    visible: el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0,
    color: getComputedStyle(el).backgroundColor, colorAdjust: getComputedStyle(el).printColorAdjust,
  }));
  assert.deepEqual(printStyle, {visible: true, color: 'rgb(140, 156, 174)', colorAdjust: 'exact'});
  const pdf = await page.pdf({preferCSSPageSize: true, printBackground: true});
  assert.match(pdf.toString('latin1'), /\/Type\s*\/Page\b/);
  await page.emulateMedia({media: 'screen'});
  await page.evaluate(() => {
    document.querySelector('.export-only-editor').remove();
    document.querySelector('#app').style.display = '';
  });
  await page.locator('.word-preview-dialog [data-close]').last().click();

  const choose = async (menu, value) => {
    await page.locator(`[data-format-toggle=${menu}]`).click();
    await page.locator(`[data-format=${menu}][data-value="${value}"]`).click();
  };
  await line.click();
  await body.locator('hr.ProseMirror-selectednode').waitFor();
  for (const value of [0.5, 1, 2, 3, 1.5]) {
    await choose('rule', value);
    assert.equal(await line.count(), 1, 'changing the selected rule avoids extra nodes');
    assert.equal(Number(await line.getAttribute('data-rule-thickness')), value);
  }

  await select(1, 2, 3, 5);
  assert.equal(await page.locator('[data-format-toggle=align]').getAttribute('title'), 'По левому краю');
  for (const value of ['right','justify','center','left']) {
    await choose('align', value);
    assert.equal(await paragraphs.nth(1).evaluate(el => getComputedStyle(el).textAlign), value);
    assert.equal(await paragraphs.nth(2).evaluate(el => getComputedStyle(el).textAlign), value);
  }
  await undo.click();
  assert.equal(await paragraphs.nth(1).evaluate(el => getComputedStyle(el).textAlign), 'center');
  await redo.click();
  assert.equal(await paragraphs.nth(1).evaluate(el => getComputedStyle(el).textAlign), 'left');

  await select(1,2,3,5);
  for (const [value, element, marker] of [['dash','ul','"-  "'],['asterisk','ul','"*  "'],['disc','ul','disc'],['ordered','ol','decimal']]) {
    await choose('list',value);
    const list = body.locator(element).first();
    assert.equal(await list.locator(':scope > li').count(), 2);
    assert.equal(await list.evaluate(el => getComputedStyle(el).listStyleType), marker);
  }
  await choose('list','off');
  assert.equal(await body.locator('li').count(),0);
  await undo.click();
  assert.equal(await body.locator('ol > li').count(),2);
  await redo.click();
  assert.equal(await body.locator('li').count(),0);
  await select(1,2,3,5);
  await choose('list','asterisk');

  await select(1,1,1,6);
  await choose('fill','#b7f7b7');
  const green = body.locator('[data-manual-fill="#b7f7b7"]');
  await green.waitFor();
  for (const theme of ['dark','light']) {
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    assert.equal(await green.evaluate(el=>getComputedStyle(el).backgroundColor), 'rgb(183, 247, 183)');
  }
  await select(2,2,1,6);
  await page.locator('#fill-text').click();
  assert.equal(await green.count(),2);
  await choose('fill','off');
  assert.equal(await green.count(),1);
  await undo.click();
  assert.equal(await green.count(),2);
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#fill-text')?.title.includes('Светло-зелёный'));
  assert.equal(await green.count(),2);

  await page.locator('#preview-report').click();
  await page.locator('.paginated-browser-preview').waitFor();
  const downloadWithFormatting = page.waitForEvent('download');
  await page.locator('#preview-save-word').click();
  const formatted = unzipSync(await readFile(await (await downloadWithFormatting).path()));
  assert.match(strFromU8(formatted['word/document.xml']), /w:fill="B7F7B7"/);
  assert.match(strFromU8(formatted['word/numbering.xml']), /<w:lvlText w:val="\*"/);
  assert.match(strFromU8(formatted['word/numbering.xml']), /w:hanging="240"/);

  await page.locator('#preview-report').click();
  await page.locator('.paginated-browser-preview li').first().waitFor();
  await page.evaluate(() => {
    document.querySelector('#app').style.display = 'none';
    const copy = document.createElement('div');
    copy.className = 'export-only-editor';
    copy.innerHTML = document.querySelector('.paginated-browser-preview').innerHTML;
    document.body.append(copy);
  });
  await page.emulateMedia({media:'print'});
  const marker = page.locator('.export-only-editor ul[data-bullet-style=asterisk]');
  assert.equal(await marker.evaluate(el=>getComputedStyle(el).listStyleType), '"*  "');
  const pdfFill = page.locator('.export-only-editor [data-manual-fill="#b7f7b7"]').first();
  assert.equal(await pdfFill.evaluate(el=>getComputedStyle(el).backgroundColor), 'rgb(183, 247, 183)');
  const formattedPdf = await page.pdf({preferCSSPageSize:true,printBackground:true});
  assert.match(formattedPdf.toString('latin1'), /\/Type\s*\/Page\b/);

  console.log('PASS: four list markers and removal, four alignments, all line thicknesses, fill across themes, Undo/Redo, reload, real DOCX and Chromium PDF.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
