import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron } from 'playwright-core';

const root=process.cwd(),userData=await mkdtemp(path.join(os.tmpdir(),'xrs-undo-scroll-'));
const options={...(process.env.ELECTRON_PATH?{executablePath:process.env.ELECTRON_PATH}:{}),args:['.',`--user-data-dir=${userData}`,'--no-sandbox','--ozone-platform=headless','--disable-gpu'],cwd:root,env:{...process.env,XDG_CACHE_HOME:process.env.XDG_CACHE_HOME??'/tmp/xrs-cache',XDG_CONFIG_HOME:process.env.XDG_CONFIG_HOME??'/tmp/xrs-config'}};
let app,page;
const rendererErrorNames=[];
try{
 app=await _electron.launch(options);
 page=await app.firstWindow();
 page.on('pageerror',error=>rendererErrorNames.push(error.name||'RendererError'));
 await page.locator('.report-content').waitFor();
 const canvas=page.locator('#canvas'),editor=page.locator('.report-content');
 const metrics=()=>page.evaluate(()=>{const scroller=document.querySelector('#canvas'),selection=getSelection(),range=selection?.rangeCount?selection.getRangeAt(0).getBoundingClientRect():null,box=scroller.getBoundingClientRect();return{scrollTop:scroller.scrollTop,scrollHeight:scroller.scrollHeight,clientHeight:scroller.clientHeight,viewport:{top:box.top,bottom:box.bottom},caret:range?{top:range.top,bottom:range.bottom}:null};});
 const assertCaretVisible=async()=>{const state=await metrics();assert.ok(state.caret,'the restored selection has a measurable caret');assert.ok(state.caret.bottom>=state.viewport.top-2&&state.caret.top<=state.viewport.bottom+2,'the restored caret is in the editor viewport');return state;};
 const paragraphs=editor.locator('p');
 const count=await paragraphs.count();
 assert.ok(count>20,'the initial report contains several pages of content');
 assert.ok((await metrics()).scrollHeight>(await metrics()).clientHeight*2,'the editor is a long, scrollable report');
 const target=paragraphs.nth(count-4),original=await target.innerText();
 await target.scrollIntoViewIfNeeded();
 await target.click({position:{x:30,y:8}});
 await page.keyboard.insertText('Проверка XRS-03');
 assert.ok((await target.innerText()).includes('Проверка XRS-03'),'text insertion is recorded in the report');
 await canvas.evaluate(el=>{const selection=getSelection(),box=el.getBoundingClientRect();if(!selection?.focusNode)throw new Error('Expected the synthetic report caret before edge positioning');const range=document.createRange();range.setStart(selection.focusNode,selection.focusOffset);range.collapse(true);const caret=range.getBoundingClientRect();el.scrollTop=Math.max(0,el.scrollTop+caret.bottom-box.bottom+1);});
 let before=await assertCaretVisible();
 assert.ok(Math.abs(before.caret.bottom-before.viewport.bottom)<=2,`the synthetic caret is placed at the visible lower edge: ${JSON.stringify(before)}`);
 await page.keyboard.press('Control+z');
 assert.equal(await target.innerText(),original,'keyboard Undo restores the original text');
 let after=await assertCaretVisible();
 assert.ok(Math.abs(after.scrollTop-before.scrollTop)<=2,`keyboard Undo does not scroll when the restored caret is already visible: ${JSON.stringify({before,after})}`);
 before=after;
 await page.keyboard.press('Control+y');
 assert.ok((await target.innerText()).includes('Проверка XRS-03'),'keyboard Redo restores inserted text');
 after=await assertCaretVisible();
 assert.ok(Math.abs(after.scrollTop-before.scrollTop)<=2,`keyboard Redo does not scroll when the restored caret is already visible: ${JSON.stringify({before,after})}`);

 await page.locator('[data-command="undo"]').click();
 assert.equal(await target.innerText(),original,'toolbar Undo restores the text');
 before=await assertCaretVisible();
 await page.locator('[data-command="redo"]').click();
 assert.ok((await target.innerText()).includes('Проверка XRS-03'),'toolbar Redo restores inserted text');
 after=await assertCaretVisible();
 assert.ok(Math.abs(after.scrollTop-before.scrollTop)<=2,`toolbar Redo keeps the current viewport when the caret is visible: ${JSON.stringify({before,after})}`);

 await app.evaluate(({clipboard},text)=>clipboard.writeText(text),'Вставка XRS-03');
 await page.keyboard.press('Control+v');
 assert.ok((await target.innerText()).includes('Вставка XRS-03'),'native paste inserts text');
 before=await assertCaretVisible();
 await page.keyboard.press('Control+z');
 assert.ok(!(await target.innerText()).includes('Вставка XRS-03'),'Undo removes the pasted text');
 after=await assertCaretVisible();
 assert.ok(Math.abs(after.scrollTop-before.scrollTop)<=2,`Undo after paste preserves a visible caret position: ${JSON.stringify({before,after})}`);
 await page.keyboard.press('Control+y');
 assert.ok((await target.innerText()).includes('Вставка XRS-03'),'Redo restores pasted text');

 const beforeFormat=await target.innerText();
 await target.evaluate(el=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);const text=walker.nextNode();if(!text)throw new Error('target paragraph has no selectable text');const range=document.createRange();range.setStart(text,0);range.setEnd(text,Math.min(5,text.textContent?.length??0));const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});
 await page.locator('[data-command="bold"]').click();
 assert.ok(await target.locator('strong,b').count(),'formatting applies to the selected report text');
 const formattedScroll=(await metrics()).scrollTop;
 await page.keyboard.press('Control+z');
 assert.equal(await target.innerText(),beforeFormat,'Undo after formatting retains all report text');
 after=await assertCaretVisible();
 assert.ok(Math.abs(after.scrollTop-formattedScroll)<=2,`Undo after formatting does not jump away from the caret: ${JSON.stringify({formattedScroll,after})}`);
 await page.keyboard.press('Control+y');
 assert.ok(await target.locator('strong,b').count(),'Redo restores formatting');

 // When Undo restores a caret outside the current viewport, only the distance
 // needed to reveal that caret may be scrolled.
 await canvas.evaluate(el=>{el.scrollTop=0;});
 await page.keyboard.press('Control+z');
 after=await assertCaretVisible();
 assert.ok(after.scrollTop>0,'the viewport moves when the restored caret is outside it');
 assert.ok(Math.abs(after.caret.bottom-(after.viewport.bottom-12))<3,'the scroll is only the amount needed to reveal the caret');
 await page.keyboard.press('Control+y');
 await assertCaretVisible();

 // Switch tabs, make a new edit in the restored report, and verify that its
 // local history still behaves without carrying another tab's history.
 const firstId=await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select');
 await page.locator('#new-report').click();
 const secondId=await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select');
 assert.notEqual(secondId,firstId);
 await page.locator(`[data-report-select="${firstId}"]`).click();
 const currentParagraph=page.locator('.report-content p').nth(count-4);
 await currentParagraph.scrollIntoViewIfNeeded();
 await currentParagraph.click({position:{x:35,y:8}});
 await page.keyboard.insertText('После переключения');
 before=await assertCaretVisible();
 await page.keyboard.press('Control+z');
 assert.ok(!(await currentParagraph.innerText()).includes('После переключения'));
 after=await assertCaretVisible();
 assert.ok(Math.abs(after.scrollTop-before.scrollTop)<=2,'Undo after tab switching preserves the visible caret position');
 await page.keyboard.press('Control+y');
 assert.ok((await currentParagraph.innerText()).includes('После переключения'));

 await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='Сохранено на компьютере');
 console.log('PASS: Electron Undo/Redo preserves text and caret scroll after typing, paste, formatting and tab switching; out-of-view caret scrolling is minimal.');
}catch(error){
 const output=path.join(root,'test-output');
 await mkdir(output,{recursive:true});
 const snapshot=await page?.evaluate(rendererErrors=>{const canvas=document.querySelector('#canvas'),selection=getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):null,rect=range?.getBoundingClientRect(),viewport=canvas?.getBoundingClientRect();return{scrollTop:canvas?.scrollTop??null,scrollHeight:canvas?.scrollHeight??null,clientHeight:canvas?.clientHeight??null,caret:rect?{top:rect.top,bottom:rect.bottom}:null,viewport:viewport?{top:viewport.top,bottom:viewport.bottom}:null,activeTabIndex:[...document.querySelectorAll('.report-tab')].findIndex(tab=>tab.classList.contains('active')),reportCount:document.querySelectorAll('.report-tab').length,paragraphCount:document.querySelectorAll('.report-content p').length,rendererErrors};},rendererErrorNames).catch(()=>null);
 await page?.screenshot({path:path.join(output,'undo-scroll-failure.png'),fullPage:false}).catch(()=>{});
 await writeFile(path.join(output,'undo-scroll-failure.json'),JSON.stringify({errorName:error?.name||'Error',errorCode:error?.code||null,errorMessage:error?.message||String(error),snapshot},null,2));
 throw error;
}finally{
 if(app)await app.close();
 await rm(userData,{recursive:true,force:true});
}
