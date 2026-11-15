import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const server=createServer(async(_req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(await readFile('dist/index.html'));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const page=await browser.newPage();page.setDefaultTimeout(15000);
 await page.addInitScript(()=>{
  window.desktop={reportReady(){},getApplicationVersion:async()=>'0.4.65',dictionaryLoad:async()=>({words:[],shared:false}),dictionaryMergeSave:async words=>({words,shared:false}),
   checkForUpdates:async()=>({available:true,currentVersion:'0.4.65',version:'0.4.66'}),
   onUpdateProgress(callback){window.syntheticProgress=callback;},clearUpdateProgress(){},
   installUpdate:()=>new Promise((_resolve,reject)=>{window.syntheticFailure=reject;})};
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.locator('#settings').click();await page.locator('#check-updates').click();
 await page.locator('#install-update').click();await page.locator('#confirm-update-install').click();
 await page.locator('#update-progress').waitFor({state:'visible'});
 await page.waitForFunction(()=>typeof window.syntheticProgress==='function');
 for(const stage of ['verifying','installing','restarting']){
  await page.evaluate(stage=>window.syntheticProgress({stage,percent:100,loaded:42,total:42}),stage);
  assert.equal(await page.locator('#update-progress-percent').innerText(),'','no fake stage percentage');
  assert.ok(await page.locator('#update-progress-fill.indeterminate').count(),'unmeasured stage animates');
 }
 await page.evaluate(()=>window.syntheticProgress({stage:'downloading',percent:42,loaded:42,total:100}));
 assert.equal(await page.locator('#update-progress-percent').innerText(),'42%');
 await page.evaluate(()=>window.syntheticFailure(new Error('SYNTHETIC_INSTALL_FAILURE')));
 await page.waitForFunction(()=>document.querySelector('#update-error-text')?.textContent?.includes('SYNTHETIC_INSTALL_FAILURE'));
 await page.locator('#update-error-details summary').click();
 assert.equal(await page.locator('#update-error-text').isVisible(),true);
 console.log('PASS: visible progress after confirmation, real download percentage, indeterminate install stages and retained error.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
