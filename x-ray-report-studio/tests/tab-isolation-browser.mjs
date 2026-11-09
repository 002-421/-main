import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';

const key='mri-report-studio.workspace.v1', trace=[];
const server=createServer(async(_request,response)=>{
 response.setHeader('Content-Type','text/html;charset=utf-8');
 response.end(await readFile(process.env.ISOLATION_BUNDLE || 'dist/index.html'));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const context=await browser.newContext(),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.locator('.report-content').waitFor();
 const active=()=>page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select');
 const patient=()=>page.locator('[data-field-id="head-gm.patient"]');
 async function fill(text){
  await patient().evaluate(el=>{el.closest('[contenteditable]').focus();const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});
  await page.keyboard.insertText(text);
 }
 async function saved(){await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Сохранено на компьютере');}
 const a=await active(),nameA='Фиктивный Альфа Пациент',nameB='Фиктивный Бета Пациент';
 async function check(step,id,own,foreign){
  await saved();
  const snapshot=await page.evaluate(key=>({activeId:document.querySelector('.report-tab.active [data-report-select]').dataset.reportSelect,text:document.querySelector('.report-content').innerText,workspace:JSON.parse(localStorage.getItem(key))}),key);
  trace.push({step,...snapshot});console.log(step, snapshot.activeId);
  assert.equal(snapshot.activeId,id,step+': selected ID');
  assert.equal(snapshot.workspace.activeId,id,step+': persisted active ID');
  assert.ok(snapshot.text.includes(own),step+': editor contains own patient');
  assert.ok(!snapshot.text.includes(foreign),step+': editor excludes other patient');
  for(const report of snapshot.workspace.reports){
   const text=JSON.stringify(report.doc);
   assert.ok(!text.includes(report.id===a?nameB:nameA),step+': stored documents remain isolated');
   assert.ok(text.includes(report.id===a?nameA:nameB),step+': stored patient is retained');
  }
 }
 await fill(nameA);await check('A immediately before creating B',a,nameA,nameB);
 await page.locator('#new-report').click();const b=await active();assert.notEqual(a,b);
 assert.ok(!(await page.locator('.report-content').innerText()).includes(nameA));
 await fill(nameB);await check('B created',b,nameB,nameA);
 for(const [id,own,foreign] of [[a,nameA,nameB],[b,nameB,nameA],[a,nameA,nameB],[b,nameB,nameA]]){
  await page.locator(`[data-report-select="${id}"]`).click();
  await check('switch to '+own,id,own,foreign);
  await patient().click();await page.keyboard.press('Control+z');await check('Undo after switch',id,own,foreign);
  await page.keyboard.press('Control+y');await check('Redo after switch',id,own,foreign);
 }
 await page.locator(`[data-report-close="${b}"]`).click();
 await page.locator('#close-unsaved-report').waitFor();
 await check('B close awaiting confirmation',b,nameB,nameA);
 assert.equal(await page.locator('.report-tab').count(),2);
 // Reproduce the integration test mistake: reload without confirming the close.
 await page.reload();await page.locator('.report-content').waitFor();
 await check('reload after unconfirmed close restores B',b,nameB,nameA);
 assert.equal(await page.locator('.report-tab').count(),2);
 await page.locator(`[data-report-close="${b}"]`).click();await page.locator('#close-unsaved-report').click();
 assert.equal(await page.locator(`[data-report-select="${b}"]`).count(),0);
 await check('B closed with confirmation',a,nameA,nameB);
 await saved();await page.close();
 const restarted=await context.newPage();await restarted.goto(`http://127.0.0.1:${server.address().port}`);
 await restarted.locator('.report-content').waitFor();
 assert.equal(await restarted.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select'),a);
 assert.equal(await restarted.locator('.report-tab').count(),1);
 for(const shortcut of ['Control+z','Control+y']){
  await restarted.locator('[data-field-id="head-gm.patient"]').click();await restarted.keyboard.press(shortcut);
  const text=await restarted.locator('.report-content').innerText();assert.ok(text.includes(nameA));assert.ok(!text.includes(nameB));
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: A/B isolation, A → B → A → B, Undo/Redo, close confirmation and restart; unconfirmed close restores B.');
} finally {
 await mkdir('test-output',{recursive:true});await writeFile('test-output/tab-isolation-trace.json',JSON.stringify(trace,null,2));
 await browser?.close();await new Promise(resolve=>server.close(resolve));
}
