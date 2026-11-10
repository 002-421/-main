import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron } from 'playwright-core';

const root=process.cwd(),profile=await mkdtemp(path.join(os.tmpdir(),'xrs-history-'));
const historyKey='mri-report-studio.undo-history.v1';
const options={...(process.env.ELECTRON_PATH?{executablePath:process.env.ELECTRON_PATH}:{}),args:['.',`--user-data-dir=${profile}`,'--no-sandbox','--ozone-platform=headless','--disable-gpu'],cwd:root,env:{...process.env,XDG_CACHE_HOME:process.env.XDG_CACHE_HOME??'/tmp/xrs-cache',XDG_CONFIG_HOME:process.env.XDG_CONFIG_HOME??'/tmp/xrs-config'}};
let app;
async function launch(){app=await _electron.launch(options);const page=await app.firstWindow();await page.locator('.report-content').waitFor();return page;}
async function save(page){await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent?.includes('Сохранено'));}
async function typeInParagraph(page,paragraphIndex,text){
 const paragraph=page.locator('.report-content p').nth(paragraphIndex);
 await paragraph.waitFor();
 await paragraph.evaluate(el=>{const node=el.firstChild;if(!node||node.nodeType!==Node.TEXT_NODE)throw new Error('Expected a synthetic template paragraph text node');const range=document.createRange();range.setStart(node,Math.min(14,node.textContent.length));range.collapse(true);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});
 await page.keyboard.insertText(text);
}
async function currentParagraphIndex(page){return page.evaluate(()=>{const selection=getSelection();const paragraph=selection?.anchorNode instanceof Element?selection.anchorNode.closest('.report-content p'):selection?.anchorNode?.parentElement?.closest('.report-content p');return paragraph?[...document.querySelectorAll('.report-content p')].indexOf(paragraph):-1;});}
try{
 let page=await launch();
 const editor=page.locator('.report-content');
 assert.equal(await page.locator('.report-tab').count(),1,'one synthetic report opens');
 const patientField=page.locator('[data-field-id="head-gm.patient"]');
 await patientField.evaluate(el=>{el.closest('[contenteditable]')?.focus();const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection?.removeAllRanges();selection?.addRange(range);});
 await page.keyboard.insertText('СверхдлиннаяСинтетическаяФамилия Тест Пациент');
 await save(page);
 const targetParagraph=page.locator('.report-content p').nth(12);
 const beforeText=await targetParagraph.innerText();
 await targetParagraph.evaluate(paragraph=>{const canvas=document.querySelector('#canvas');if(canvas){const rect=paragraph.getBoundingClientRect(),container=canvas.getBoundingClientRect();canvas.scrollTop+=rect.top-container.top-120;}});
 await typeInParagraph(page,12,'XRS06_SYNTHETIC_A');
 const scrollBeforeUndo=await page.locator('#canvas').evaluate(element=>element.scrollTop);
 await page.keyboard.press('Control+z');
 assert.equal(await targetParagraph.innerText(),beforeText,'Undo removes the inserted synthetic text');
 assert.equal(await currentParagraphIndex(page),12,'Undo restores the caret in the edited paragraph rather than at the document end');
 const afterUndo=await page.evaluate(()=>{const canvas=document.querySelector('#canvas'),selection=getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):null,caret=range?.getBoundingClientRect(),viewport=canvas?.getBoundingClientRect();return{scrollTop:canvas?.scrollTop,caretVisible:Boolean(caret&&viewport&&caret.top>=viewport.top-1&&caret.bottom<=viewport.bottom+1)};});
 assert.ok(Math.abs(afterUndo.scrollTop-scrollBeforeUndo)<80,`Undo keeps the viewport near the edit: ${JSON.stringify({scrollBeforeUndo,...afterUndo})}`);
 assert.ok(afterUndo.caretVisible,'Undo leaves the restored caret visible');
 const scrollBeforeRedo=await page.locator('#canvas').evaluate(element=>element.scrollTop);
 await page.keyboard.press('Control+y');
 assert.ok((await targetParagraph.innerText()).includes('XRS06_SYNTHETIC_A'),'Redo restores the inserted text');
 const afterRedo=await page.locator('#canvas').evaluate(element=>element.scrollTop);
 assert.ok(Math.abs(afterRedo-scrollBeforeRedo)<80,`Redo keeps the viewport near the edit: ${scrollBeforeRedo} -> ${afterRedo}`);
 await save(page);
 let aId=await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select');
 let stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),historyKey);
 assert.ok(stored[aId]?.history.undo.length,'the per-report operation history is persisted locally');

 const depthValues=[];
 for(const depth of ['100','250','500','1000']){
  await page.locator('#settings').click();
  const selector=page.locator('#history-depth');
  await selector.waitFor();
  assert.deepEqual(await selector.locator('option').evaluateAll(options=>options.map(option=>option.value)),['100','250','500','1000']);
  await selector.selectOption(depth);
  await page.locator('#save-settings').click();
  await page.waitForFunction(value=>JSON.parse(localStorage.getItem('mri-alliance.settings.v3')).historyDepth===Number(value),depth);
  depthValues.push(depth);
 }
 assert.deepEqual(depthValues,['100','250','500','1000'],'each doctor setting can be selected and saved');

 await page.locator('#new-report').click();
 await page.locator('.report-tab').nth(1).waitFor();
 const bId=await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select');
 const templateIds=await page.locator('[data-template]').evaluateAll(elements=>elements.map(element=>element.getAttribute('data-template')));
 const activeTemplate=await page.locator('[data-template].selected').getAttribute('data-template');
 const alternateTemplate=templateIds.find(id=>id!==activeTemplate);
 assert.ok(alternateTemplate,'the selected zone offers a second synthetic test template');
 await page.locator(`[data-template="${alternateTemplate}"]`).click();
 const patientB=page.locator('[data-field-id$=".patient"]').first();
 await patientB.evaluate(el=>{el.closest('[contenteditable]')?.focus();const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection?.removeAllRanges();selection?.addRange(range);});
 await page.keyboard.insertText('СверхдлиннаяСинтетическаяФамилия Тест Пациент');
 await typeInParagraph(page,12,'XRS06_SYNTHETIC_B');
 await save(page);
 await page.locator(`[data-report-select="${aId}"]`).click();
 assert.ok((await editor.innerText()).includes('XRS06_SYNTHETIC_A'),'switching restores report A content before its history action');
 assert.equal(await page.locator('[data-command="redo"]').isEnabled(),false,'fresh report A has no redo action');
 await page.keyboard.press('Control+z');
 assert.ok(!(await editor.innerText()).includes('XRS06_SYNTHETIC_A'),'Undo after switching back uses report A history');
 assert.ok(!(await editor.innerText()).includes('XRS06_SYNTHETIC_B'),'report B text never enters report A');
 await save(page);
 stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),historyKey);
 const historyDebug={undo:stored[aId]?.history.undo.length,redo:stored[aId]?.history.redo.length,redoEnabled:await page.locator('[data-command="redo"]').isEnabled(),activeId:await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select')};
 assert.equal(historyDebug.redoEnabled,true,`Undo on report A enables its redo action: ${JSON.stringify(historyDebug)}`);
 assert.equal(historyDebug.redo,1,`Undo on report A places its operation on A redo stack: ${JSON.stringify(historyDebug)}`);
 await page.keyboard.press('Control+y');
 assert.ok((await editor.innerText()).includes('XRS06_SYNTHETIC_A'),'Redo remains report-local after switching');
 await save(page);
 await app.close();
 page=await launch();
 assert.equal(await page.locator('.report-tab').count(),2,'both synthetic report tabs restore after a normal full restart');
 stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),historyKey);
 assert.ok(stored[aId]?.history.undo.length&&stored[bId]?.history.undo.length,'each report keeps its own serialized history across restart');
 await page.keyboard.press('Control+z');
 assert.ok(!(await page.locator('.report-content').innerText()).includes('XRS06_SYNTHETIC_A'),'Undo after restart acts on report A');
 await page.keyboard.press('Control+y');
 assert.ok((await page.locator('.report-content').innerText()).includes('XRS06_SYNTHETIC_A'),'Redo after restart restores report A');
 await page.locator(`[data-report-select="${bId}"]`).click();
 await page.keyboard.press('Control+z');
 assert.ok(!(await page.locator('.report-content').innerText()).includes('XRS06_SYNTHETIC_B'),'Undo after restart acts independently on report B');
 await page.keyboard.press('Control+y');
 assert.ok((await page.locator('.report-content').innerText()).includes('XRS06_SYNTHETIC_B'),'Redo after restart restores report B');
 await page.locator(`[data-report-select="${aId}"]`).click();
 await save(page);
 await page.evaluate(()=>{
  const original=Storage.prototype.setItem;
  Storage.prototype.setItem=function(key,value){return original.call(this,key,key==='mri-report-studio.undo-history.v1'?'corrupt synthetic history':value);};
 });
 await app.close();

 page=await launch();
 assert.equal(await page.locator('.report-tab').count(),2,'both report documents survive a restart with corrupt history');
 assert.ok((await page.locator('.report-content').innerText()).includes('XRS06_SYNTHETIC_A'),'report text survives history corruption');
 const recoveredHistory=await page.evaluate(key=>{try{return JSON.parse(localStorage.getItem(key)||'{}');}catch{return {}; }},historyKey);
 assert.deepEqual(recoveredHistory,{},'corrupt operation history is ignored independently from document content');
 await page.locator(`[data-report-select="${bId}"]`).click();
 assert.ok((await page.locator('.report-content').innerText()).includes('XRS06_SYNTHETIC_B'),'other document text survives the same restart');
 await page.locator(`[data-report-select="${aId}"]`).click();
 const formatParagraph=page.locator('.report-content p').filter({hasText:'XRS06_SYNTHETIC_A'}).first();
 await formatParagraph.evaluate(el=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())){const start=node.textContent.indexOf('XRS06_SYNTHETIC_A');if(start>=0){const range=document.createRange();range.setStart(node,start);range.setEnd(node,start+'XRS06_SYNTHETIC_A'.length);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);return;}}throw new Error('Synthetic text was not found for the format Undo test');});
 await page.locator('[data-command="bold"]').click();
 assert.ok(await formatParagraph.locator('strong', {hasText:'XRS06_SYNTHETIC_A'}).count(),'formatting creates an undoable document operation');
 await page.keyboard.press('Control+z');
 assert.equal(await formatParagraph.locator('strong', {hasText:'XRS06_SYNTHETIC_A'}).count(),0,'Undo reverts formatting while preserving inserted text');
 await page.keyboard.press('Control+y');
 assert.ok(await formatParagraph.locator('strong', {hasText:'XRS06_SYNTHETIC_A'}).count(),'Redo reapplies formatting without losing text');

 const counts=[];
 for(const expected of [4,5,12]){
  while(await page.locator('.report-tab').count()<expected)await page.locator('#new-report').click();
  counts.push(await page.locator('.report-tab').count());
 }
 assert.deepEqual(counts,[4,5,12],'1/4/5/12-tab workspace sizes are supported');
 const tabs=page.locator('.report-tab-select');
 assert.ok((await tabs.first().getAttribute('title'))?.includes('СверхдлиннаяСинтетическаяФамилия'),'tab tooltip retains the full synthetic patient surname and protocol title');
 assert.ok((await tabs.first().innerText()).includes('СверхдлиннаяСинтетическаяФамилия'),'tab displays the full surname instead of shortening it');
 const samePatientLabels=await tabs.evaluateAll(elements=>elements.map(element=>element.innerText).filter(label=>label.includes('СверхдлиннаяСинтетическаяФамилия')));
 assert.equal(samePatientLabels.length,2,'both studies for the same synthetic patient remain identifiable');
 assert.ok(samePatientLabels.every(label=>label.split(' · ')[1]?.length===3),`same-patient tabs add the three-letter template code: ${JSON.stringify(samePatientLabels)}`);
 const first=await tabs.first().evaluate(el=>({text:el.textContent,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth}));
 assert.ok(first.scrollWidth<=first.clientWidth+1,'tab label is not clipped; navigation scrolls horizontally instead');
 console.log('PASS: synthetic long-report Undo/Redo caret, per-tab isolation, restart persistence, corrupt-history recovery, and 1/4/5/12 report tabs.');
}finally{await app?.close().catch(()=>{});await rm(profile,{recursive:true,force:true});}
