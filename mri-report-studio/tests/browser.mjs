import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright-core';
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { importOwnDocx } from '../src/docx.ts';
import { unzipSync, strFromU8 } from 'fflate';

const root=process.cwd(), output=path.join(root,'test-output');
await mkdir(output,{recursive:true});
const userData=await mkdtemp(path.join(output,'electron-v3-'));
const errors=[];
const application=await _electron.launch({
 ...(process.env.ELECTRON_PATH?{executablePath:process.env.ELECTRON_PATH}:{}),
 args:['.',`--user-data-dir=${userData}`,'--no-sandbox','--ozone-platform=headless','--disable-gpu'],cwd:root,
 env:{...process.env,XDG_CACHE_HOME:'/workspace/.cache',XDG_CONFIG_HOME:'/workspace/.config'},
});
await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1500,1000));
const page=await application.firstWindow();
page.on('pageerror',error=>errors.push(error.message));
const patientId='HEAD.BASE.1.FIELD.0001', doctorId='HEAD.BASE.2.FIELD.0043';
const field=id=>page.locator(`[data-template-field][data-field-id="${id}"]`);
async function fillField(id,text){await field(id).first().click();await page.keyboard.insertText(text);}
async function newReport(){await page.locator('#new-report').click();if(await page.locator('#confirm-new').count())await page.locator('#confirm-new').click();}
async function saveWord(name){
 const filePath=path.join(output,name);await rm(filePath,{force:true});
 await application.evaluate(({session},dest)=>session.defaultSession.once('will-download',(_event,item)=>item.setSavePath(dest)),filePath);
 await page.locator('#save-docx').click();
 for(let i=0;i<200;i++){
  try{if((await stat(filePath)).size>0){const bytes=await readFile(filePath);const imported=await importOwnDocx(bytes);if(imported)return {filePath,bytes,imported};}}catch{}
  await new Promise(r=>setTimeout(r,50));
 }
 assert.fail('Word download did not finish: '+filePath);
}
async function placeAtParagraphStart(locator){await locator.evaluate(el=>{el.closest('[contenteditable]').focus();const range=document.createRange();range.selectNodeContents(el);range.collapse(true);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});}
try{
 await page.locator('.report-content').waitFor();
 assert.equal(await page.locator('.report-content').count(),1);
 assert.equal(await page.locator('.inspector,#field-panel,#field-value').count(),0);
 assert.ok(await page.locator('[data-template-field]').count()>=40);
 assert.equal(await page.evaluate(()=>typeof window.desktop.exportPDF),'function');
 console.log('PASS: one document editor, no right inspector, source placeholders.');

 const patientHint=await field(patientId).innerText();
 await fillField(patientId,'Тестовый Пациент');
 assert.equal(await field(patientId).innerText(),'Тестовый Пациент');
 assert.equal(await field(patientId).getAttribute('data-filled'),'true');
 await page.keyboard.press('Control+z');assert.equal(await field(patientId).innerText(),patientHint);
 await page.keyboard.press('Control+Shift+z');assert.equal(await field(patientId).innerText(),'Тестовый Пациент');
 const second=page.locator('[data-template-field][data-filled="false"]').first();
 const secondId=await second.getAttribute('data-field-id');await second.click();
 await page.evaluate(()=>{const transfer=new DataTransfer();transfer.setData('text/plain','Проверка вставки');document.querySelector('.report-content').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));});
 assert.equal(await field(secondId).innerText(),'Проверка вставки');
 console.log('PASS: inline typing and paste replace prompts; Undo/Redo restores field state.');

 await page.locator('#settings').click();await page.locator('#doctor-name').fill('Иванова Мария Петровна');await page.locator('#apply-doctor-now').check();await page.locator('#save-settings').click();
 assert.equal(await field(doctorId).innerText(),'Иванова Мария Петровна');
 await field(doctorId).evaluate(el=>{el.closest('[contenteditable]').focus();const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});await page.keyboard.insertText('Петров Алексей Иванович');
 assert.match(await page.locator('.report-content').innerText(),/Петров Алексей Иванович/);
 assert.doesNotMatch(await page.locator('.report-content').innerText(),/Иванова Мария Петровна/);
 await page.locator('#review-unchanged').click();assert.ok(await page.locator('[data-unchanged="true"]').count()>0);
 assert.equal(await field(patientId).getAttribute('data-unchanged'),null);
 console.log('PASS: doctor can change per report; untouched review excludes edited patient field.');

 const saved=await saveWord('v3-report.docx');
 assert.equal(saved.imported.doc.attrs.sourceFormat,'alliance-template');
 assert.equal(saved.imported.templateId,'brain');
 assert.match(JSON.stringify(saved.imported.doc),/Тестовый Пациент/);
 assert.match(JSON.stringify(saved.imported.doc),/Петров Алексей Иванович/);
 const zip=unzipSync(saved.bytes),xml=strFromU8(zip['word/document.xml']);
 assert.match(xml,/DejaVu Sans/);assert.match(xml,/w:top="907"/);
 assert.doesNotMatch(xml,/template-unchanged|proof-spelling|proof-grammar|data-unchanged/);
 console.log('PASS: real DOCX preserves report, source geometry and formatting, excludes review/proof decorations.');

 await page.locator('#copy-report').click();
 await page.getByRole('status').filter({hasText:'Описание скопировано с форматированием'}).waitFor();
 const clip=await application.evaluate(async({clipboard})=>{const items=await clipboard.read();return {text:await clipboard.readText(),html:await(await items[0].getType('text/html')).text()};});
 assert.match(clip.text,/Тестовый Пациент/);assert.match(clip.html,/DejaVu Sans/);
 const pdfPath=path.join(output,'v3-native.pdf');
 await application.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},pdfPath);
 await page.locator('#export-pdf').click();if(await page.locator('#confirm-pdf').count())await page.locator('#confirm-pdf').click();
 await page.getByRole('status').filter({hasText:'PDF сохранён'}).waitFor({timeout:30000});
 assert.equal((await readFile(pdfPath)).subarray(0,5).toString(),'%PDF-');
 console.log('PASS: formatted clipboard and actual desktop PDF export.');

 await page.locator('#edit-template').click();
 assert.doesNotMatch(await page.locator('.report-content').innerText(),/Тестовый Пациент|Петров Алексей Иванович/);
 await field(patientId).click();await page.keyboard.press('Control+z');
 assert.doesNotMatch(await page.locator('.report-content').innerText(),/Тестовый Пациент/);
 await fillField(patientId,'Ф.И.О. пациента полностью');
 const templateExport=await saveWord('v3-template.docx');assert.equal(templateExport.imported.kind,'template');
 assert.doesNotMatch(JSON.stringify(templateExport.imported.doc),/Тестовый Пациент|Петров Алексей Иванович/);
 await page.locator('#save-template').click();assert.equal(await field(patientId).innerText(),'Тестовый Пациент');
 await field(patientId).click();await page.keyboard.press('Control+z');assert.equal(await field(patientId).innerText(),'Тестовый Пациент');
 await page.locator('#edit-template').click();await fillField(patientId,'Отменённая подсказка');await page.locator('#cancel-template').click();
 assert.equal(await field(patientId).innerText(),'Тестовый Пациент');
 await newReport();assert.equal(await field(patientId).innerText(),'Ф.И.О. пациента полностью');assert.equal(await field(doctorId).innerText(),'Иванова Мария Петровна');
 await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Сохранено на компьютере');
 await page.reload();await page.locator('.report-content').waitFor();
 assert.equal(await field(patientId).innerText(),'Ф.И.О. пациента полностью');assert.equal(await field(doctorId).innerText(),'Иванова Мария Петровна');
 console.log('PASS: template save/cancel/defaults/doctor persist; report and undo boundaries isolate patient data.');

 await page.locator('#area-select').selectOption('pituitary');const pit=page.locator('[data-template]').first();const pitId=await pit.getAttribute('data-template');await pit.click();if(await page.locator('#confirm-new').count())await page.locator('#confirm-new').click();
 assert.match(await page.locator('#template-name').innerText(),/гипофиз/i);
 await page.locator('#report-file').setInputFiles(saved.filePath);if(await page.locator('#confirm-open').count())await page.locator('#confirm-open').click();
 await field(patientId).waitFor();assert.equal(await field(patientId).innerText(),'Тестовый Пациент');
 assert.equal(await page.locator('#area-select').inputValue(),'brain');
 assert.equal(await page.locator('#template-name').innerText(),'Базовый протокол');
 assert.equal(await page.locator('.report-content').count(),1);
 console.log('PASS: zone → template changes and imported DOCX restores original report.');

 await page.locator('[data-tab="blocks"]').click();await page.locator('#new-block').click();
 await page.locator('#block-title').fill('Проверочный блок');await page.locator('#block-tags').fill('контроль нейро');
 await page.locator('#block-text').fill('Проверочное описание: [[Описание участка]].');await page.locator('#confirm-block').click();
 await page.locator('#block-search').fill('контроль нейро');assert.equal(await page.locator('.block-card').count(),1);
 const blockId=await page.locator('[data-insert-block]').getAttribute('data-insert-block');
 await page.locator('[data-preview-block]').click();assert.match(await page.locator('.block-preview').innerText(),/Проверочное описание/);
 await page.locator('#insert-preview-block').click();
 const insertedField=page.locator('[data-template-field][data-hint="Описание участка"]').first();await insertedField.waitFor();
 await insertedField.click();await page.keyboard.press('Control+b');await page.keyboard.insertText('Иследование. Очаг очаг не выявлен.');await page.keyboard.press('Control+b');
 assert.match(await insertedField.innerText(),/Иследование/);
 await page.locator('#check-now').click();
 const spelling=page.locator('.proof-spelling').filter({hasText:/^Иследование$/});await spelling.waitFor({timeout:30000});
 await spelling.click();await page.locator('.proof-popup').waitFor();
 await page.locator('.proof-popup [data-correction]').filter({hasText:/^Исследование$/}).click();
 const grammar=page.locator('.proof-grammar').filter({hasText:/^Очаг очаг$/});await grammar.waitFor({timeout:30000});await grammar.click();await page.locator('.proof-popup [data-correction]').filter({hasText:/^Очаг$/}).click();
 assert.equal(await insertedField.innerText(),'Исследование. Очаг не выявлен.');
 assert.match(await page.locator('.report-content strong').allTextContents().then(t=>t.join(' ')),/Исследование/);
 console.log('PASS: searchable previews and insertion, live in-document spelling/grammar corrections retain bold and clinical negation.');
 await insertedField.click();await page.keyboard.press('Control+End');
 await page.locator(`[data-insert-block="${blockId}"]`).click();
 const repeated=page.locator('[data-template-field][data-hint="Описание участка"]');
 assert.equal(await repeated.count(),2);
 assert.notEqual(await repeated.nth(0).getAttribute('data-field-id'),await repeated.nth(1).getAttribute('data-field-id'));
 assert.equal(await repeated.nth(1).getAttribute('data-filled'),'false');
 assert.equal(await insertedField.innerText(),'Исследование. Очаг не выявлен.');

 await insertedField.evaluate(el=>{el.closest('[contenteditable]').focus();const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});
 await page.locator('#save-selection').click();await page.locator('#block-title').fill('Сохранённый формат');await page.locator('#block-tags').fill('формат');await page.locator('#confirm-block').click();
 await page.locator('.dialog-overlay').waitFor({state:'hidden',timeout:5000});
 await page.locator('#block-search').fill('Сохранённый формат');await page.locator('[data-preview-block]').click();
 assert.match(await page.locator('.block-preview strong').allTextContents().then(t=>t.join(' ')),/Исследование/);
 await page.locator('.dialog footer [data-close]').click();
 await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Сохранено на компьютере');await page.reload();await page.locator('.report-content').waitFor();
 assert.match(await page.locator('.report-content').innerText(),/Исследование\. Очаг не выявлен\./);
 assert.deepEqual(errors,[]);
 await page.screenshot({path:path.join(output,'v3-desktop.png')});
 console.log('PASS: rich selection library save and local report persistence.');
}catch(error){await page.screenshot({path:path.join(output,'v3-failed.png')});console.error('Renderer errors:',errors);throw error;}finally{await application.close();}

const server=createServer(async(_request,response)=>{response.setHeader('Content-Type','text/html;charset=utf-8');response.end(await readFile(path.join(root,'dist/index.html')));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});
try{
 const browserPage=await browser.newPage({viewport:{width:1500,height:1050}});const requests=[];browserPage.on('request',request=>requests.push(request.url()));
 await browserPage.goto(`http://127.0.0.1:${server.address().port}`);await browserPage.locator('.report-content').waitFor();
 await browserPage.locator(`[data-field-id="${patientId}"]`).click();await browserPage.keyboard.insertText('Проверка браузерной версии');
 await browserPage.waitForFunction(()=>document.querySelector('#save-state').textContent==='Сохранено на компьютере');await browserPage.reload();
 assert.equal(await browserPage.locator(`[data-field-id="${patientId}"]`).innerText(),'Проверка браузерной версии');
 await browserPage.screenshot({path:path.join(root,'downloads','MRI_Alliance_Preview.png')});
 assert.equal(requests.some(url=>!url.startsWith('http://127.0.0.1:')&&!url.startsWith('data:')),false);
 console.log('PASS: standalone browser bundle, font resources and autosave need no external network.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
