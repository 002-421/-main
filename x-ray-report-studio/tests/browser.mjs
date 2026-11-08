import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright-core';
import { appendFile, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { importOwnDocx } from '../src/docx.ts';
import { reportTemplates } from '../src/catalog.ts';
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
const page=await application.firstWindow();
await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]?.setSize(1500,1000));
page.on('pageerror',error=>errors.push(error.message));
const patientId='head-gm.patient', doctorId='HEAD.BASE.2.FIELD.0043';
const field=id=>page.locator(`[data-template-field][data-field-id="${id}"]`);
async function selectField(id){await field(id).first().evaluate(el=>{el.closest('[contenteditable]').focus();const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});}
async function fillField(id,text){await selectField(id);await page.keyboard.insertText(text);}
async function typeAtFieldCaret(id,text='Ж'){await field(id).first().evaluate(el=>{el.closest('[contenteditable]').focus();const node=el.firstChild;const range=document.createRange();range.setStart(node,Math.floor((node.textContent??'').length/2));range.collapse(true);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});await page.keyboard.insertText(text);}
async function assertFirstTypingReplacesHint(id){const target=field(id).first(),hint=await target.innerText();await typeAtFieldCaret(id,'Ж');assert.equal(await target.innerText(),'Ж',`${id}: typing at an interior caret replaces the whole hint`);assert.equal(await target.getAttribute('data-filled'),'true');await page.keyboard.press('Control+z');assert.equal(await target.innerText(),hint,`${id}: undo restores the complete hint`);assert.equal(await target.getAttribute('data-filled'),'false');}
async function newReport(){await page.locator('#new-report').click();if(await page.locator('#confirm-new').count())await page.locator('#confirm-new').click();}
async function waitForCalculatorKeyboardFocus(){await page.waitForFunction(()=>{const panel=document.querySelector('.movable-calculator');return Boolean(panel&&panel.contains(document.activeElement));});}
async function saveWord(name){
 const filePath=path.join(output,name);await rm(filePath,{force:true});
 await application.evaluate(({session},dest)=>session.defaultSession.once('will-download',(_event,item)=>item.setSavePath(dest)),filePath);
 await page.locator('#save-docx').click();
 assert.ok(await page.locator('.paged-preview-frame iframe, .preview-page').count(),'paginated preview opens before Word export');
 await page.locator('#preview-save-word').click();
 for(let i=0;i<200;i++){
  try{if((await stat(filePath)).size>0){const bytes=await readFile(filePath);const imported=await importOwnDocx(bytes);if(imported)return {filePath,bytes,imported};}}catch{}
  await new Promise(r=>setTimeout(r,50));
 }
 assert.fail('Word download did not finish: '+filePath);
}
async function placeAtParagraphStart(locator){await locator.evaluate(el=>{el.closest('[contenteditable]').focus();const range=document.createRange();range.selectNodeContents(el);range.collapse(true);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});}
async function reloadWithWorkspaceFixture(raw){await page.evaluate(({key,value})=>{localStorage.setItem(key,value);const original=Storage.prototype.setItem;Storage.prototype.setItem=function(name,next){if(name===key)return;return original.call(this,name,next);};},{key:'mri-report-studio.workspace.v1',value:raw});await page.reload();}
const yellowZeroSummary=()=>page.evaluate(()=>[...document.querySelectorAll('.report-content mark[data-color="#ffff00"]')].map(mark=>({text:(mark.textContent??'').replace(/\u00a0/g,' ').trim(),visible:!!mark.getClientRects().length,html:mark.outerHTML})));
async function captureStartupDom(){
 const snapshot=await page.evaluate(()=>({title:document.title,documentName:document.querySelector('#document-name')?.textContent,selectedTemplate:document.querySelector('.template-card.selected strong')?.textContent,storageKeys:Object.keys(localStorage),reportText:document.querySelector('.report-content')?.innerText,reportHTML:document.querySelector('.report-content')?.outerHTML,marks:[...document.querySelectorAll('.report-content mark')].map(mark=>({text:(mark.textContent??'').replace(/\u00a0/g,' ').trim(),color:mark.getAttribute('data-color'),visible:!!mark.getClientRects().length,html:mark.outerHTML}))}));snapshot.rendererErrors=errors;
 await writeFile(path.join(output,'electron-startup-dom.json'),JSON.stringify(snapshot,null,2));
 await writeFile(path.join(output,'electron-startup-dom.html'),`<!doctype html><meta charset="utf-8"><title>Electron startup DOM</title>${snapshot.reportHTML??'<p>.report-content отсутствует</p>'}`);
 await page.screenshot({path:path.join(output,'electron-startup-dom.png'),fullPage:true});
 console.log('Electron startup DOM:',JSON.stringify({...snapshot,reportHTML:snapshot.reportHTML?.slice(0,12000)},null,2));
}
async function waitForYellowZero(){
 const yellowMarks=page.locator('.report-content mark[data-color="#ffff00"]');
 try{
  await page.waitForFunction(()=>[...document.querySelectorAll('.report-content mark[data-color="#ffff00"]')].some(mark=>(mark.textContent??'').replace(/\u00a0/g,' ').trim().startsWith('0,0')));
  const index=await yellowMarks.evaluateAll(marks=>marks.findIndex(mark=>(mark.textContent??'').replace(/\u00a0/g,' ').trim().startsWith('0,0')));
  const yellowZero=yellowMarks.nth(index);await yellowZero.waitFor({state:'visible'});return yellowZero;
 }catch(error){
  try{
   const diagnostic=await page.evaluate(()=>({title:document.title,documentName:document.querySelector('#document-name')?.textContent,selectedTemplate:document.querySelector('.template-card.selected strong')?.textContent,storageKeys:Object.keys(localStorage),reportText:document.querySelector('.report-content')?.innerText,reportHTML:document.querySelector('.report-content')?.outerHTML,marks:[...document.querySelectorAll('.report-content mark')].map(mark=>({text:(mark.textContent??'').replace(/\u00a0/g,' ').trim(),color:mark.getAttribute('data-color'),visible:!!mark.getClientRects().length,html:mark.outerHTML}))}));diagnostic.rendererErrors=errors;
   await writeFile(path.join(output,'electron-yellow-placeholder-diagnostic.json'),JSON.stringify(diagnostic,null,2));
   await writeFile(path.join(output,'electron-yellow-placeholder-diagnostic.html'),`<!doctype html><meta charset="utf-8"><title>Electron yellow placeholder diagnostic</title>${diagnostic.reportHTML??'<p>.report-content отсутствует</p>'}`);
   await page.screenshot({path:path.join(output,'electron-yellow-placeholder-diagnostic.png'),fullPage:true});
   console.error('Yellow placeholder diagnostic:',JSON.stringify({...diagnostic,reportHTML:diagnostic.reportHTML?.slice(0,12000)},null,2));
  }catch(diagnosticError){console.error('Failed to save Electron failure diagnostics:',diagnosticError);}
  throw error;
 }
}
try{
 await page.locator('.report-content').waitFor();
 assert.equal(await page.locator('.report-content').count(),1);
 assert.equal(await page.locator('.inspector,#field-panel,#field-value').count(),0);
 assert.ok(await page.locator('[data-template-field]').count()>=4);
 assert.match(await page.locator('.report-content').innerText(),/22,1, после 60 лет 22,6-26,0/);
 assert.match(await page.locator('.report-content').innerText(),/справа 0,0 см, слева 0,0 см/);
 assert.ok(await page.locator('#line-height').count(),'line spacing control is visible');assert.equal(await page.locator('[data-align="justify"]').textContent(),'По ширине');
 await captureStartupDom();
 const yellowZero=await waitForYellowZero(),initialYellowZeros=(await yellowZeroSummary()).filter(mark=>mark.text.startsWith('0,0'));console.log('Initial visible yellow zero fields:',JSON.stringify(initialYellowZeros));assert.ok(initialYellowZeros.length>0,'the initial template contains a visible yellow 0,0 placeholder');
 await yellowZero.evaluate(el=>{el.closest('[contenteditable]').focus();const range=document.createRange();range.setStart(el.firstChild,1);range.collapse(true);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});await page.keyboard.insertText('1,2');
 const remainingYellowZeros=(await yellowZeroSummary()).filter(mark=>mark.text.startsWith('0,0'));assert.equal(remainingYellowZeros.length,initialYellowZeros.length-1,'typing replaces one yellow numeric placeholder while retaining its unit');await page.keyboard.press('Control+z');assert.equal((await yellowZeroSummary()).filter(mark=>mark.text.startsWith('0,0')).length,initialYellowZeros.length,'Undo restores the yellow 0,0 field');
 for(const suffix of ['number','patient','birthdate'])await assertFirstTypingReplacesHint(`head-gm.${suffix}`);
 assert.equal(await page.evaluate(()=>typeof window.desktop.exportPDF),'function');
 console.log('PASS: one document editor, no right inspector, source placeholders.');

 const reportBeforeCalculator=await page.locator('.report-content').innerText();await page.locator('#calculator').click();assert.equal(await page.locator('[role="dialog"] h2').textContent(),'Калькулятор');await waitForCalculatorKeyboardFocus();assert.equal(await page.locator('.calculator-overlay').evaluate(el=>getComputedStyle(el).backdropFilter),'none');const calculatorHeader=page.locator('.movable-calculator>header'),beforeMove=await calculatorHeader.boundingBox();await page.mouse.move(beforeMove.x+80,beforeMove.y+15);await page.mouse.down();await page.mouse.move(beforeMove.x+170,beforeMove.y+90,{steps:5});await page.mouse.up();const afterMove=await calculatorHeader.boundingBox();assert.ok(afterMove.x>beforeMove.x+30&&afterMove.y>beforeMove.y+30,'calculator can be dragged to reveal report measurements');await page.keyboard.type('12,5+2,5=');assert.equal(await page.locator('#calculator-display').textContent(),'15');await page.keyboard.press('Escape');assert.equal(await page.locator('[role="dialog"]').count(),0);assert.equal(await page.locator('.report-content').innerText(),reportBeforeCalculator);
 await page.locator('#calculator').click();await waitForCalculatorKeyboardFocus();await page.keyboard.type('1/0=');assert.equal(await page.locator('#calculator-display').textContent(),'Ошибка');await page.keyboard.press('Escape');
 console.log('PASS: calculator handles decimal input, keyboard operations and division by zero without changing the report.');

 await page.evaluate(()=>{const target='0,0';const walker=document.createTreeWalker(document.querySelector('.report-content'),NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())){const offset=node.textContent.indexOf(target);if(offset<0)continue;const mark=node.parentElement.closest('mark[data-color="#ffff00"]');if(!mark)continue;const editor=node.parentElement.closest('[contenteditable]');editor.focus();const range=document.createRange();range.setStart(node,offset);range.setEnd(node,offset+target.length);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);return;}throw new Error('Highlighted measurement not found');});
 await page.keyboard.type('0,25');
 const editedMeasurement=page.locator('.report-content p').filter({hasText:'максимальная размерами'}).first();await page.waitForFunction(()=>[...document.querySelectorAll('.report-content p')].some(el=>el.textContent?.includes('максимальная размерами 0,25 см')));
 assert.match(await editedMeasurement.innerText(),/максимальная размерами 0,25 см/);
 assert.equal(await editedMeasurement.locator('mark[data-color="#ffff00"]').count(),0,'the edited value is no longer yellow-highlighted');
 await page.keyboard.press('Control+z');assert.match(await page.locator('.report-content').innerText(),/справа 0,0 см, слева 0,0 см/);
 console.log('PASS: editing a yellow template measurement removes the yellow fill and Undo restores it.');

 await page.locator('#toggle-theme').click();
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 assert.equal(await page.locator('#toggle-theme').getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('#modality-select').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(34, 46, 59)');
 assert.equal(await page.locator('#modality-select option').first().evaluate(el=>getComputedStyle(el).color),'rgb(228, 234, 242)');
 assert.equal(await page.locator('.paper').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
 await page.locator('#toggle-theme').click();
 assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
 console.log('PASS: visible theme toggle changes and restores dark mode while keeping the report paper white.');

 for (const areaId of [...new Set(reportTemplates.map(template=>template.areaId))]) {
  await page.locator('#modality-select').selectOption(areaId.startsWith('ct-')?'ct':'mri');
  await page.locator('#area-select').selectOption(areaId);
  for (const template of reportTemplates.filter(item=>item.areaId===areaId)) {
   await page.locator(`[data-template="${template.id}"]`).click();
   assert.ok((await page.locator('.report-content').innerText()).trim().length>100,`${template.title} must render its content`);
  }
 }
 console.log('PASS: all 55 source templates across six zones render nonempty content.');

 await page.locator('#modality-select').selectOption('mri');
 await page.locator('#area-select').selectOption('head');
 await page.locator('[data-template="head-gm"]').click();
 const patientHint=await field(patientId).innerText();
 const selectedTemplateTitle=await page.locator('.template-card.selected strong').textContent();
 await field(patientId).evaluate(el=>{el.closest('[contenteditable]').focus();const node=el.firstChild;const range=document.createRange();range.setStart(node,0);range.setEnd(node,1);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});
 await page.keyboard.insertText('К');assert.equal(await field(patientId).innerText(),'К.И.О.');assert.equal(await field(patientId).getAttribute('data-filled'),'true');
 await page.keyboard.press('Control+z');assert.equal(await field(patientId).innerText(),patientHint);assert.equal(await field(patientId).getAttribute('data-filled'),'false');
 await fillField(patientId,'Тестовый Пациент');
 assert.equal(await field(patientId).innerText(),'Тестовый Пациент');
 assert.match(await page.locator('.report-tab-select').first().textContent(),/Тестовый ·/);
 assert.ok(await page.locator('.report-tab-select').first().evaluate(el=>el.scrollWidth<=el.clientWidth),'the patient surname is visible in the report tab');
 assert.equal(await page.locator('#document-name').textContent(),selectedTemplateTitle);
 assert.equal(await field(patientId).getAttribute('data-filled'),'true');
 await page.keyboard.press('Control+z');assert.equal(await field(patientId).innerText(),patientHint);
 await page.keyboard.press('Control+Shift+z');assert.equal(await field(patientId).innerText(),'Тестовый Пациент');
 const second=page.locator('[data-template-field][data-filled="false"]').first();
 const secondId=await second.getAttribute('data-field-id');await selectField(secondId);
 await page.evaluate(()=>{const transfer=new DataTransfer();transfer.setData('text/plain','Проверка вставки');document.querySelector('.report-content').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));});
 assert.equal(await field(secondId).innerText(),'Проверка вставки');
 console.log('PASS: prompt text supports partial editing, full replacement and paste; Undo/Redo restores field state.');

 await page.locator('#settings').click();assert.equal(await page.locator('#dictionary-settings').textContent(),'Личный словарь');await page.locator('#dictionary-settings').click();assert.equal(await page.locator('[role="dialog"] h2').textContent(),'Личный словарь');assert.match(await page.locator('#personal-words').inputValue(),/нормометрии/);assert.match(await page.locator('#personal-words').inputValue(),/дорзальных/);await page.locator('[role="dialog"] [data-close]').first().click();
 await page.locator('#settings').click();await page.locator('#doctor-name').fill('Иванова Мария Петровна');await page.locator('#apply-doctor-now').check();await page.locator('#save-settings').click();
 assert.equal(await field(doctorId).innerText(),'Иванова Мария Петровна');
 await page.locator('#settings').click();await page.locator('#saved-doctor-choice').selectOption({label:'Иванова Мария Петровна'});assert.equal(await page.locator('#doctor-name').inputValue(),'Иванова Мария Петровна');await page.locator('.dialog-overlay footer [data-close]').click();
 await field(doctorId).evaluate(el=>{el.closest('[contenteditable]').focus();const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});await page.keyboard.insertText('Петров Алексей Иванович');
 assert.match(await page.locator('.report-content').innerText(),/Петров Алексей Иванович/);
 assert.doesNotMatch(await page.locator('.report-content').innerText(),/Иванова Мария Петровна/);
 await page.locator('#review-unchanged').click();assert.ok(await page.locator('[data-unchanged="true"]').count()>0);
 assert.equal(await field(patientId).getAttribute('data-unchanged'),null);
 console.log('PASS: doctor can change per report; untouched review excludes edited patient field.');

 const saved=await saveWord('v3-report.docx');
 assert.equal(saved.imported.doc.attrs.sourceFormat,'alliance-template');
 assert.equal(saved.imported.templateId,'head-gm');
 assert.match(JSON.stringify(saved.imported.doc),/Тестовый Пациент/);
 assert.match(JSON.stringify(saved.imported.doc),/Петров Алексей Иванович/);
 const zip=unzipSync(saved.bytes),xml=strFromU8(zip['word/document.xml']);
 assert.match(xml,/DejaVu Sans/);assert.match(xml,/w:top="907"/);
 assert.doesNotMatch(xml,/template-unchanged|proof-spelling|proof-grammar|data-unchanged/);
 console.log('PASS: real DOCX preserves report, source geometry and formatting, excludes review/proof decorations.');

 await page.locator('#copy-report').click();
 await page.getByRole('status').filter({hasText:'Описание скопировано с форматированием'}).waitFor();
 const clip=await application.evaluate(async({clipboard})=>{const items=await clipboard.read();return {text:await clipboard.readText(),html:await(await items[0].getType('text/html')).text()};});
 assert.match(clip.text,/Тестовый Пациент/);assert.match(clip.html,/Arial/);
 const pdfPath=path.join(output,'v3-native.pdf');
 await application.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},pdfPath);
 await page.locator('#export-pdf').click();await page.locator('#preview-save-pdf').click();if(await page.locator('#confirm-pdf').count())await page.locator('#confirm-pdf').click();
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

 await page.locator('#area-select').selectOption('spine');const pit=page.locator('[data-template]').first();const pitId=await pit.getAttribute('data-template');await pit.click();if(await page.locator('#confirm-new').count())await page.locator('#confirm-new').click();
 assert.ok(await page.locator('#template-name').innerText());
 assert.ok(await page.locator('.report-content mark[data-color="#ffff00"]').count()>0,`yellow template highlights render immediately after first selection (${pitId})`);
 await page.locator('#report-file').setInputFiles(saved.filePath);if(await page.locator('#confirm-open').count())await page.locator('#confirm-open').click();
 await field(patientId).waitFor();assert.equal(await field(patientId).innerText(),'Тестовый Пациент');
 assert.equal(await page.locator('#area-select').inputValue(),'head');
 assert.equal(await page.locator('#template-name').innerText(),'ГМ');
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
 await insertedField.evaluate(el=>{el.closest('[contenteditable]').focus();const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});await page.keyboard.press('Control+b');await page.keyboard.insertText('Иследование. Очаг очаг не выявлен.');await page.keyboard.press('Control+b');
 assert.match(await insertedField.innerText(),/Иследование/);
 await page.locator('#check-now').click();
 const spelling=page.locator('.proof-spelling').filter({hasText:/^Иследование$/});await spelling.waitFor({timeout:30000});
 const proofStyle=await spelling.evaluate(el=>{const s=getComputedStyle(el);return {line:s.textDecorationLine,style:s.textDecorationStyle,color:s.textDecorationColor};});
 assert.equal(proofStyle.line,'underline');assert.equal(proofStyle.style,'wavy');assert.equal(proofStyle.color,'rgb(214, 40, 40)');
 await spelling.click();await page.locator('.proof-popup').waitFor();
 await page.locator('.proof-popup [data-correction]').filter({hasText:/^Исследование$/}).click();
 const grammar=page.locator('.proof-grammar').filter({hasText:/^Очаг очаг$/});await grammar.waitFor({timeout:30000});await grammar.click();await page.locator('.proof-popup [data-correction]').filter({hasText:/^Очаг$/}).click();
 assert.equal(await insertedField.innerText(),'Исследование. Очаг не выявлен.');
 await insertedField.evaluate(el=>{el.closest('[contenteditable]').focus();const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});await page.locator('#highlight-yellow').click();
 assert.equal(await page.locator('#highlight-yellow').getAttribute('aria-pressed'),'true');assert.match(await page.locator('.toast').textContent(),/залит жёлтым/);assert.equal(await page.locator('.report-content').evaluate(el=>el.classList.contains('show-yellow-selection')),true);
 assert.ok((await page.locator('.report-content mark[data-color="#ffff00"]').allTextContents()).some(t=>t.includes('Исследование. Очаг не выявлен.')),'yellow text highlighter can be applied');
 await insertedField.evaluate(el=>{el.closest('[contenteditable]').focus();const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});await page.locator('#highlight-yellow').click();assert.ok(!(await page.locator('.report-content mark[data-color="#ffff00"]').allTextContents()).some(t=>t.includes('Исследование. Очаг не выявлен.')),'yellow text highlighter can be removed from the selected text');
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
 const firstTab=await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select');
 await page.locator('#zoom').evaluate(el=>{el.value='145';el.dispatchEvent(new Event('input',{bubbles:true}));});assert.equal(await page.locator('#zoom-value').innerText(),'145%');assert.equal(await page.locator('.paper').evaluate(el=>el.style.zoom),'1.45');
 await page.locator('#new-report').click();const secondTab=await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select');assert.notEqual(secondTab,firstTab);await fillField(patientId,'Второе заключение');
 await page.locator('[data-tab="templates"]').click();const alternate=page.locator('.template-card:not(.selected)').first();await alternate.click();const thirdTab=await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select');assert.notEqual(thirdTab,secondTab);assert.equal(await page.locator('.report-tab').count(),3);await page.locator(`[data-report-select="${secondTab}"]`).click();assert.equal(await field(patientId).innerText(),'Второе заключение');await page.locator(`[data-report-select="${thirdTab}"]`).click();await page.locator(`[data-report-close="${thirdTab}"]`).click();assert.equal(await page.locator('.report-tab').count(),2);
 await page.locator(`[data-report-select="${firstTab}"]`).click();assert.match(await page.locator('.report-content').innerText(),/Исследование\. Очаг не выявлен\./);
 await page.locator(`[data-report-select="${secondTab}"]`).click();assert.equal(await field(patientId).innerText(),'Второе заключение');await page.locator(`[data-report-close="${secondTab}"]`).click();
 await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Сохранено на компьютере');await page.reload();await page.locator('.report-content').waitFor();
 assert.match(await page.locator('.report-content').innerText(),/Исследование\. Очаг не выявлен\./);
 await page.locator('#new-report').click();const persistedTab=await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select');await fillField(patientId,'Сохранённое второе заключение');await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Сохранено на компьютере');await page.reload();await page.locator('.report-content').waitFor();assert.equal(await page.locator('.report-tab').count(),2);assert.equal(await field(patientId).innerText(),'Сохранённое второе заключение');assert.equal(await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select'),persistedTab);
 // XRS-01: recovery preserves healthy tabs, active id, dirty flags and templates at every workspace size.
 for(const size of [1,5,12]){
  const fixture=await page.evaluate(size=>{
   const key='mri-report-studio.workspace.v1',templateKey='mri-alliance.templates.v4';
   const source=JSON.parse(localStorage.getItem(key)),templateSnapshot=localStorage.getItem(templateKey);
   const reports=Array.from({length:size},(_,index)=>({id:`xrs-${size}-${index}`,templateId:source.reports[0].templateId,doc:source.reports[0].doc,dirty:index%2===1}));
   reports[size-1]={...reports[size-1],doc:{type:'invalid'}};
   const activeId=reports[0].id,corrupted={activeId,reports},raw=JSON.stringify(corrupted);
   return {size,activeId,raw,templateSnapshot,validIds:reports.slice(0,-1).map(report=>report.id),dirtyIds:reports.slice(0,-1).filter(report=>report.dirty).map(report=>report.id)};
  },size);
  await reloadWithWorkspaceFixture(fixture.raw);await page.locator('.report-content').waitFor();
  const expected=fixture.size===1?1:fixture.size-1;
  assert.equal(await page.locator('.report-tab').count(),expected,`${size} tabs: only the damaged document is discarded`);
  if(size>1){
   assert.equal(await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select'),fixture.activeId,`${size} tabs: active document is restored`);
   for(const id of fixture.validIds){const tab=page.locator(`[data-report-select="${id}"]`);assert.equal(await tab.count(),1,`${size} tabs: ${id} is retained`);assert.equal((await tab.innerText()).startsWith('● '),fixture.dirtyIds.includes(id),`${size} tabs: dirty state for ${id} is restored`);}
  }
  const backup=await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('mri-report-studio.workspace.v1.recovery.')).map(key=>localStorage.getItem(key)));
  assert.ok(backup.includes(fixture.raw),`${size} tabs: original workspace bytes are backed up`);
  assert.equal(await page.evaluate(key=>localStorage.getItem(key), 'mri-alliance.templates.v4'),fixture.templateSnapshot,`${size} tabs: template data is unchanged`);
  if(size>1){await page.locator(`[data-report-select="${fixture.activeId}"]`).click();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Сохранено на компьютере');}
  await page.reload();await page.locator('.report-content').waitFor();
  assert.equal(await page.locator('.report-tab').count(),expected,`${size} tabs: recovered workspace persists after another launch`);
 }
 console.log('PASS: XRS-01 recovers workspaces of 1, 5 and 12 tabs, preserving healthy state and creating backups.');

 // Malformed JSON is preserved byte-for-byte before the replacement workspace is saved.
 const malformed='{"reports":[broken-json';await reloadWithWorkspaceFixture(malformed);await page.locator('.report-content').waitFor();
 assert.ok((await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('mri-report-studio.workspace.v1.recovery.')).map(key=>localStorage.getItem(key)))).includes(malformed),'malformed JSON is backed up verbatim');
 await page.locator('#new-report').click();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Сохранено на компьютере');
 // If backup storage fails, autosave must leave the damaged source untouched; a later launch retries recovery.
 const backupFailure=JSON.stringify({activeId:'bad-active',reports:[{id:'bad-tab',templateId:'head-gm',doc:{type:'invalid'},dirty:true}]});
 await page.addInitScript(()=>{if(sessionStorage.getItem('xrs-backup-failure-used'))return;sessionStorage.setItem('xrs-backup-failure-used','1');const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(String(key).startsWith('mri-report-studio.workspace.v1.recovery.'))throw new DOMException('Quota exceeded','QuotaExceededError');return original.call(this,key,value);};});
 await reloadWithWorkspaceFixture(backupFailure);await page.locator('.report-content').waitFor();await page.locator('#new-report').click();await page.waitForTimeout(700);
 assert.equal(await page.evaluate(()=>localStorage.getItem('mri-report-studio.workspace.v1')),backupFailure,'failed backup prevents overwriting the only damaged workspace');
 await page.reload();await page.locator('.report-content').waitFor();
 assert.ok((await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('mri-report-studio.workspace.v1.recovery.')).map(key=>localStorage.getItem(key)))).includes(backupFailure),'a later launch retries and completes the backup');
 console.log('PASS: XRS-01 preserves malformed data and blocks destructive autosave when backup creation fails.');
 await page.locator('#modality-select').selectOption('ct');const ctTemplate=page.locator('[data-template]').first(),ctTemplateId=await ctTemplate.getAttribute('data-template');await ctTemplate.click();if(await page.locator('#confirm-new').count())await page.locator('#confirm-new').click();for(const suffix of ['number','patient','birthdate'])await assertFirstTypingReplacesHint(`${ctTemplateId}.${suffix}`);
 assert.deepEqual(errors,[]);
 await page.screenshot({path:path.join(output,'v3-desktop.png')});
 console.log('PASS: rich selection library save and local report persistence.');
}catch(error){
 const detail=error instanceof Error?(error.stack??error.message):String(error),annotation=detail.replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A').replaceAll(':','%3A').replaceAll(',','%2C');
 await page.screenshot({path:path.join(output,'v3-failed.png')});console.error('Renderer errors:',errors);console.error('Electron integration first failure:',detail);process.stdout.write(`::error title=Electron integration first failure::${annotation}\n`);
 if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`## Electron integration failure\n\n\`\`\`text\n${detail}\n\`\`\`\n`);
 throw error;
}finally{await application.close();}

