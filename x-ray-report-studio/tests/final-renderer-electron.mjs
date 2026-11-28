import assert from 'node:assert/strict';import {_electron} from 'playwright-core';import {mkdtemp,rm,readFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
const temp=await mkdtemp(path.join(os.tmpdir(),'xrs-renderer-'));let app,page;
const launch=async()=>{app=await _electron.launch({... (process.env.ELECTRON_PATH?{executablePath:process.env.ELECTRON_PATH}:{}),args:['.',`--user-data-dir=${path.join(temp,'Profile')}`,'--no-sandbox','--ozone-platform=headless','--disable-gpu'],cwd:process.cwd(),env:{...process.env,MRI_REPORT_STUDIO_DICTIONARY_DIR:path.join(temp,'Dictionary')}});page=await app.firstWindow();await page.locator('.report-content').waitFor();};
try{
 await launch();
 for(let i=0;i<15;i++)await app.evaluate(({BrowserWindow},i)=>{const w=BrowserWindow.getAllWindows()[0];w.minimize();w.restore();w.setSize(1100+(i%3)*100,800+(i%2)*80);},i);
 for(let i=0;i<3;i++){await page.locator('#add-report-tab').click();if(await page.locator('#confirm-new').count())await page.locator('#confirm-new').click();}
 for(let i=0;i<18;i++){const tabs=page.locator('[data-report-select]');await tabs.nth(i%await tabs.count()).click();const p=page.locator('[data-section-id="description"] p').first();await p.click();await page.keyboard.press('End');await page.keyboard.insertText(` синтетический-${i}`);}
 await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='Сохранено на компьютере');
 const before=await page.evaluate(()=>localStorage.getItem('mri-report-studio.workspace.v1'));
 await page.evaluate(()=>{setTimeout(()=>{throw new RangeError('SYNTHETIC_PRIVATE_TEXT_MUST_NOT_BE_LOGGED');},0);});await page.locator('#xrs-emergency').waitFor();
 assert.equal(await page.evaluate(()=>localStorage.getItem('mri-report-studio.workspace.v1')),before);
 await app.close();app=undefined;await launch();assert.equal(await page.locator('#xrs-emergency').count(),0);
 const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('mri-report-studio.workspace.v1')));assert.deepEqual(after.reports.map(r=>r.doc),JSON.parse(before).reports.map(r=>r.doc));
 const logDir=path.join(temp,'Profile','logs');
 const {readdir}=await import('node:fs/promises');const logs=(await readdir(logDir)).filter(n=>n.startsWith('startup-'));
 const text=(await Promise.all(logs.map(n=>readFile(path.join(logDir,n),'utf8')))).join('');assert.ok(!text.includes('SYNTHETIC_PRIVATE_TEXT_MUST_NOT_BE_LOGGED'));assert.ok(text.includes('renderer-exception'));
 // Kill a real renderer and ensure it is not automatically restarted with an empty workspace.
 await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBox=async()=>({response:0});BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer();});
 await new Promise(r=>setTimeout(r,1000));await app.close();app=undefined;await launch();
 assert.deepEqual((await page.evaluate(()=>JSON.parse(localStorage.getItem('mri-report-studio.workspace.v1')))).reports.map(r=>r.doc),JSON.parse(before).reports.map(r=>r.doc));
 console.log('PASS real Electron window/tab/edit stress, exception screen, private text excluded from logs, process crash and workspace restart.');
}finally{await app?.close();await rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
