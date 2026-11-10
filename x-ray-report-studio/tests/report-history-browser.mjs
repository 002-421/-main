import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron } from 'playwright-core';

const root=process.cwd(),profile=await mkdtemp(path.join(os.tmpdir(),'xrs-history-'));
const historyKey='mri-report-studio.undo-history.v1';
const options={...(process.env.ELECTRON_PATH?{executablePath:process.env.ELECTRON_PATH}:{}),args:['.',`--user-data-dir=${profile}`,'--no-sandbox','--ozone-platform=headless','--disable-gpu'],cwd:root,env:{...process.env,XDG_CACHE_HOME:process.env.XDG_CACHE_HOME??'/tmp/xrs-cache',XDG_CONFIG_HOME:process.env.XDG_CONFIG_HOME??'/tmp/xrs-config'}};
let app,page;
const rendererErrorNames=[];
async function launch(){app=await _electron.launch(options);page=await app.firstWindow();page.on('pageerror',error=>rendererErrorNames.push(error.name||'RendererError'));await page.locator('.report-content').waitFor();return page;}
async function save(page){await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent?.includes('Сохранено'));}
async function placeCaretInParagraph(page,paragraphIndex,offset=14){
 const paragraph=page.locator('.report-content p').nth(paragraphIndex);
 await paragraph.waitFor();
 await paragraph.evaluate((el,start)=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),node=walker.nextNode();if(!node)throw new Error('Expected a synthetic template paragraph text node');const range=document.createRange();range.setStart(node,Math.min(start,node.textContent.length));range.collapse(true);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);},offset);
}
async function typeInParagraph(page,paragraphIndex,text){
 await placeCaretInParagraph(page,paragraphIndex);
 await page.keyboard.insertText(text);
}
async function currentParagraphIndex(page){return page.evaluate(()=>{const selection=getSelection();const paragraph=selection?.anchorNode instanceof Element?selection.anchorNode.closest('.report-content p'):selection?.anchorNode?.parentElement?.closest('.report-content p');return paragraph?[...document.querySelectorAll('.report-content p')].indexOf(paragraph):-1;});}
async function captureFailure(error){
 await mkdir(path.join(root,'test-output'),{recursive:true});
 const snapshot=await page?.evaluate(rendererErrors=>{
  const canvas=document.querySelector('#canvas'),selection=getSelection(),active=document.querySelector('.report-tab.active'),paragraph=selection?.anchorNode instanceof Element?selection.anchorNode.closest('.report-content p'):selection?.anchorNode?.parentElement?.closest('.report-content p');
  let caret=null;
  if(selection?.rangeCount&&paragraph){const range=selection.getRangeAt(0).cloneRange();range.selectNodeContents(paragraph);range.setEnd(selection.anchorNode,selection.anchorOffset);caret={paragraph:[...document.querySelectorAll('.report-content p')].indexOf(paragraph),offset:range.toString().length,collapsed:selection.isCollapsed};}
  return{reportCount:document.querySelectorAll('.report-tab').length,activeTabIndex:active?[...document.querySelectorAll('.report-tab')].indexOf(active):-1,paragraphCount:document.querySelectorAll('.report-content p').length,scrollTop:canvas?.scrollTop??null,scrollHeight:canvas?.scrollHeight??null,clientHeight:canvas?.clientHeight??null,caret,historyDepth:JSON.parse(localStorage.getItem('mri-alliance.settings.v3')||'{}').historyDepth??null,rendererErrors};
 },rendererErrorNames).catch(()=>null);
 await page?.screenshot({path:path.join(root,'test-output/report-history-failure.png'),fullPage:false}).catch(()=>{});
 await writeFile(path.join(root,'test-output/report-history-failure.json'),JSON.stringify({errorName:error?.name||'Error',errorCode:error?.code||null,snapshot},null,2));
}
try{
 page=await launch();
 const editor=page.locator('.report-content');
 assert.equal(await page.locator('.report-tab').count(),1,'one synthetic report opens');
 const patientField=page.locator('[data-field-id="head-gm.patient"]');
 await patientField.evaluate(el=>{el.closest('[contenteditable]')?.focus();const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection?.removeAllRanges();selection?.addRange(range);});
 await page.keyboard.insertText('СверхдлиннаяСинтетическаяФамилия Тест Пациент');
 await save(page);
 const paragraphCount=await editor.locator('p').count();
 assert.ok(paragraphCount>20,'the synthetic protocol spans multiple pages');
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
 for(const index of [1,12,paragraphCount-4]){
  const paragraph=page.locator('.report-content p').nth(index),original=await paragraph.innerText();
  await paragraph.evaluate((el,scrollOffset)=>{const canvas=document.querySelector('#canvas'),rect=el.getBoundingClientRect(),box=canvas.getBoundingClientRect();canvas.scrollTop+=rect.top-box.top-scrollOffset;},Math.floor((await page.locator('#canvas').evaluate(el=>el.clientHeight))/3));
  await typeInParagraph(page,index,`XRS06_POSITION_${index}`);
  const edited=await paragraph.innerText(),before=await page.locator('#canvas').evaluate(el=>el.scrollTop);
  await page.keyboard.press('Control+z');
  assert.equal(await paragraph.innerText(),original,`Undo restores text at report position ${index}`);
  assert.equal(await currentParagraphIndex(page),index,`Undo restores the cursor at report position ${index}`);
  const undoState=await page.evaluate(()=>{const canvas=document.querySelector('#canvas'),range=getSelection()?.rangeCount?getSelection().getRangeAt(0):null,caret=range?.getBoundingClientRect(),box=canvas.getBoundingClientRect();return{scrollTop:canvas.scrollTop,caretVisible:Boolean(caret&&caret.bottom>=box.top-1&&caret.top<=box.bottom+1)};});
  assert.ok(undoState.caretVisible,`Undo keeps the caret visible at report position ${index}`);
  assert.ok(Math.abs(undoState.scrollTop-before)<80,`Undo preserves the nearby viewport at report position ${index}: ${JSON.stringify({before,...undoState})}`);
  await page.keyboard.press('Control+y');
  assert.equal(await paragraph.innerText(),edited,`Redo restores text at report position ${index}`);
  assert.equal(await currentParagraphIndex(page),index,`Redo restores the cursor at report position ${index}`);
  const redoState=await page.locator('#canvas').evaluate(el=>el.scrollTop);
  assert.ok(Math.abs(redoState-undoState.scrollTop)<80,`Redo preserves the nearby viewport at report position ${index}`);
 }
 const selectionParagraph=page.locator('.report-content p').nth(12),selectionBefore=await selectionParagraph.innerText();
 const selectedText=await selectionParagraph.evaluate(el=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),node=walker.nextNode();if(!node)throw new Error('Synthetic paragraph has no text to select');const length=Math.min(8,node.textContent.length);const range=document.createRange();range.setStart(node,2);range.setEnd(node,Math.min(2+length,node.textContent.length));getSelection().removeAllRanges();getSelection().addRange(range);return range.toString();});
 await page.keyboard.insertText('XRS06_REPLACEMENT');
 await page.keyboard.press('Control+z');
 assert.equal(await selectionParagraph.innerText(),selectionBefore,'Undo restores text replaced through a selection');
 assert.equal(await page.evaluate(()=>getSelection()?.toString()),selectedText,'Undo restores the original selection range');
 await page.keyboard.press('Control+y');
 assert.ok((await selectionParagraph.innerText()).includes('XRS06_REPLACEMENT'),'Redo reapplies the selection replacement');
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

 await placeCaretInParagraph(page,12,18);
 const reportAView=await page.locator('#canvas').evaluate((canvas,target)=>{const paragraph=document.querySelectorAll('.report-content p')[target],rect=paragraph.getBoundingClientRect(),box=canvas.getBoundingClientRect();canvas.scrollTop+=rect.top-box.top-canvas.clientHeight/3;return canvas.scrollTop;},12);
 await page.waitForTimeout(550);
 const reportAParagraph=await currentParagraphIndex(page);
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
 await page.waitForFunction(({expectedScroll,expectedParagraph})=>{const canvas=document.querySelector('#canvas'),selection=getSelection(),paragraph=selection?.anchorNode instanceof Element?selection.anchorNode.closest('.report-content p'):selection?.anchorNode?.parentElement?.closest('.report-content p');return Math.abs(canvas.scrollTop-expectedScroll)<2&&paragraph&&[...document.querySelectorAll('.report-content p')].indexOf(paragraph)===expectedParagraph;},{expectedScroll:reportAView,expectedParagraph:reportAParagraph});
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
 await placeCaretInParagraph(page,12,18);
 await page.locator('#canvas').evaluate((canvas,target)=>{const paragraph=document.querySelectorAll('.report-content p')[target],rect=paragraph.getBoundingClientRect(),box=canvas.getBoundingClientRect();canvas.scrollTop+=rect.top-box.top-canvas.clientHeight/3;},12);
 await page.waitForTimeout(550);
 const viewBeforeRestart=await page.evaluate(()=>{const canvas=document.querySelector('#canvas'),selection=getSelection(),paragraph=selection?.anchorNode instanceof Element?selection.anchorNode.closest('.report-content p'):selection?.anchorNode?.parentElement?.closest('.report-content p');return{scrollTop:canvas.scrollTop,paragraph:paragraph?[...document.querySelectorAll('.report-content p')].indexOf(paragraph):-1};});
 stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),historyKey);
 assert.equal(stored[aId]?.view?.scrollTop,viewBeforeRestart.scrollTop,'the active report view is persisted with local history');
 assert.equal(stored[aId]?.view?.selection?.anchor,stored[aId]?.view?.selection?.head,'the saved cursor is collapsed at the expected report location');
 await app.close();
 page=await launch();
 assert.equal(await page.locator('.report-tab').count(),2,'both synthetic report tabs restore after a normal full restart');
 await page.waitForFunction(({expectedScroll,expectedParagraph})=>{const canvas=document.querySelector('#canvas'),selection=getSelection(),paragraph=selection?.anchorNode instanceof Element?selection.anchorNode.closest('.report-content p'):selection?.anchorNode?.parentElement?.closest('.report-content p');return Math.abs(canvas.scrollTop-expectedScroll)<2&&paragraph&&[...document.querySelectorAll('.report-content p')].indexOf(paragraph)===expectedParagraph;},{expectedScroll:viewBeforeRestart.scrollTop,expectedParagraph:viewBeforeRestart.paragraph});
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
 const tabWidths=await tabs.evaluateAll(elements=>elements.slice(0,12).map(button=>({scrollWidth:button.scrollWidth,clientWidth:button.clientWidth})));
 assert.ok(tabWidths.every(item=>item.scrollWidth<=item.clientWidth+1),`all tab names fit their naturally sized controls without clipping: ${JSON.stringify(tabWidths)}`);
 const samePatientLabels=await tabs.evaluateAll(elements=>elements.map(element=>element.innerText).filter(label=>label.includes('СверхдлиннаяСинтетическаяФамилия')));
 assert.equal(samePatientLabels.length,2,'both studies for the same synthetic patient remain identifiable');
 assert.ok(samePatientLabels.every(label=>label.split(' · ')[1]?.length===3),`same-patient tabs add the three-letter template code: ${JSON.stringify(samePatientLabels)}`);
 const tabMetrics=await page.locator('.report-tabs').evaluate(el=>({overflowX:getComputedStyle(el).overflowX,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,initialScrollLeft:el.scrollLeft}));
 assert.ok(['auto','scroll'].includes(tabMetrics.overflowX),`tab strip allows horizontal scrolling: ${JSON.stringify(tabMetrics)}`);
 assert.ok(tabMetrics.scrollWidth>tabMetrics.clientWidth,`12 naturally sized tabs exceed the available width and must scroll horizontally: ${JSON.stringify(tabMetrics)}`);
 await page.locator('.report-tabs').evaluate(el=>{el.scrollLeft=el.scrollWidth;});
 const scrolledTabs=await page.locator('.report-tabs').evaluate(el=>({scrollLeft:el.scrollLeft,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth}));
 assert.ok(scrolledTabs.scrollLeft>0,`the tab strip can be scrolled horizontally: ${JSON.stringify(scrolledTabs)}`);
 assert.ok(scrolledTabs.scrollLeft+scrolledTabs.clientWidth>=scrolledTabs.scrollWidth-1,'the last tabs can be reached by horizontal scrolling');
 console.log('PASS: synthetic beginning/middle/end edits, Undo/Redo selection/caret/scroll, per-tab isolation and view restore, restart persistence, corrupt-history recovery, four history depths, and horizontally scrollable 1/4/5/12 report tabs.');
}catch(error){
 await captureFailure(error);
 throw error;
}finally{await app?.close().catch(()=>{});await rm(profile,{recursive:true,force:true});}
