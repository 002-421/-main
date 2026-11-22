import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {unzipSync,strFromU8} from 'fflate';
import {makeTemplateDocument} from '../src/catalog.ts';
const server=createServer(async(_req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(await readFile('dist/index.html'));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`,a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',key='mri-report-studio.workspace.v1',calKey='xrs.preview-calibration.v1',formatKey='xrs.doctor-format.v1',settingsKey='mri-alliance.settings.v3';
const text=n=>n.text??(n.content??[]).map(text).join('');
const sentence='Синтетическое описание формы и размеров условной модели без клинических и персональных сведений. ';
const p=(s,size=11)=>({type:'paragraph',attrs:{fontFamily:'Arial',fontSizePt:size,lineHeight:1.05,spaceAfterPt:5},content:[{type:'text',text:s}]});
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW+0AAAAASUVORK5CYII=';
function fixture(count,size=11,special=''){
 const d=makeTemplateDocument('head-gm');d.attrs.fontSizePt=size;d.content=Array.from({length:count},(_,i)=>p(`${i+1}. ${sentence}`,size));
 if(special==='paragraph')d.content.push({type:'heading',attrs:{level:2,fontFamily:'Arial',fontSizePt:size},content:[{type:'text',text:'Синтетический заголовок',marks:[{type:'bold'}]}]},{...p('',size),content:[{type:'text',text:sentence.repeat(30),marks:[{type:'bold'}]},{type:'text',text:sentence.repeat(30),marks:[{type:'italic'}]},{type:'text',text:sentence.repeat(30)}]});
 if(special==='table')d.content.push({type:'table',content:Array.from({length:12},(_,i)=>({type:'tableRow',content:[{type:'tableCell',content:[p(`Строка ${i}. ${sentence}`,size)]}]}))});
 if(special==='image')d.content.push({type:'image',attrs:{src:png,width:1000,height:1200}});
 d.content.push(p('ЗАКЛЮЧЕНИЕ: '+(special==='conclusion'?sentence.repeat(60):'Синтетический результат.'),size),p('Врач: Синтетический А. Дата: 01.01.2000',size));return d;
}
let browser,page,stage='start';const errors=[],external=[];await mkdir('test-output',{recursive:true});
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 async function load(doc,optimize=false,size=11,referenceStyle){
  await page?.close();page=await browser.newPage({viewport:{width:1500,height:1000},acceptDownloads:true});page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(url)&&!r.url().startsWith('data:'))external.push(r.url());});page.on('dialog',d=>d.accept());
  await page.addInitScript(({doc,optimize,size,key,formatKey,a,b})=>{
   if(localStorage.getItem('calibration-fixture-seeded'))return;localStorage.setItem('calibration-fixture-seeded','1');
   localStorage.setItem(key,JSON.stringify({activeId:'synthetic-calibration',reports:[{id:'synthetic-calibration',templateId:'head-gm',doc,dirty:false}]}));
   localStorage.setItem('mri-alliance.settings.v3',JSON.stringify({doctor:'Синтетический А',doctors:['Синтетический А','Синтетический Б'],doctorStamps:{'Синтетический А':'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW+0AAAAASUVORK5CYII='},doctorStampSizes:{'Синтетический А':{width:100,height:40}},doctorStampHeights:{'Синтетический А':40}}));
   localStorage.setItem(formatKey,JSON.stringify({version:1,activeId:a,profiles:{[a]:{id:a,name:'Синтетический А',fontSize:size,optimize},[b]:{id:b,name:'Синтетический Б',fontSize:size,optimize}}}));
  },{doc,optimize,size,key,formatKey,a,b});
  await page.goto(url);await page.locator('#editor .report-content').waitFor();
  if(referenceStyle)await page.addStyleTag(referenceStyle);
  await page.locator('#settings').click();await page.locator('#settings-expand-all').click();await page.locator('#save-settings').click();await page.locator('#doctor-name').waitFor({state:'detached'});
 }
 const currentDoc=()=>page.evaluate(key=>{const w=JSON.parse(localStorage.getItem(key));return w.reports.find(r=>r.id===w.activeId).doc;},key);
 const controls=()=>page.locator('#preview-calibration-controls');
 const controlData=()=>controls().evaluate(el=>({...el.dataset}));
 const pages=()=>page.locator('.paginated-browser-preview .preview-page');
 async function open(){await page.locator('#preview-report').click();await pages().first().waitFor();await controls().locator('[data-calibration-enabled]').waitFor();}
 const close=()=>page.locator('.dialog [data-close]').last().click();
 async function validate(source){
  const actual=(await page.locator('.paginated-browser-preview .report-content').allTextContents()).join('');assert.equal(actual.replace(/\s/gu,''),text(source).replace(/\s/gu,''),'all authored text survives calibration');
  const geometry=await pages().evaluateAll(ps=>ps.map(p=>{const paper=p.querySelector('.export-preview-paper'),content=p.querySelector('.report-content');return{paper:paper.getBoundingClientRect().height,width:paper.getBoundingClientRect().width,css:paper.getAttribute('style'),footer:paper.querySelector('.preview-word-footer').getBoundingClientRect().top-paper.getBoundingClientRect().top,bottom:Math.max(...[...content.querySelectorAll('*')].map(e=>e.getBoundingClientRect().bottom))-paper.getBoundingClientRect().top};}));
  assert.ok(geometry.every(g=>g.bottom<g.footer),'content does not overlap footer');assert.deepEqual(await currentDoc(),source,'editor source remains unchanged');return geometry;
 }
 stage='defaults and one-line steps';await load(fixture(35));const source=await currentDoc();await open();await page.screenshot({path:'test-output/calibration-default.png',fullPage:true});const originalHTML=await page.locator('.paginated-browser-preview').innerHTML(),baseGeometry=await validate(source),basePages=await pages().count();let data=await controlData();
 assert.equal(await controls().locator('[data-calibration-enabled]').isChecked(),false);assert.equal(Number(data.offset),0);assert.equal(data.baseHeight,data.effectiveHeight);assert.ok(Number(data.baseLines)>0);assert.equal(await controls().locator('[data-calibration-plus]').isDisabled(),Number(data.baseLines)===Number(await controls().locator('[data-calibration-target]').getAttribute('max')));
 await controls().locator('[data-calibration-enabled]').check();await controls().locator('[data-calibration-minus]').click();let lower=await controlData();assert.ok(Math.abs(Number(data.baseHeight)-Number(lower.effectiveHeight)-Number(data.standardLine))<.03,'minus one subtracts one measured standard line');await validate(source);
 await controls().locator('[data-calibration-plus]').click();assert.ok(Math.abs(Number((await controlData()).effectiveHeight)-Number(data.baseHeight))<.03);assert.equal(await page.locator('.paginated-browser-preview').innerHTML(),originalHTML,'zero offset restores exact baseline');
 const target=controls().locator('[data-calibration-target]'),minimum=Number(await target.getAttribute('min'));await target.fill(String(minimum));await target.press('Tab');assert.equal(await controls().locator('[data-calibration-minus]').isDisabled(),true);await validate(source);
 await controls().locator('[data-calibration-enabled]').uncheck();assert.equal(await page.locator('.paginated-browser-preview').innerHTML(),originalHTML,'disabled calibration restores exact baseline');await controls().locator('[data-calibration-enabled]').check();await controls().locator('[data-calibration-reset]').click();assert.equal(Number((await controlData()).offset),0);
 await controls().locator('[data-calibration-target]').fill(String(Number(data.baseLines)-3));await target.press('Tab');await close();await page.locator('#settings').click();await page.locator('#settings-expand-all').click();await page.locator('#settings-preview-calibration [data-calibration-target]').waitFor();await page.locator('#saved-doctor-choice').selectOption('Синтетический Б');await page.waitForFunction(b=>document.querySelector('#settings-preview-calibration')?.dataset.doctorId===b,b);
 const sc=page.locator('#settings-preview-calibration');assert.equal(await sc.locator('[data-calibration-enabled]').isChecked(),false);await sc.locator('[data-calibration-enabled]').check();await sc.locator('[data-calibration-minus]').click();await page.locator('#save-settings').click();await open();assert.equal(Number((await controlData()).offset),-1);assert.equal((await controlData()).doctorId,b);await close();
 await page.locator('#settings').click();await page.locator('#settings-expand-all').click();await page.locator('#saved-doctor-choice').selectOption('Синтетический А');await page.waitForFunction(a=>document.querySelector('#settings-preview-calibration')?.dataset.doctorId===a,a);assert.equal(Number(await sc.getAttribute('data-offset')),-3);await page.locator('#save-settings').click();await page.reload();await page.locator('#editor .report-content').waitFor();await open();assert.equal((await controlData()).doctorId,a);assert.equal(Number((await controlData()).offset),-3);await close();
 console.log('PASS: default off/zero, +/- one measured line, reset, safe bounds, two UUIDs, switching and restart.');
 stage='unchanged actual exports';
 async function word(){await open();const waiting=page.waitForEvent('download');await page.locator('#preview-save-word').click();const file=await waiting;const zip=unzipSync(await readFile(await file.path()));return strFromU8(zip['word/document.xml']).replace(/rId[\w-]+/g,'rId').replace(/(?:wp:docPr|pic:cNvPr) id="\d+"/g,'docPr id="ID"');}
 async function pdfInput(){await page.evaluate(()=>{window.__printInput=null;window.print=()=>{window.__printInput=document.querySelector('.export-only-editor').innerHTML;};});await open();await page.locator('#preview-save-pdf').click();await page.waitForFunction(()=>window.__printInput!==null);return page.evaluate(()=>window.__printInput);}
 async function renderPDF(html,name){await page.evaluate(html=>{document.querySelector('#app').style.display='none';const box=document.createElement('div');box.id='calibration-pdf';box.className='export-only-editor';box.innerHTML=html;document.body.append(box);},html);const result=await page.pdf({path:'test-output/'+name+'.pdf',preferCSSPageSize:true,printBackground:true});await page.evaluate(()=>{document.querySelector('#calibration-pdf').remove();document.querySelector('#app').style.display='';});return result;}
 await open();await controls().locator('[data-calibration-enabled]').uncheck();await close();const wordBefore=await word(),pdfBefore=await pdfInput(),bytesBefore=await renderPDF(pdfBefore,'calibration-export-baseline');
 await open();await controls().locator('[data-calibration-enabled]').check();await controls().locator('[data-calibration-target]').fill(String(Number((await controlData()).baseLines)-12));await controls().locator('[data-calibration-target]').press('Tab');const geometry=await validate(source);assert.ok((await pages().count())>=basePages);for(const g of geometry){assert.equal(g.css,baseGeometry[0].css,'paper margins are unchanged');assert.ok(Math.abs(g.footer-baseGeometry[0].footer)<.1,'footer position is unchanged');}await close();
 stage='horizontal calibration';
 await open();
 const widthStart=await controlData(),sourceWidth=await page.locator('.paginated-browser-preview .report-content').first().evaluate(el=>el.getBoundingClientRect().width);
 for(let i=0;i<4;i++)await controls().locator('[data-width-minus]').click();
 const narrow=await controlData(),narrowWidth=await page.locator('.paginated-browser-preview .report-content').first().evaluate(el=>el.getBoundingClientRect().width);
 assert.equal(Number(narrow.widthOffsetMm),-2);assert.ok(narrowWidth<sourceWidth-7);
 assert.equal(narrow.effectiveHeight,widthStart.effectiveHeight);
 assert.equal(Number(await controls().locator('[data-width-offset]').inputValue()),-2);
 await validate(source);await close();await page.reload();await open();
 assert.equal(Number((await controlData()).widthOffsetMm),-2);
 await controls().locator('[data-width-plus]').click();assert.equal(Number((await controlData()).widthOffsetMm),-1.5);
 const widthField=controls().locator('[data-width-offset]');
 await widthField.fill('1.5');await widthField.press('Tab');
 assert.equal(Number((await controlData()).widthOffsetMm),1.5);
 assert.ok(Number((await controlData()).effectiveWidth)>sourceWidth+5);
 await close();
 const wordAfter=await word(),pdfAfter=await pdfInput(),bytesAfter=await renderPDF(pdfAfter,'calibration-export-adjusted');assert.equal(wordAfter,wordBefore,'actual exported DOCX layout XML does not change');assert.equal(pdfAfter,pdfBefore,'official PDF export receives exactly the same uncalibrated HTML');const count=b=>(b.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;assert.equal(count(bytesAfter),count(bytesBefore));assert.ok(count(bytesBefore)>=2);assert.deepEqual(await currentDoc(),source);
 await open();await controls().locator('[data-width-reset]').click();assert.equal(Number((await controlData()).widthOffsetMm),0);await close();
 console.log('PASS: actual DOCX XML and PDF export input unchanged; real PDFs retain identical page counts; paper geometry/footer/source preserved.');
 stage='physician stamp and font isolation';
 await page.locator('#settings').click();await page.locator('[data-settings-section=doctor] > summary').click();
 await page.locator('#saved-doctor-choice').selectOption('Синтетический А');
 await page.locator('#stamp-preview img').waitFor();
 assert.equal(await page.locator('#stamp-height').inputValue(),'40');
 await page.locator('#stamp-position-x').evaluate(input=>{input.value='20';input.dispatchEvent(new Event('input'));});
 await page.locator('#doctor-font-size').selectOption('13');
 await page.locator('#save-settings').click();
 await page.locator('#settings').click();await page.locator('[data-settings-section=doctor] > summary').click();
 await page.locator('#saved-doctor-choice').selectOption('Синтетический Б');
 assert.equal(await page.locator('#stamp-preview img').count(),0);
 assert.equal(await page.locator('#doctor-font-size').inputValue(),'11');
 await page.locator('#saved-doctor-choice').selectOption('Синтетический А');
 assert.equal(await page.locator('#stamp-position-x').inputValue(),'20');
 assert.equal(await page.locator('#doctor-font-size').inputValue(),'13');
 await page.locator('#save-settings').click();
 await page.reload();
 const stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),settingsKey);
 assert.equal(stored.doctorStampOwners[a],'Синтетический А');
 assert.equal(stored.doctorStamps['Синтетический А'],png);
 assert.equal(stored.doctorStampPositions['Синтетический А'].x,20);
 assert.ok(!stored.doctorStampOwners[b]);
 console.log('PASS: 0.4.78 physician image migrates by UUID without duplication or cross-profile settings.');
 stage='deletion identity';await page.locator('#settings').click();await page.locator('#settings-expand-all').click();await page.locator('#saved-doctor-choice').selectOption('Синтетический Б');await page.locator('#delete-saved-doctor').click();await page.locator('#save-settings').click();const recreated=await page.evaluate(k=>Object.values(JSON.parse(localStorage.getItem(k)).profiles).find(p=>p.name==='Синтетический Б').id,formatKey);assert.notEqual(recreated,b);const savedCal=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),calKey);assert.equal(savedCal.profiles[recreated],undefined,'recreated identity does not inherit old calibration');
 for(const size of [10,10.5,11,11.5,12,13,14]){stage='font '+size;await load(fixture(8,size),false,size);await open();const n=await controlData();assert.ok(Number(n.standardLine)>0);await controls().locator('[data-calibration-enabled]').check();await controls().locator('[data-calibration-minus]').click();assert.ok(Math.abs(Number((await controlData()).effectiveHeight)-(Number(n.baseHeight)-Number(n.standardLine)))<.03);await validate(await currentDoc());await close();}
 console.log('PASS: all seven font sizes and deleted/recreated physician isolation.');
 const matrix=[['one page',8,'',false],['two pages',30,'',false],['three pages',50,'',false],['four pages',70,'',false],['five pages',95,'',false],['long conclusion',20,'conclusion',true],['split paragraph',2,'paragraph',false],['table',20,'table',true],['large indivisible image',0,'image',false]];
 for(const [name,n,special,optimize] of matrix){stage=name;await load(fixture(n,11,special),optimize);const source=await currentDoc();await open();const original=await pages().count();if(!special)assert.equal(original,{'one page':1,'two pages':2,'three pages':3,'four pages':4,'five pages':5}[name]);const originalGeometry=await validate(source);await controls().locator('[data-calibration-enabled]').check();await controls().locator('[data-calibration-target]').fill(String(Number((await controlData()).baseLines)-15));await controls().locator('[data-calibration-target]').press('Tab');const after=await validate(source);assert.ok((await pages().count())>=original);for(const g of after)assert.equal(g.css,originalGeometry[0].css);if(special==='image')assert.match(await page.locator('#preview-calibration-warning').innerText(),/Поправка не применена/);console.log(`${name}: ${original} → ${await pages().count()} preview pages; optimizer ${optimize}; all text retained`);await close();}
 stage='positive calibration within the unchanged physical area';
 const synthetic=fixture(33,10);
 // The same Arial 10 pt input must be testable on systems with different fonts.
 const referenceStyle={content:'div[style*="line-height: normal"][style*="font-size: 10pt"][style*="left: -10000px"] { line-height:11.9pt!important; }'};
 await load(synthetic,false,11,referenceStyle);
 const beforeWord=await word(),beforePdf=await pdfInput(),beforeSource=await currentDoc();
 await open();
 const before=await controlData(),originalPreview=await validate(beforeSource);
 const initialLines=Number(before.baseLines);
 assert.ok(Math.abs(Number(before.standardLine)*.75-11.9)<.03,'the test sets the reference before it is measured');
 const plus=controls().locator('[data-calibration-plus]');
 const targetOffset=controls().locator('[data-calibration-target]');
 assert.equal(await plus.isEnabled(),true,'+1 is available at the baseline with a safe line correction');
 await controls().locator('[data-calibration-enabled]').check();
 await plus.click();
 assert.equal(Number(await targetOffset.inputValue()),initialLines+1);
 const after=await controlData();
 assert.equal(after.baseHeight,after.effectiveHeight);
 assert.ok(Number(after.lineScale)<1);
 const compactPreview=await validate(beforeSource);
 assert.ok(compactPreview.every(p=>p.css===originalPreview[0].css&&Math.abs(p.paper-originalPreview[0].paper)<.1&&Math.abs(p.footer-originalPreview[0].footer)<.1));
 await page.locator('.paginated-browser-preview').evaluate(el=>{
  for(const p of el.querySelectorAll('p[data-word-line-minimum-pt]')){
   if(parseFloat(getComputedStyle(p).lineHeight)*.75+.01<Number(p.dataset.wordLineMinimumPt))throw new Error('Line is below the declared Word minimum');
  }
 });
 const maximum=Number(await targetOffset.getAttribute('max'));
 await targetOffset.fill(String(maximum));await targetOffset.press('Tab');
 assert.equal(await plus.isDisabled(),true,'the typographic limit disables further increases');
 await validate(beforeSource);
 await close();await page.reload();
 await page.addStyleTag(referenceStyle);
 await open();
 assert.equal(Number((await controlData()).offset),maximum-initialLines,'positive calibration persists after a restart');
 await close();
 assert.equal(await word(),beforeWord,'positive calibration leaves Word XML unchanged');
 assert.equal(await pdfInput(),beforePdf,'positive calibration leaves PDF input unchanged');
 console.log(`PASS: ${initialLines} → ${initialLines+1}, physical height/footer, width, Word/PDF and restart.`);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS: 1–5 pages, long conclusion/paragraph/table/stamp/footer, safe failure, optimization on/off and local-only calibration.');
}catch(error){await writeFile('test-output/calibration-failure.json',JSON.stringify({stage,error:error.stack},null,2));await page?.screenshot({path:'test-output/calibration-failure.png',fullPage:true}).catch(()=>{});console.error('Calibration stage:',stage);throw error;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
