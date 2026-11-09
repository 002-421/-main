import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {draftVersion,validateDraft} from '../src/model.ts';

const server=createServer(async(_request,response)=>{response.setHeader('Content-Type','text/html;charset=utf-8');response.end(await readFile('dist/index.html'));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
 browser=await chromium.launch({...process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{},headless:true,args:['--no-sandbox']});
 const context=await browser.newContext(),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{const add=EventTarget.prototype.addEventListener;EventTarget.prototype.addEventListener=function(type,listener,options){if(this===window&&type==='beforeunload')return;return add.call(this,type,listener,options);};});
 await page.goto(origin);await page.locator('.report-content').waitFor();
 await page.locator('#new-report').click();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Сохранено на компьютере');
 const workspaceKey='mri-report-studio.workspace.v1',templateKey='mri-alliance.templates.v4';
 const baseline=await page.evaluate(key=>{const workspace=JSON.parse(localStorage.getItem(key));return {templateId:workspace.reports[0].templateId,doc:workspace.reports[0].doc};},workspaceKey);
 for(const size of [1,5,12]){
  const fixture=await page.evaluate(({size,workspaceKey,templateKey,baseline})=>{
   const templateSnapshot=localStorage.getItem(templateKey),baseDoc=structuredClone(baseline.doc);
   const reports=Array.from({length:size},(_,index)=>{
    const doc=structuredClone(baseDoc),id=`xrs-${size}-${index}`;
    return {id,templateId:baseline.templateId,doc,dirty:index%2===1};
   });
   reports[size-1]={...reports[size-1],doc:{type:'invalid'}};
   const activeId=reports[0].id,corrupted={activeId,reports},raw=JSON.stringify(corrupted);
   localStorage.setItem(workspaceKey,raw);
   return {size,activeId,raw,templateSnapshot,templateId:reports[0].templateId,doc:baseDoc,valid:reports.slice(0,-1).map(report=>({id:report.id,dirty:report.dirty,index:Number(report.id.split('-').at(-1))}))};
  },{size,workspaceKey,templateKey,baseline});
  assert.equal(fixture.doc?.type,'doc',`${size} tabs: fixture document has a doc root (template ${fixture.templateId})`);
  assert.doesNotThrow(()=>validateDraft({format:'mri-report-studio',version:draftVersion,templateId:fixture.templateId,profile:'custom',doc:fixture.doc,customModules:[]}),`${size} tabs: fixture document is valid`);
  await page.reload();await page.locator('.report-content').waitFor();
  const expected=size===1?1:size-1;
  assert.equal(await page.locator('.report-tab').count(),expected,`${size} tabs: retain every valid report`);
  if(size>1)assert.equal(await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select'),fixture.activeId,`${size} tabs: active report`);
  if(size>1){
   for(const report of fixture.valid){
    const tab=page.locator(`[data-report-select="${report.id}"]`);
    assert.equal(await tab.count(),1,`${size} tabs: ${report.id} retained`);
    assert.equal((await tab.innerText()).startsWith('● '),report.dirty,`${size} tabs: dirty state retained`);
   }
   const other=fixture.valid.find(report=>report.index===1);
   await page.locator(`[data-report-select="${other.id}"]`).click();
   assert.equal(await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select'),other.id,'switching restores the selected document');
   await page.locator(`[data-report-select="${fixture.activeId}"]`).click();
   assert.equal(await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select'),fixture.activeId,'switching back restores the active report');
   await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Сохранено на компьютере');
  }
  const backups=await page.evaluate(key=>Object.keys(localStorage).filter(item=>item.startsWith(`${key}.recovery.`)).map(item=>localStorage.getItem(item)),workspaceKey);
  assert.ok(backups.includes(fixture.raw),`${size} tabs: original workspace saved byte-for-byte before overwrite`);
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),templateKey),fixture.templateSnapshot,`${size} tabs: template library preserved`);
  await page.reload();await page.locator('.report-content').waitFor();
  assert.equal(await page.locator('.report-tab').count(),expected,`${size} tabs: recovered workspace survives another launch`);
 }

 const malformed='{"reports":[invalid-json';
 await page.evaluate(({key,raw})=>localStorage.setItem(key,raw),{key:workspaceKey,raw:malformed});
 await page.reload();await page.locator('.report-content').waitFor();
 assert.ok((await page.evaluate(key=>Object.keys(localStorage).filter(item=>item.startsWith(`${key}.recovery.`)).map(item=>localStorage.getItem(item)),workspaceKey)).includes(malformed),'malformed JSON is backed up verbatim');
 await page.locator('#new-report').click();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Сохранено на компьютере');

 const blockedRaw=JSON.stringify({activeId:'broken',reports:[{id:'broken',templateId:'head-gm',doc:{type:'invalid'},dirty:true}]});
 await page.evaluate(({key,raw})=>localStorage.setItem(key,raw),{key:workspaceKey,raw:blockedRaw});
 await page.addInitScript(()=>{if(sessionStorage.getItem('xrs-fail-backup'))return;sessionStorage.setItem('xrs-fail-backup','1');const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(String(key).startsWith('mri-report-studio.workspace.v1.recovery.'))throw new DOMException('Quota exceeded','QuotaExceededError');return original.call(this,key,value);};});
 await page.reload();await page.locator('.report-content').waitFor();await page.locator('#new-report').click();await page.waitForTimeout(700);
 assert.equal(await page.evaluate(key=>localStorage.getItem(key),workspaceKey),blockedRaw,'backup failure prevents overwriting the damaged workspace');
 await page.reload();await page.locator('.report-content').waitFor();
 assert.ok((await page.evaluate(key=>Object.keys(localStorage).filter(item=>item.startsWith(`${key}.recovery.`)).map(item=>localStorage.getItem(item)),workspaceKey)).includes(blockedRaw),'recovery retries after backup storage becomes writable');
 const uniqueBackupCount=await page.evaluate(key=>Object.keys(localStorage).filter(item=>item.startsWith(`${key}.recovery.`)).length,workspaceKey);
 await page.reload();await page.locator('.report-content').waitFor();
 assert.equal(await page.evaluate(key=>Object.keys(localStorage).filter(item=>item.startsWith(`${key}.recovery.`)).length,workspaceKey),uniqueBackupCount,'repeated launches reuse an identical backup instead of accumulating copies');

 const normalPage=await context.newPage();normalPage.on('pageerror',error=>errors.push(error.message));
 await normalPage.goto(origin);await normalPage.locator('.report-content').waitFor();
 await normalPage.locator('.report-content').fill('Ordinary closing preserves the current protocol.');
 await normalPage.waitForFunction(()=>document.querySelector('#save-state').textContent==='Сохранено на компьютере');
 await normalPage.reload();await normalPage.locator('.report-content').waitFor();
 assert.match(await normalPage.locator('.report-content').innerText(),/Ordinary closing preserves the current protocol/,'ordinary close and relaunch preserve the current document');
 assert.deepEqual(errors,[]);
 console.log('PASS: workspace recovery at 1/5/12 tabs, ordinary switching, dirty and active state, templates, malformed JSON, backup failure/retry and repeat launch.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