const server=createServer(async(_request,response)=>{response.setHeader('Content-Type','text/html;charset=utf-8');response.end(await readFile(path.join(root,'dist/index.html')));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});
try{
 const browserPage=await browser.newPage({viewport:{width:1500,height:1050}});const requests=[];browserPage.on('request',request=>requests.push(request.url()));
 await browserPage.goto(`http://127.0.0.1:${server.address().port}`);await browserPage.locator('.report-content').waitFor();
 await browserPage.locator(`[data-field-id="${patientId}"]`).evaluate(el=>{el.closest('[contenteditable]').focus();const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});await browserPage.keyboard.insertText('Проверка браузерной версии');
 await browserPage.waitForFunction(()=>document.querySelector('#save-state').textContent==='Сохранено на компьютере');await browserPage.reload();
 assert.equal(await browserPage.locator(`[data-field-id="${patientId}"]`).innerText(),'Проверка браузерной версии');
 await browserPage.locator('#settings').click();await browserPage.locator('#doctor-name').fill('Тестов Иван Петрович');
 const jpegBytes=await browserPage.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=1000;const context=canvas.getContext('2d'),pixels=context.createImageData(canvas.width,canvas.height);let seed=112233;for(let i=0;i<pixels.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;pixels.data[i]=seed&255;pixels.data[i+1]=(seed>>>8)&255;pixels.data[i+2]=(seed>>>16)&255;pixels.data[i+3]=255;}context.putImageData(pixels,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.95));const transfer=new DataTransfer();transfer.items.add(new File([blob],'stamp.jpg',{type:'image/jpeg'}));const input=document.querySelector('#doctor-stamp-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));return blob.size;});
 assert.ok(jpegBytes>1_000_000&&jpegBytes<=5*1024*1024,'JPG above the former 1 MB limit is accepted');await browserPage.locator('#stamp-preview img').waitFor();for(const [id,value] of [['#stamp-position-y','35'],['#stamp-position-x','-45']])await browserPage.locator(id).evaluate((input,value)=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));},value);await browserPage.locator('#save-settings').click();
 const storedStamp=await browserPage.evaluate(()=>{const value=JSON.parse(localStorage.getItem('mri-alliance.settings.v3'));return {image:value.doctorStamps['Тестов Иван Петрович'],size:value.doctorStampSizes['Тестов Иван Петрович'],position:value.doctorStampPositions['Тестов Иван Петрович']};});
 assert.match(storedStamp.image,/^data:image\/jpeg;base64,/);assert.deepEqual(storedStamp.size,{width:1200,height:1000});assert.deepEqual(storedStamp.position,{x:-45,y:35});
 await browserPage.screenshot({path:path.join(root,'downloads','MRI_Alliance_Preview.png')});
 assert.equal(requests.some(url=>!url.startsWith('http://127.0.0.1:')&&!url.startsWith('data:')),false);
 console.log('PASS: standalone browser bundle, font resources and autosave need no external network.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
