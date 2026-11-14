import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright-core';
import { appendFile, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { importOwnDocx } from '../src/docx.ts';
import { reportTemplates } from '../src/catalog.ts';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

const root=process.cwd(), output=path.join(root,'test-output');
await mkdir(output,{recursive:true});
const userData=await mkdtemp(path.join(output,'electron-v3-'));
const electronOptions={...(process.env.ELECTRON_PATH?{executablePath:process.env.ELECTRON_PATH}:{}),args:['.',`--user-data-dir=${userData}`,'--no-sandbox','--ozone-platform=headless','--disable-gpu'],cwd:root,env:{...process.env,XDG_CACHE_HOME:'/workspace/.cache',XDG_CONFIG_HOME:'/workspace/.config'}};
const errors=[];
let application=await _electron.launch(electronOptions);
let page=await application.firstWindow();
const initialChannel=await page.evaluate(()=>window.desktop.getUpdateChannel());
const expectedApplicationVersion=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
assert.equal(initialChannel.version,expectedApplicationVersion);
if(expectedApplicationVersion.includes('-beta.'))assert.equal(initialChannel.profile,'beta','prerelease app uses an isolated Beta profile');
await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]?.setSize(1500,1000));
page.on('pageerror',error=>errors.push(error.message));
const patientId='head-gm.patient', doctorId='HEAD.BASE.2.FIELD.0043';
const field=id=>page.locator(`[data-template-field][data-field-id="${id}"]`);
async function selectField(id){await field(id).first().evaluate(el=>{el.closest('[contenteditable]').focus();const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});}
async function fillField(id,text){
 await selectField(id);
 const before=await page.evaluate(id=>{const el=document.querySelector(`[data-template-field][data-field-id="${id}"]`),selection=getSelection(),selected=selection?.toString()??'';return{fieldLength:el?.innerText?.length,filled:el?.getAttribute('data-filled'),selectedLength:selected.length,selectionMatchesField:selected===el?.innerText,anchorOffset:selection?.anchorOffset,focusOffset:selection?.focusOffset,anchorInsideField:!!selection?.anchorNode&&el?.contains(selection.anchorNode),focusInsideField:!!selection?.focusNode&&el?.contains(selection.focusNode)};},id);
 await page.keyboard.insertText(text);
 const current=await field(id).innerText();
 if(current!==text){
  const diagnostic=await page.evaluate(({id,expected})=>{
   const el=document.querySelector(`[data-template-field][data-field-id="${id}"]`),selection=getSelection();
   return{fieldId:id,expectedLength:expected.length,currentText:el?.innerText,currentLength:el?.innerText?.length,filled:el?.getAttribute('data-filled'),selectedTextLength:selection?.toString().length,selectionMatchesField:selection?.toString()===el?.innerText,anchorOffset:selection?.anchorOffset,focusOffset:selection?.focusOffset,anchorNodeType:selection?.anchorNode?.nodeType,focusNodeType:selection?.focusNode?.nodeType,activeElementEditable:document.activeElement?.closest('[contenteditable]')!==null};
  },{id,expected:text});
  const failure={before,after:diagnostic};
  await writeFile(path.join(output,'browser-edit-failure.json'),JSON.stringify(failure,null,2));
  console.error('Synthetic field replacement diagnostic:',JSON.stringify(failure));
  throw new Error(`Synthetic field replacement failed: ${JSON.stringify(failure)}`);
 }
}
async function typeAtFieldCaret(id,text='Ж'){await field(id).first().evaluate(el=>{el.closest('[contenteditable]').focus();const node=el.firstChild;const range=document.createRange();range.setStart(node,Math.floor((node.textContent??'').length/2));range.collapse(true);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});await page.keyboard.type(text);}
async function assertFirstTypingReplacesHint(id){const target=field(id).first(),hint=await target.innerText();await typeAtFieldCaret(id,'Ж');assert.equal(await target.innerText(),'Ж',`${id}: typing at an interior caret replaces the whole hint`);assert.equal(await target.getAttribute('data-filled'),'true');await page.keyboard.press('Control+z');assert.equal(await target.innerText(),hint,`${id}: undo restores the complete hint`);assert.equal(await target.getAttribute('data-filled'),'false');}
const tabTrace=[];
async function assertTabState(step,id,required,excluded){
 await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='Сохранено на компьютере');
 const snapshot=await page.evaluate(()=>({activeId:document.querySelector('.report-tab.active [data-report-select]')?.dataset.reportSelect,text:document.querySelector('.report-content')?.innerText,workspace:JSON.parse(localStorage.getItem('mri-report-studio.workspace.v1'))}));
 tabTrace.push({step,...snapshot});await writeFile(path.join(output,'electron-tab-trace.json'),JSON.stringify(tabTrace,null,2));
 assert.equal(snapshot.activeId,id,step+': selected report ID');assert.equal(snapshot.workspace.activeId,id,step+': persisted active ID');
 assert.ok(snapshot.text.includes(required),step+': editor retains expected text');assert.ok(!snapshot.text.includes(excluded),step+': editor excludes other patient');
 const stored=JSON.stringify(snapshot.workspace.reports.find(report=>report.id===id)?.doc);
 assert.ok(stored.includes(required),step+': stored document retains expected text');assert.ok(!stored.includes(excluded),step+': stored document excludes other patient');
}
async function assertUndoIsolated(step,id,own,foreign,otherId,other){
 await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='Сохранено на компьютере');
 const snapshot=await page.evaluate(()=>({activeId:document.querySelector('.report-tab.active [data-report-select]')?.dataset.reportSelect,text:document.querySelector('.report-content')?.innerText,workspace:JSON.parse(localStorage.getItem('mri-report-studio.workspace.v1'))}));
 assert.equal(snapshot.activeId,id,step+': selected report ID');assert.equal(snapshot.workspace.activeId,id,step+': persisted active ID');assert.ok(!snapshot.text.includes(own),step+': Undo removes only this report’s synthetic patient edit');assert.ok(!snapshot.text.includes(foreign),step+': editor excludes the other patient');
 const ownDoc=JSON.stringify(snapshot.workspace.reports.find(report=>report.id===id)?.doc),otherDoc=JSON.stringify(snapshot.workspace.reports.find(report=>report.id===otherId)?.doc);
 assert.ok(!ownDoc.includes(own),step+': active report history is persisted after Undo');assert.ok(!ownDoc.includes(foreign),step+': active report remains isolated');assert.ok(otherDoc.includes(other),step+': Undo leaves the other report unchanged');assert.ok(!otherDoc.includes(own),step+': the other report excludes this patient');
}
async function newReport(){await page.locator('#new-report').click();if(await page.locator('#confirm-new').count())await page.locator('#confirm-new').click();}
async function waitForCalculatorKeyboardFocus(){await page.waitForFunction(()=>{const panel=document.querySelector('.movable-calculator');return Boolean(panel&&panel.contains(document.activeElement));});}
async function saveWord(name){
 const filePath=path.join(output,name);await rm(filePath,{force:true});
 await application.evaluate(({session},dest)=>session.defaultSession.once('will-download',(_event,item)=>item.setSavePath(dest)),filePath);
 await page.locator('#save-docx').click();
 assert.ok(await page.locator('.paged-preview-frame iframe, .preview-page').count(),'paginated preview opens before Word export');
 await page.locator('#preview-save-word').click();
 if(await page.locator('#continue-yellow-export').count())await page.locator('#continue-yellow-export').click();
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
 const remainingYellowZeros=(await yellowZeroSummary()).filter(mark=>mark.text.startsWith('0,0'));assert.equal(remainingYellowZeros.length,initialYellowZeros.length-1,'typing replaces one yellow numeric placeholder while retaining its unit');await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='Сохранено на компьютере');const undoDebug=await page.evaluate(key=>{const value=JSON.parse(localStorage.getItem(key)||'{}'),record=Object.values(value)[0];return{undo:record?.history?.undo?.map(entry=>({forward:entry.forward.map(step=>step.stepType),inverse:entry.inverse.map(step=>step.stepType),before:entry.before,after:entry.after})),redo:record?.history?.redo?.length};},'mri-report-studio.undo-history.v1');console.log('Synthetic field history before Undo:',JSON.stringify(undoDebug));await page.keyboard.press('Control+z');const yellowAfterUndo=(await yellowZeroSummary()).filter(mark=>mark.text.startsWith('0,0'));if(yellowAfterUndo.length!==initialYellowZeros.length)console.log('Synthetic field state after Undo:',JSON.stringify({count:yellowAfterUndo.length,last:await yellowZeroSummary()}));assert.equal(yellowAfterUndo.length,initialYellowZeros.length,'Undo restores the yellow 0,0 field');
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

 await page.locator('#settings').click();
 await page.locator('#update-channel-select').waitFor();
 await page.waitForFunction(channel=>document.querySelector('#update-channel-select')?.value===channel,initialChannel.channel);
 assert.equal(await page.locator('#beta-opt-in').isChecked(),initialChannel.channel==='beta');
 await page.locator('.dialog [data-close]').first().click();

 await page.locator('#toggle-theme').click();
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 assert.equal(await page.locator('#toggle-theme').getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('#modality-select').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(34, 46, 59)');
 assert.equal(await page.locator('#modality-select option').first().evaluate(el=>getComputedStyle(el).color),'rgb(228, 234, 242)');
 assert.equal(await page.locator('.paper').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
 await page.locator('#toggle-theme').click();
 assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
 console.log('PASS: visible theme toggle changes and restores dark mode while keeping the report paper white.');

 await newReport();
 for (const areaId of [...new Set(reportTemplates.map(template=>template.areaId))]) {
  for (const template of reportTemplates.filter(item=>item.areaId===areaId)) {
   const activeTab=page.locator('.report-tab.active');
   if(await activeTab.count()){
    await activeTab.locator('[data-report-close]').click();
    if(await page.locator('#close-unsaved-report').count())await page.locator('#close-unsaved-report').click();
   }
   await page.locator('#modality-select').selectOption(areaId.startsWith('ct-')?'ct':'mri');
   await page.locator('#area-select').selectOption(areaId);
   await page.locator(`[data-template="${template.id}"]`).click();
   assert.ok((await page.locator('.report-content').innerText()).trim().length>100,`${template.title} must render its content`);
  }
 }
 const activeAfterTemplateSweep=page.locator('.report-tab.active');
 if(await activeAfterTemplateSweep.count())await activeAfterTemplateSweep.locator('[data-report-close]').click();
 console.log('PASS: all 55 source templates across six zones render nonempty content.');

 await page.locator('#modality-select').selectOption('mri');
 await page.locator('#area-select').selectOption('head');
 const previousHeadReportId=await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select');
 await page.locator('[data-template="head-gm"]').click();
 await page.waitForFunction(({previousId,templateId})=>{
  const activeId=document.querySelector('.report-tab.active [data-report-select]')?.getAttribute('data-report-select');
  const workspace=JSON.parse(localStorage.getItem('mri-report-studio.workspace.v1')||'{}');
  return Boolean(activeId&&activeId!==previousId&&workspace.activeId===activeId&&workspace.reports?.some(report=>report.id===activeId&&report.templateId===templateId));
 },{previousId:previousHeadReportId,templateId:'head-gm'});
 await field(patientId).waitFor({state:'visible'});
 const patientHint=await field(patientId).innerText();
 const selectedTemplateTitle=await page.locator('.template-card.selected strong').textContent();
 await field(patientId).evaluate(el=>{el.closest('[contenteditable]').focus();const node=el.firstChild;const range=document.createRange();range.setStart(node,0);range.setEnd(node,1);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});
 await page.keyboard.insertText('К');assert.equal(await field(patientId).innerText(),'К');assert.equal(await field(patientId).getAttribute('data-filled'),'true');
 await page.keyboard.press('Control+z');assert.equal(await field(patientId).innerText(),patientHint);assert.equal(await field(patientId).getAttribute('data-filled'),'false');
 await fillField(patientId,'Тестовый Пациент');
 assert.equal(await field(patientId).innerText(),'Тестовый Пациент');
 await page.waitForFunction(()=>document.querySelector('.report-tab.active .report-tab-select')?.textContent?.includes('Тестовый'));
 assert.match(await page.locator('.report-tab.active .report-tab-select').textContent(),/Тестовый/);
 assert.ok(await page.locator('.report-tab.active .report-tab-select').evaluate(el=>el.scrollWidth<=el.clientWidth),'the patient surname is visible in the active report tab');
 assert.equal(await page.locator('#document-name').textContent(),`Тестовый П. · ${selectedTemplateTitle}`);
 assert.equal(await field(patientId).getAttribute('data-filled'),'true');
 await page.keyboard.press('Control+z');assert.equal(await field(patientId).innerText(),patientHint);
 await page.keyboard.press('Control+Shift+z');assert.equal(await field(patientId).innerText(),'Тестовый Пациент');
 const second=page.locator('[data-template-field][data-filled="false"]').first();
 const secondId=await second.getAttribute('data-field-id');await selectField(secondId);
 await page.evaluate(id=>{window.__xrsPasteTrace=[];document.querySelector('.report-content')?.addEventListener('paste',event=>{const target=event.target instanceof Element?event.target:null;window.__xrsPasteTrace.push({fieldId:target?.closest('[data-template-field]')?.getAttribute('data-field-id')??null,syntheticPayloadReceived:event.clipboardData?.getData('text/plain')==='Проверка вставки'});},true);},secondId);
 await application.evaluate(({clipboard},text)=>clipboard.writeText(text),'Проверка вставки');
 const clipboardText=await application.evaluate(({clipboard})=>clipboard.readText());assert.equal(clipboardText,'Проверка вставки','Electron clipboard contains the synthetic test payload');
 const pasteStarted=Date.now();await page.keyboard.press('Control+v');
 let pasteDiagnostic;
 try{await page.waitForFunction(({id,text})=>document.querySelector(`[data-field-id="${id}"]`)?.textContent===text,{id:secondId,text:'Проверка вставки'},{timeout:2000});pasteDiagnostic=await page.evaluate(id=>({fieldFilled:document.querySelector(`[data-field-id="${id}"]`)?.getAttribute('data-filled'),pasteEvents:window.__xrsPasteTrace??[]}),secondId);}
 catch(error){const diagnostic=await page.evaluate(id=>({fieldId:id,fieldFilled:document.querySelector(`[data-field-id="${id}"]`)?.getAttribute('data-filled'),fieldLength:document.querySelector(`[data-field-id="${id}"]`)?.textContent?.length,activeElementTag:document.activeElement?.tagName,activeElementEditable:document.activeElement?.closest('[contenteditable]')!==null,selectionLength:getSelection()?.toString().length,pasteEvents:window.__xrsPasteTrace??[]}),secondId);await writeFile(path.join(output,'electron-paste-diagnostic.json'),JSON.stringify({clipboardText,diagnostic},null,2));console.error('Synthetic clipboard diagnostic:',JSON.stringify({clipboardText,diagnostic}));throw new Error(`${error.message}; synthetic clipboard diagnostic=${JSON.stringify({clipboardText,diagnostic})}`);}
 assert.equal(await field(secondId).innerText(),'Проверка вставки');assert.equal(await field(secondId).getAttribute('data-filled'),'true');
 assert.ok(pasteDiagnostic.pasteEvents.some(event=>event.syntheticPayloadReceived),'renderer received the actual synthetic paste event');
 console.log(`PASS: prompt text supports partial editing, full replacement, and clipboard paste (${Date.now()-pasteStarted} ms).`);

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
 assert.match(xml,/Arial/);assert.match(xml,/w:top="2438"/);
 assert.doesNotMatch(xml,/template-unchanged|proof-spelling|proof-grammar|data-unchanged/);
 console.log('PASS: real DOCX preserves report, source geometry and formatting, excludes review/proof decorations.');

 await page.locator('#copy-report').click();
 await page.getByRole('status').filter({hasText:'Описание скопировано с форматированием'}).waitFor();
 const clip=await application.evaluate(async({clipboard})=>{const items=await clipboard.read();return {text:await clipboard.readText(),html:await(await items[0].getType('text/html')).text()};});
 assert.match(clip.text,/Тестовый Пациент/);assert.match(clip.html,/Arial/);
 const pdfPath=path.join(output,'v3-native.pdf');
 await application.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},pdfPath);
 await page.locator('#export-pdf').click();await page.locator('#preview-save-pdf').click();if(await page.locator('#continue-yellow-export').count())await page.locator('#continue-yellow-export').click();
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

 const templateBefore=await page.evaluate(()=>JSON.parse(localStorage.getItem('mri-alliance.templates.v4')??'{}')['head-gm']);
 const templateDownload=path.join(output,'sidebar-template.docx');await rm(templateDownload,{force:true});
 await application.evaluate(({session},dest)=>session.defaultSession.once('will-download',(_event,item)=>item.setSavePath(dest)),templateDownload);
 await page.locator('#export-template-docx').click();
 let templateBytes,originalZip;for(let i=0;i<200;i++){try{templateBytes=await readFile(templateDownload);originalZip=unzipSync(templateBytes);if(originalZip['word/document.xml'])break;}catch{}await new Promise(r=>setTimeout(r,50));}
 assert.ok(templateBytes?.length&&originalZip?.['word/document.xml'],'separate library template export completes as a valid DOCX');const originalXml=strFromU8(originalZip['word/document.xml']);
 const firstText=/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/.exec(originalXml)?.[1];assert.ok(firstText,'template DOCX contains Word text');
 const editedZip={...originalZip,'word/document.xml':strToU8(originalXml.replace(firstText,'СИНТЕТИЧЕСКИЙ ШАБЛОН ИЗ WORD'))};const editedFile=path.join(output,'sidebar-template-edited.docx');await writeFile(editedFile,zipSync(editedZip));
 const backupCount=await page.evaluate(()=>JSON.parse(localStorage.getItem('mri-alliance.template-backups.v1')??'[]').length);
 await page.locator('#template-file').setInputFiles(editedFile);await page.locator('#confirm-template-import').waitFor();
 assert.match(await page.locator('.template-import-diff').innerText(),/СИНТЕТИЧЕСКИЙ ШАБЛОН ИЗ WORD/);
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('mri-alliance.templates.v4')??'{}')['head-gm']),templateBefore);
 await page.locator('[role="dialog"] footer [data-close]').click();await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('mri-alliance.template-backups.v1')??'[]').length),backupCount,'cancel does not create a backup or mutate templates');
 await page.locator('#template-file').setInputFiles(editedFile);await page.locator('#confirm-template-import').waitFor();await page.locator('#confirm-template-import').click();
 const updatedTemplate=await page.evaluate(()=>JSON.parse(localStorage.getItem('mri-alliance.templates.v4')??'{}')['head-gm']);
 assert.match(JSON.stringify(updatedTemplate),/СИНТЕТИЧЕСКИЙ ШАБЛОН ИЗ WORD/);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('mri-alliance.template-backups.v1')??'[]').length),backupCount+1);
 await page.locator('#restore-template-backup').click();await page.locator('[data-restore-template-backup]').first().click();await page.locator('#confirm-template-backup-restore').click();
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('mri-alliance.templates.v4')??'{}')['head-gm']),templateBefore);
 assert.match(await page.locator('.report-content').innerText(),/Тестовый Пациент/,'template restore does not modify open patient reports');
 console.log('PASS: template DOCX export, Word edit preview/cancel, verified backup, replacement and restore are isolated from patient reports.');

 const originalReportTab=await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select');
 const reportTabsBefore=await page.locator('.report-tab').count();
 const originalReportIds=await page.locator('.report-tab [data-report-select]').evaluateAll(elements=>elements.map(element=>element.getAttribute('data-report-select')));
 const wordZip=unzipSync(saved.bytes),wordXml=strFromU8(wordZip['word/document.xml']);
 assert.match(wordXml,/Тестовый Пациент/);
 const editedReportZip={...wordZip,'word/document.xml':strToU8(wordXml.replace('Тестовый Пациент','Синтетический Пациент'))};
 const editedReportFile=path.join(output,'word-edited-report.docx');await writeFile(editedReportFile,zipSync(editedReportZip));
 await page.locator('#report-file').setInputFiles(editedReportFile);
 await page.waitForFunction(expected=>document.querySelectorAll('.report-tab').length===expected,reportTabsBefore+1);
 assert.equal(await page.locator('.report-tab').count(),reportTabsBefore+1,'Word edit opens a new tab');
 assert.match(await page.locator('.report-content').innerText(),/Синтетический Пациент/);
 assert.ok(await page.locator(`[data-report-select="${originalReportTab}"]`).count(),'the previous protocol remains open');
 const noMetadataZip={...editedReportZip};delete noMetadataZip['customXml/mri-report-studio.xml'];
 const noMetadataFile=path.join(output,'word-no-metadata-report.docx');await writeFile(noMetadataFile,zipSync(noMetadataZip));
 await page.locator('#report-file').setInputFiles(noMetadataFile);await page.locator('#confirm-recovered-report').waitFor();
 assert.match(await page.locator('[role="dialog"]').innerText(),/Синтетический Пациент/);
 await page.locator('[role="dialog"] footer [data-close]').click();assert.equal(await page.locator('.report-tab').count(),reportTabsBefore+1,'cancelled recovery does not open or replace a protocol');
 await page.locator('#report-file').setInputFiles(noMetadataFile);await page.locator('#confirm-recovered-report').click();
 await page.waitForFunction(expected=>document.querySelectorAll('.report-tab').length===expected,reportTabsBefore+2);
 assert.equal(await page.locator('.report-tab').count(),reportTabsBefore+2);
 assert.match(await page.locator('.report-content').innerText(),/Синтетический Пациент/);
 const corruptMetadataZip={...editedReportZip,'customXml/mri-report-studio.xml':strToU8('<corrupt/>')};
 const corruptMetadataFile=path.join(output,'word-corrupt-metadata-report.docx');await writeFile(corruptMetadataFile,zipSync(corruptMetadataZip));
 await page.locator('#report-file').setInputFiles(corruptMetadataFile);await page.locator('#confirm-recovered-report').waitFor();await page.locator('#confirm-recovered-report').click();
 await page.waitForFunction(expected=>document.querySelectorAll('.report-tab').length===expected,reportTabsBefore+3);
 assert.equal(await page.locator('.report-tab').count(),reportTabsBefore+3);
 await page.locator(`[data-report-select="${originalReportTab}"]`).click();
 assert.match(await page.locator('.report-content').innerText(),/Тестовый Пациент/,'Word recovery never changes the original protocol');
 const recoveredReportIds=await page.locator('.report-tab [data-report-select]').evaluateAll((elements,previous)=>elements.map(element=>element.getAttribute('data-report-select')).filter(id=>!previous.includes(id)),originalReportIds);
 assert.equal(recoveredReportIds.length,3);
 for(const id of recoveredReportIds)await page.locator(`[data-report-close="${id}"]`).click();
 assert.equal(await page.locator('.report-tab').count(),reportTabsBefore,'recovery scenario closes only its own tabs');
 console.log('PASS: Word-edited reports reopen; missing or damaged metadata requires preview and confirmation; original tab stays intact.');

 await page.locator('[data-tab="blocks"]').click();await page.locator('#new-block').click();
 await page.locator('#block-title').fill('Проверочный блок');await page.locator('#block-tags').fill('контроль нейро');
 await page.locator('#block-text').fill('Проверочное описание: [[Описание участка]].');await page.locator('#confirm-block').click();
 await page.locator('#block-search').fill('контроль нейро');assert.equal(await page.locator('.block-card').count(),1);
 const blockId=await page.locator('[data-insert-block]').getAttribute('data-insert-block');
 await page.locator('[data-preview-block]').click();assert.match(await page.locator('.block-preview').innerText(),/Проверочное описание/);
 await page.locator('#insert-preview-block').click();
 const insertedField=page.locator('[data-template-field][data-hint="Описание участка"]').first();await insertedField.waitFor();
 await fillField(await insertedField.getAttribute('data-field-id'),'Иследование. Очаг очаг не выявлен.');
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
 assert.match(await page.locator('.report-content strong').allTextContents().then(t=>t.join(' ')),/ЗАКЛЮЧЕНИЕ/);
 console.log('PASS: searchable previews and insertion, live spelling/grammar corrections and existing report formatting.');
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
 assert.match(await page.locator('.block-preview').innerText(),/Исследование/);
 await page.locator('.dialog footer [data-close]').click();
 await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Сохранено на компьютере');
 const firstTab=await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select');
 const firstTemplateTitle=await page.locator('#template-name').innerText();
 await assertTabState('A before creating B',firstTab,'Исследование. Очаг не выявлен.','Второе заключение');
 await page.locator('#zoom').evaluate(el=>{el.value='145';el.dispatchEvent(new Event('input',{bubbles:true}));});assert.equal(await page.locator('#zoom-value').innerText(),'145%');assert.equal(await page.locator('.paper').evaluate(el=>el.style.zoom),'1.45');
 await page.locator('#new-report').click();const unconfiguredTab=await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select');assert.notEqual(unconfiguredTab,firstTab);await page.locator('[data-tab="templates"]').click();await page.locator('#area-select').selectOption({label:'Позвоночник'});await page.locator('[data-template]').first().click();const secondTab=await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select');assert.notEqual(secondTab,unconfiguredTab,'choosing a template creates a report instead of reusing the unconfigured tab');assert.equal(await page.locator(`[data-report-select="${unconfiguredTab}"]`).count(),1,'template selection preserves the prior tab');await page.locator(`[data-report-close="${unconfiguredTab}"]`).click();const secondTemplateTitle=await page.locator('#template-name').innerText();assert.notEqual(secondTemplateTitle,firstTemplateTitle,'the two patient reports use different templates');const secondPatientId=await page.locator('[data-template-field]').evaluateAll(fields=>fields.map(element=>element.getAttribute('data-field-id')).find(id=>id?.endsWith('.patient')));assert.ok(secondPatientId,'the second template exposes its patient field');const secondPatientField=field(secondPatientId),secondPatient='Петров Алексей Васильевич',patientPrompt=await secondPatientField.innerText();await fillField(secondPatientId,secondPatient);
 const secondTabLabel=page.locator('.report-tab.active .report-tab-select');assert.ok((await secondTabLabel.innerText()).includes('Петров'),'report tabs retain the full patient surname');assert.equal(await secondTabLabel.getAttribute('title'),`Петров · ${secondTemplateTitle}`);assert.equal(await secondTabLabel.getAttribute('aria-label'),`Петров · ${secondTemplateTitle}`,'assistive technology receives the complete tab name');assert.equal(await page.locator('#report-tabs').evaluate(el=>getComputedStyle(el).overflowX),'auto','the tab strip scrolls horizontally when its natural-width tabs do not fit');assert.ok(await secondTabLabel.evaluate(el=>el.scrollWidth<=el.clientWidth),'the patient name is not clipped inside its natural-width tab');
 await page.keyboard.press('Control+z');assert.equal(await secondPatientField.innerText(),patientPrompt,'keyboard Undo works inside the active report');await page.keyboard.press('Control+y');assert.equal(await secondPatientField.innerText(),secondPatient,'keyboard Redo works inside the active report');
 await page.locator('[data-command="undo"]').click();assert.equal(await secondPatientField.innerText(),patientPrompt,'toolbar Undo works inside the active report');await page.locator('[data-command="redo"]').click();assert.equal(await secondPatientField.innerText(),secondPatient,'toolbar Redo works inside the active report');
 await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Сохранено на компьютере');await assertTabState('B created',secondTab,secondPatient,'Исследование. Очаг не выявлен.');
 const tabsBeforeAlternate=await page.locator('.report-tab').count();await page.locator('[data-tab="templates"]').click();const alternate=page.locator('.template-card:not(.selected)').first();await alternate.click();const thirdTab=await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select');assert.notEqual(thirdTab,secondTab);assert.notEqual(thirdTab,firstTab);await assertTabState('C selected',thirdTab,'Ф.И.О. пациента',secondPatient);assert.equal(await page.locator('.report-tab').count(),tabsBeforeAlternate+1,'choosing a template for a dirty report opens one new tab');await page.locator(`[data-report-select="${secondTab}"]`).click();assert.equal(await secondPatientField.innerText(),secondPatient);await assertTabState('C to B',secondTab,secondPatient,'Исследование. Очаг не выявлен.');await page.locator(`[data-report-select="${thirdTab}"]`).click();await assertTabState('B to C',thirdTab,'Ф.И.О. пациента',secondPatient);await page.locator(`[data-report-close="${thirdTab}"]`).click();assert.equal(await page.locator(`[data-report-select="${thirdTab}"]`).count(),0);await assertTabState('C closed',secondTab,secondPatient,'Исследование. Очаг не выявлен.');assert.equal(await page.locator('.report-tab').count(),tabsBeforeAlternate,'closing that report removes only its tab');
 await page.locator(`[data-report-select="${firstTab}"]`).click();assert.match(await page.locator('.report-content').innerText(),/Исследование\. Очаг не выявлен\./);
 await assertTabState('B to A',firstTab,'Исследование. Очаг не выявлен.','Второе заключение');
 await page.keyboard.press('Control+z');await page.keyboard.press('Control+y');await page.locator('[data-command="undo"]').click();await page.locator('[data-command="redo"]').click();await assertTabState('A ignores B Undo/Redo history',firstTab,'Исследование. Очаг не выявлен.','Петров Алексей Васильевич');
 await page.locator(`[data-report-select="${secondTab}"]`).click();assert.equal(await secondPatientField.innerText(),secondPatient);await assertTabState('A to B',secondTab,secondPatient,'Исследование. Очаг не выявлен.');
 const tabsBeforeClose=await page.locator('.report-tab').count();await page.locator(`[data-report-close="${secondTab}"]`).click();
 await page.locator('#close-unsaved-report').waitFor();assert.equal(await page.locator('.report-tab').count(),tabsBeforeClose,'dirty B stays open until confirmation');
 await assertTabState('B awaiting close confirmation',secondTab,secondPatient,'Исследование. Очаг не выявлен.');
 await page.locator('#close-unsaved-report').click();assert.equal(await page.locator(`[data-report-select="${secondTab}"]`).count(),0,'confirmed close removes B');assert.equal(await page.locator('.report-tab').count(),tabsBeforeClose-1);
 await assertTabState('B closed',firstTab,'Исследование. Очаг не выявлен.',secondPatient);
 const tabsBeforeReload=await page.locator('.report-tab').count();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Сохранено на компьютере');await page.reload();await page.locator('.report-content').waitFor();
 assert.equal(await page.locator('.report-tab').count(),tabsBeforeReload,'ordinary restart preserves all open tabs');
 await assertTabState('restart after closing B',firstTab,'Исследование. Очаг не выявлен.',secondPatient);
 assert.match(await page.locator('.report-content').innerText(),/Исследование\. Очаг не выявлен\./);
 const activeAfterReload=await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select'),savedBeforeRestartHistory=await page.locator('.report-content').innerText();await page.keyboard.press('Control+z');await page.keyboard.press('Control+y');assert.equal(await page.locator('.report-content').innerText(),savedBeforeRestartHistory,'Undo/Redo after reload restores the active report content');await page.locator('[data-command="undo"]').click();await page.locator('[data-command="redo"]').click();assert.equal(await page.locator('.report-content').innerText(),savedBeforeRestartHistory,'toolbar Undo/Redo after reload restores the active report content');assert.ok(await page.evaluate(({id,key})=>JSON.parse(localStorage.getItem(key)||'{}')[id]?.history.undo.length,{id:activeAfterReload,key:'mri-report-studio.undo-history.v1'}),'the active report operation history remains available after restart');
 await page.locator('#new-report').click();const unconfiguredRestartA=await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select');await page.locator('[data-tab="templates"]').click();await page.locator('#area-select').selectOption('abdomen');await page.locator('[data-template="abdomen-bp"]').click();const restartTabA=await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select');assert.notEqual(restartTabA,unconfiguredRestartA,'template selection creates a distinct restart report');await page.locator(`[data-report-close="${unconfiguredRestartA}"]`).click();const restartPatientA=await page.locator('[data-template-field]').evaluateAll(fields=>fields.map(element=>element.getAttribute('data-field-id')).find(id=>id?.endsWith('.patient')));assert.ok(restartPatientA,'the BП report exposes its own patient field');await fillField(restartPatientA,'Палкин Алексей Васильевич');
 await page.locator('#new-report').click();const unconfiguredRestartB=await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select');await page.locator('[data-tab="templates"]').click();await page.locator('#area-select').selectOption('joints');await page.locator('[data-template="joints-gs"]').click();const restartTabB=await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select');assert.notEqual(restartTabB,unconfiguredRestartB,'template selection creates a distinct ГС report');await page.locator(`[data-report-close="${unconfiguredRestartB}"]`).click();const restartPatientB=await page.locator('[data-template-field]').evaluateAll(fields=>fields.map(element=>element.getAttribute('data-field-id')).find(id=>id?.endsWith('.patient')));assert.ok(restartPatientB,'the ГС report exposes its own patient field');await fillField(restartPatientB,'Петров Алексей Васильевич');
 await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Сохранено на компьютере');await page.reload();await page.locator('.report-content').waitFor();assert.equal(await page.locator('.report-tab').count(),tabsBeforeReload+2,'both synthetic reports persist alongside the existing report');await assertTabState('page reload restores B (ГС / Петров)',restartTabB,'Петров Алексей Васильевич','Палкин Алексей Васильевич');await page.locator(`[data-report-select="${restartTabA}"]`).click();await assertTabState('page reload restores A (БП / Палкин)',restartTabA,'Палкин Алексей Васильевич','Петров Алексей Васильевич');await page.locator(`[data-report-select="${restartTabB}"]`).click();
 // A page reload does not destroy Electron's main process. Close the actual app and relaunch it against the same userData directory to test persisted workspace/history isolation.
 await application.close();application=await _electron.launch(electronOptions);page=await application.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.locator('.report-content').waitFor();
 assert.equal(await page.locator('.report-tab').count(),tabsBeforeReload+2,'closing and relaunching Electron restores both synthetic reports');
 await assertTabState('real Electron restart restores B (ГС / Петров)',restartTabB,'Петров Алексей Васильевич','Палкин Алексей Васильевич');
 await page.locator(`[data-report-select="${restartTabA}"]`).click();await assertTabState('real Electron restart restores A (БП / Палкин)',restartTabA,'Палкин Алексей Васильевич','Петров Алексей Васильевич');
 await page.locator(`[data-report-select="${restartTabB}"]`).click();
 for(let index=0;index<3;index++){
  await page.keyboard.press('Control+z');await assertUndoIsolated(`real restart keyboard Undo ${index+1}`,restartTabB,'Петров Алексей Васильевич','Палкин Алексей Васильевич',restartTabA,'Палкин Алексей Васильевич');
  await page.keyboard.press('Control+y');await assertTabState(`real restart keyboard Redo ${index+1}`,restartTabB,'Петров Алексей Васильевич','Палкин Алексей Васильевич');
  await page.locator('[data-command="undo"]').click();await assertUndoIsolated(`real restart toolbar Undo ${index+1}`,restartTabB,'Петров Алексей Васильевич','Палкин Алексей Васильевич',restartTabA,'Палкин Алексей Васильевич');
  await page.locator('[data-command="redo"]').click();await assertTabState(`real restart toolbar Redo ${index+1}`,restartTabB,'Петров Алексей Васильевич','Палкин Алексей Васильевич');
 }
 await page.locator(`[data-report-select="${restartTabA}"]`).click();await assertTabState('real restart A-to-B-to-A',restartTabA,'Палкин Алексей Васильевич','Петров Алексей Васильевич');
 await page.locator(`[data-report-select="${restartTabB}"]`).click();await assertTabState('real restart A-to-B-to-A-to-B',restartTabB,'Петров Алексей Васильевич','Палкин Алексей Васильевич');
 await application.close();application=await _electron.launch(electronOptions);page=await application.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.locator('.report-content').waitFor();
 await assertTabState('second real Electron restart B',restartTabB,'Петров Алексей Васильевич','Палкин Алексей Васильевич');
 await page.locator(`[data-report-select="${restartTabA}"]`).click();await assertTabState('second real Electron restart A',restartTabA,'Палкин Алексей Васильевич','Петров Алексей Васильевич');
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
   for(const id of fixture.validIds){const tab=page.locator(`[data-report-select="${id}"]`);if(await tab.count()!==1){const state=await page.evaluate(()=>({renderedIds:[...document.querySelectorAll('[data-report-select]')].map(el=>el.getAttribute('data-report-select')),storedIds:JSON.parse(localStorage.getItem('mri-report-studio.workspace.v1')||'{}').reports?.map(report=>report.id)??[],activeId:JSON.parse(localStorage.getItem('mri-report-studio.workspace.v1')||'{}').activeId}));assert.equal(await tab.count(),1,`${size} tabs: ${id} is retained; recovery IDs=${JSON.stringify(state)}`);}assert.equal((await tab.innerText()).startsWith('● '),fixture.dirtyIds.includes(id),`${size} tabs: dirty state for ${id} is restored`);}
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
 const detail=error instanceof Error?(error.stack??error.message):String(error);
 const failureDom=await page.evaluate(()=>({
  syntheticTest:true,
  title:document.title,
  documentName:document.querySelector('#document-name')?.textContent,
  selectedTemplate:document.querySelector('.template-card.selected strong')?.textContent,
  activeReportId:document.querySelector('.report-tab.active [data-report-select]')?.getAttribute('data-report-select'),
  tabs:[...document.querySelectorAll('.report-tab')].map(tab=>tab.innerText),
  reportText:document.querySelector('.report-content')?.innerText,
  reportHTML:document.querySelector('.report-content')?.outerHTML,
  templateFields:[...document.querySelectorAll('.report-content [data-template-field]')].map(field=>({id:field.getAttribute('data-field-id'),text:field.textContent,filled:field.getAttribute('data-filled')})),
 })).catch(captureError=>({syntheticTest:true,captureError:String(captureError)}));
 failureDom.rendererErrors=errors;
 await writeFile(path.join(output,'v3-failed-dom.json'),JSON.stringify(failureDom,null,2));
 await writeFile(path.join(output,'v3-failed-dom.html'),`<!doctype html><meta charset="utf-8"><title>Synthetic Electron failure</title>${failureDom.reportHTML??'<p>report DOM unavailable</p>'}`);
 const annotationData=JSON.stringify({detail,activeReportId:failureDom.activeReportId,tabs:failureDom.tabs,fields:failureDom.templateFields,reportText:failureDom.reportText?.slice(0,4000),rendererErrors:failureDom.rendererErrors});
 const annotation=annotationData.replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A').replaceAll(':','%3A').replaceAll(',','%2C');
 await page.screenshot({path:path.join(output,'v3-failed.png')});console.error('Renderer errors:',errors);console.error('Synthetic Electron failure DOM:',JSON.stringify({...failureDom,reportHTML:failureDom.reportHTML?.slice(0,12000)},null,2));console.error('Electron integration first failure:',detail);process.stdout.write(`::error title=Electron integration first failure::${annotation}\n`);
 if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`## Electron integration failure\n\n\`\`\`text\n${detail}\n\`\`\`\n`);
 throw error;
}finally{await application.close();}

const server=createServer(async(_request,response)=>{response.setHeader('Content-Type','text/html;charset=utf-8');response.end(await readFile(path.join(root,'dist/index.html')));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const chromiumOptions={headless:true};
if(process.env.CHROMIUM_PATH)chromiumOptions.executablePath=process.env.CHROMIUM_PATH;
else if(process.platform==='linux')chromiumOptions.executablePath='/usr/bin/chromium';
const browser=await chromium.launch(chromiumOptions);
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
