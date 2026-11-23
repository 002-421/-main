import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {_electron} from 'playwright-core';
import {resetInlineTemplate,prepareInlineDocument} from '../src/inline-fields.ts';
const root=process.cwd(), profile=await mkdtemp(path.join(os.tmpdir(),'xrs-highlight-083-'));
const bundled=path.join(root,'node_modules','electron','dist',process.platform==='win32'?'electron.exe':'electron');
const options={executablePath:process.env.ELECTRON_PATH||(existsSync(bundled)?bundled:undefined),cwd:root,args:['.',`--user-data-dir=${profile}`,'--no-sandbox','--ozone-platform=headless','--disable-gpu']};
const ids=['spine-shop','spine-shop-m','spine-shop-art','spine-gop','spine-gop-m','spine-pop','spine-pop-m','spine-kkop'];
const synthetic=resetInlineTemplate({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Синтетический размер 0,0 см, 0,00 см и 0,0 см.',marks:[{type:'highlight',attrs:{color:'#ffff00'}}]}]}]}).content[0];
let app=await _electron.launch(options),page;
const reports=[],errors=[];
const snapshot=()=>page.evaluate(()=>JSON.parse(JSON.stringify(document.querySelector('.report-content').editor.getJSON())));
const state=()=>page.evaluate(()=>{
 const editor=document.querySelector('.report-content').editor;const sizes=[],paragraphs=[];
 editor.state.doc.descendants((n,p)=>{
  if(n.isTextblock&&n.attrs.editableHighlight)paragraphs.push({pos:p,text:n.textContent,...n.attrs.editableHighlight});
  const m=n.marks.find(m=>m.type.name==='templateSize');if(m)sizes.push({pos:p,text:n.text,...m.attrs});
 });return {sizes,paragraphs};
});
const cursor=pos=>page.evaluate(pos=>{const e=document.querySelector('.report-content').editor;e.chain().focus().setTextSelection(pos).run();},pos);
try{
 page=await app.firstWindow();await page.locator('.report-content').waitFor();
 page.on('pageerror',e=>{errors.push(e.message);console.error('RENDERER',e.stack);});
 await page.locator('[data-tab="templates"]').click();await page.locator('#area-select').selectOption('spine');
 for(const id of ids){
  await page.locator(`[data-template="${id}"]`).click();
  await page.locator(`[data-field-id="${id}.patient"]`).waitFor();
  assert.deepEqual(await page.locator('.report-content [data-template-field]').evaluateAll(nodes=>nodes.map(n=>n.dataset.fieldId)),[`${id}.number`,`${id}.patient`,`${id}.birthdate`,'HEAD.BASE.2.FIELD.0043',`${id}.reportdate`]);
  const initial=await state();assert.ok(initial.paragraphs.length>0,`${id}: structural editable paragraphs`);
  const first=initial.paragraphs.find(p=>p.text.trim());
  const before=await snapshot();await cursor(first.pos+2);
  assert.deepEqual(await snapshot(),before,`${id}: cursor does not complete paragraph`);
  await page.keyboard.insertText('Синтетический ');
  let current=await state();assert.equal(current.paragraphs.find(p=>p.id===first.id).edited,true,`${id}: ordinary text clears paragraph fill`);
  assert.equal(current.sizes.filter(s=>!s.filled).length,initial.sizes.length,`${id}: ordinary text preserves measurements`);
  assert.equal(current.paragraphs.filter(p=>!p.edited).length,initial.paragraphs.length-1,`${id}: neighboring paragraphs untouched`);
  // Real template measurements where present, plus the same structural three-size
  // fixture in every template (KКОП need not contain three actual measurements).
  if(current.sizes.length){
   const size=current.sizes[0];await cursor(size.pos+1);await page.keyboard.insertText('7');
   current=await state();assert.equal(current.sizes.find(s=>s.id===size.id).text,'7');
   assert.equal(current.sizes.find(s=>s.id===size.id).filled,true);
  }
  await page.evaluate(paragraph=>{const e=document.querySelector('.report-content').editor;e.commands.insertContentAt(e.state.doc.content.size,paragraph);},synthetic);
  current=await state();const triple=current.sizes.filter(s=>s.id.startsWith(synthetic.attrs.editableHighlight.id));
  assert.equal(triple.length,3);
  const middle=triple[1],pre=await snapshot();await cursor(middle.pos+1);
  await page.keyboard.insertText('0,50');
  current=await state();const afterTriple=current.sizes.filter(s=>s.id.startsWith(synthetic.attrs.editableHighlight.id));
  assert.deepEqual(afterTriple.map(s=>[s.text,s.filled]),[['0,0',false],['0,50',true],['0,0',false]],`${id}: middle size independent`);
  const after=await snapshot();await page.keyboard.press('Control+z');
  assert.deepEqual(await snapshot(),pre,`${id}: Undo restores text AND system state`);
  await page.keyboard.press('Control+y');assert.deepEqual(await snapshot(),after,`${id}: Redo restores state`);
  // Paste into the next pending measurement goes through the real editor handler.
  current=await state();const last=current.sizes.filter(s=>s.id.startsWith(synthetic.attrs.editableHighlight.id))[2];
  await cursor(last.pos+1);
  await app.evaluate(({clipboard})=>clipboard.writeText('9,25'));
  await page.keyboard.press('Control+v');
  current=await state();assert.equal(current.sizes.find(s=>s.id===last.id).text,'9,25');
  assert.equal(current.sizes.find(s=>s.id===last.id).filled,true);
  // Manual fill changes formatting only; removing it cannot mark a size filled.
  const remaining=current.sizes.filter(s=>s.id.startsWith(synthetic.attrs.editableHighlight.id))[0];
  await page.evaluate(({pos,text})=>{const e=document.querySelector('.report-content').editor;e.chain().focus().setTextSelection({from:pos,to:pos+text.length}).run();},remaining);
  const pendingBefore=JSON.stringify((await state()).sizes);
  await page.locator('#fill-text').click();assert.equal(await page.locator('#fill-text').getAttribute('data-fill-state'),'current');
  await page.locator('#fill-text').click();assert.equal(await page.locator('#fill-text').getAttribute('data-fill-state'),'none');
  assert.equal(JSON.stringify((await state()).sizes),pendingBefore,`${id}: manual toggle independent from measurements`);
  await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='Сохранено на компьютере');
  const reportId=await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select');
  reports.push({reportId,doc:await snapshot()});console.log(`PASS ${id}: text, sizes, middle replacement, paste, manual toggle, Undo/Redo, persistence`);
 }
 assert.deepEqual(errors,[]);
 await app.close();app=await _electron.launch(options);page=await app.firstWindow();await page.locator('.report-content').waitFor();
 for(const {reportId,doc}of reports){await page.locator(`[data-report-select="${reportId}"]`).click();assert.deepEqual(prepareInlineDocument(await snapshot()),prepareInlineDocument(doc),`${reportId}: Electron restart retains independent states`);}
 console.log('PASS: all eight Spine v8 reports, retained 40 field IDs and independent state after Electron restart.');
}catch(error){
 await mkdir('test-output/editable-highlights',{recursive:true});
 await writeFile('test-output/editable-highlights/failure.json',JSON.stringify({error:String(error),rendererErrors:errors},null,2));
 if(page)await page.screenshot({path:'test-output/editable-highlights/failure.png'}).catch(()=>{});
 throw error;
}finally{await app.close().catch(()=>{});await rm(profile,{recursive:true,force:true});}
