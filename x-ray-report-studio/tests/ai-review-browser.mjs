import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const server=createServer(async(_request,response)=>{response.setHeader('Content-Type','text/html;charset=utf-8');response.end(await readFile('dist/index.html'));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  const page=await browser.newPage(), external=[];
  page.on('request',request=>{if(!request.url().startsWith(`http://127.0.0.1:${server.address().port}/`))external.push(request.url());});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#ai-review-open').click();
  assert.equal(await page.locator('[data-ai-category]').count(),6);
  for(const id of ['spelling','punctuation','style','terminology','consistency','clinical'])assert.equal(await page.locator(`[data-ai-category="${id}"]`).isDisabled(),false);
  assert.equal(await page.locator('[data-ai-experimental="true"]').count(),3);
  for(const id of ['terminology','consistency','clinical'])assert.ok((await page.locator(`[data-ai-category="${id}"]`).locator('xpath=..').innerText()).includes('Экспериментальная проверка'));
  assert.equal(await page.locator('#ai-mode').inputValue(),'local');
  await page.locator('[data-ai-category="punctuation"]').uncheck();
  await page.locator('[data-ai-category="clinical"]').uncheck();
  await page.reload();
  await page.locator('#ai-review-open').click();
  assert.equal(await page.locator('[data-ai-category="punctuation"]').isChecked(),false);
  assert.equal(await page.locator('[data-ai-category="clinical"]').isChecked(),false);
  assert.equal(await page.locator('[data-ai-category="terminology"]').isChecked(),true);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('xrs.ai-review.categories.v1')||'[]'));
  assert.deepEqual(saved.includes('punctuation'),false);assert.deepEqual(saved.includes('clinical'),false);assert.deepEqual(saved.includes('terminology'),true);
  await page.locator('#ai-check').click();
  await page.waitForFunction(()=>!document.querySelector('#ai-results')?.textContent?.includes('Проверка…'));
  const state=await page.evaluate(()=>({sections:JSON.parse(localStorage.getItem('mri-report-studio.workspace.v1')||'{}').reports?.[0]?.doc?.content?.map(x=>x.attrs?.id),result:document.querySelector('#ai-results')?.textContent}));
  assert.deepEqual(state.sections.slice(0,4),['header','description','conclusion','signature']);
  assert.deepEqual(state.sections.slice(4),[undefined]);
  assert.ok(state.result);
  const pdf=await page.pdf({format:'A4'});
  assert.equal(pdf.subarray(0,4).toString(),'%PDF');
  assert.deepEqual(external,[]);
  console.log('PASS: structured workspace, saved categories, local review and no external requests.');
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
