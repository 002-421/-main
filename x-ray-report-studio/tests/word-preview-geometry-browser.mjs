import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {unzipSync,strFromU8} from 'fflate';
import {makeTemplateDocument} from '../src/catalog.ts';
const server=createServer(async(_req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(await readFile('dist/index.html'));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`,output='test-output',calKey='xrs.preview-calibration.v1',uuid='11111111-1111-4111-8111-111111111111';
await mkdir(output,{recursive:true});let browser,page,stage='start',details={};const errors=[],external=[];
const close=()=>page.locator('.word-preview-dialog [data-close]').last().click();
const open=async()=>{await page.locator('#preview-report').click();await page.locator('.word-reference-preview').first().waitFor();};
const sentence='Синтетический текст для проверки геометрии и переносов строк без персональных и медицинских данных. ';
const plain=node=>node.text??(node.content??[]).map(plain).join('');
const p=(text,attrs={})=>({type:'paragraph',attrs:{fontFamily:'Arial',fontSizePt:11,lineHeight:1.05,spaceAfterPt:5,...attrs},content:[{type:'text',text}]});
const millimetres=(tag,key)=>Number(tag.match(new RegExp(`w:${key}="(-?\\d+)"`))?.[1]??0)*25.4/1440;
const near=(a,b,message)=>assert.ok(Math.abs(a-b)<.12,`${message}: ${a} mm vs ${b} mm`);
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 async function load(doc){
  await page?.close();page=await browser.newPage({viewport:{width:1500,height:1000},acceptDownloads:true});page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(url)&&!r.url().startsWith('data:'))external.push(r.url());});
  await page.addInitScript(({doc,uuid,calKey})=>{
   if(localStorage.getItem('geometry-seeded'))return;localStorage.setItem('geometry-seeded','1');
   localStorage.setItem('mri-report-studio.workspace.v1',JSON.stringify({activeId:'geometry',reports:[{id:'geometry',templateId:'head-gm',doc,dirty:false}]}));
   localStorage.setItem('xrs.doctor-format.v1',JSON.stringify({version:1,activeId:uuid,profiles:{[uuid]:{id:uuid,name:'',fontSize:11,optimize:false}}}));
   localStorage.setItem(calKey,JSON.stringify({version:1,profiles:{[uuid]:{version:1,enabled:false,offset:-2,lastTarget:50}}}));
  },{doc,uuid,calKey});await page.goto(url);await page.locator('#editor .report-content').waitFor();
 }
 const doc=makeTemplateDocument('head-gm');doc.attrs={...doc.attrs,marginLeftMm:23.3,marginRightMm:19.1};doc.content=[
  p('Plain '+sentence.repeat(3)),p('Left '+sentence.repeat(3),{leftIndentPt:28.35,rightIndentPt:14.2}),p('First '+sentence.repeat(3),{firstLineIndentPt:28.35}),
  p('Mixed '+sentence,{fontSizePt:14,lineHeight:1.3,spaceBeforePt:12,spaceAfterPt:12}),
  {type:'paragraph',content:[{type:'text',text:'Inherited '+sentence.repeat(2)}]},{type:'paragraph',attrs:{fontFamily:'Arial',fontSizePt:11,lineHeight:1.05,spaceAfterPt:5},content:[{type:'text',text:'ЗАКЛЮЧЕНИЕ: '+sentence.repeat(4),marks:[{type:'bold'}]},{type:'text',text:' Рекомендация: синтетический контроль.'}]},p('Врач: Синтетический. Дата: 01.01.2000')];
 stage='actual DOCX vs screen geometry in mm';await load(doc);const savedCalibration=await page.evaluate(k=>localStorage.getItem(k),calKey);await open();
 const geometry=await page.locator('.word-reference-preview').first().evaluate(paper=>{
  const px=25.4/96,body=paper.querySelector('.report-content'),s=getComputedStyle(paper),b=body.getBoundingClientRect(),r=paper.getBoundingClientRect();
  return {width:r.width*px,left:(b.left-r.left)*px,right:(r.right-b.right)*px,body:b.width*px,
   paragraphs:[...body.querySelectorAll('p')].map(p=>{const style=getComputedStyle(p),rect=p.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(p);const first=[...range.getClientRects()].find(r=>r.width>0);return{text:p.textContent,left:parseFloat(style.marginLeft)*px,right:parseFloat(style.marginRight)*px,first:parseFloat(style.textIndent)*px,width:rect.width*px,firstText:first?(first.left-rect.left)*px:0,font:style.fontSize,minimum:Number(p.dataset.wordLineMinimumPt),line:parseFloat(style.lineHeight)*72/96,before:parseFloat(style.marginTop)*72/96,after:parseFloat(style.marginBottom)*72/96};})};
 });
 const download=page.waitForEvent('download');await page.locator('#preview-save-word').click();const zip=unzipSync(await readFile(await (await download).path()));const xml=strFromU8(zip['word/document.xml']);
 const section=xml.match(/<w:pgSz\b[^>]*>/)[0],margins=xml.match(/<w:pgMar\b[^>]*>/)[0];
 near(geometry.width,millimetres(section,'w'),'A4 width');near(geometry.left,millimetres(margins,'left'),'left page margin');near(geometry.right,millimetres(margins,'right'),'right page margin');near(geometry.body,millimetres(section,'w')-millimetres(margins,'left')-millimetres(margins,'right'),'useful body width');
 const paragraphs=[...xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map(m=>m[1]);
 for(const prefix of ['Plain ','Left ','First ','Mixed ','Inherited ']){
  const actual=geometry.paragraphs.find(p=>p.text.startsWith(prefix)),word=paragraphs.find(p=>p.includes('>'+prefix)),indent=word.match(/<w:ind\b[^>]*>/)?.[0]??'',spacing=word.match(/<w:spacing\b[^>]*>/)[0];
  near(actual.left,millimetres(indent,'left'),prefix+'left indent');near(actual.right,millimetres(indent,'right'),prefix+'right indent');near(actual.first,millimetres(indent,'firstLine'),prefix+'first line indent');
  near(actual.width,geometry.body-millimetres(indent,'left')-millimetres(indent,'right'),prefix+'paragraph content width');near(actual.firstText,actual.first,prefix+'actual first glyph position');
  assert.match(spacing,/w:lineRule="atLeast"/);assert.ok(Math.abs(actual.minimum-millimetres(spacing,'line')*72/25.4)<.03&&actual.line+.03>=actual.minimum,prefix+'line minimum follows OOXML');
  assert.ok(Math.abs(actual.before-millimetres(spacing,'before')*72/25.4)<.03);assert.ok(Math.abs(actual.after-millimetres(spacing,'after')*72/25.4)<.03);
 }
 await open();
 const boldPreview=await page.locator('.word-reference-preview p').filter({hasText:'ЗАКЛЮЧЕНИЕ:'}).first().evaluate(paragraph=>{
  const marked=paragraph.querySelector('strong'),weight=marked?Number.parseInt(getComputedStyle(marked).fontWeight,10):0;
  const rows=new Map();const walker=document.createTreeWalker(paragraph,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){const node=walker.currentNode;for(let i=0;i<node.textContent.length;i++){const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+1);const rect=range.getBoundingClientRect();if(!rect.width)continue;const key=Math.round(rect.top);rows.set(key,(rows.get(key)||'')+node.textContent[i]);}}
  return{weight,font:getComputedStyle(marked).fontFamily,size:getComputedStyle(marked).fontSize,lines:[...rows.values()].map(line=>line.trim().split(/\s+/).at(-1))};
 });
 const conclusionXml=paragraphs.find(p=>p.includes('>ЗАКЛЮЧЕНИЕ:'));
 assert.ok(conclusionXml&&/<w:b\b[^>]*\/?\s*>/.test(conclusionXml),'DOCX marks the conclusion run bold');
 assert.ok(boldPreview.weight>=600&&boldPreview.lines.length>=2,'preview uses bold Arial and wraps the long conclusion');
 assert.ok(boldPreview.font.includes('Arial')&&Math.abs(parseFloat(boldPreview.size)*.75-11)<.02,'preview conclusion font and size match the OOXML run');
 assert.ok(conclusionXml.includes('w:sz')&&conclusionXml.includes('w:val="22"'),'DOCX conclusion uses 11 pt runs');
 details.boldConclusion=boldPreview;await close();
 details.geometry=geometry;console.log('PASS: actual DOCX and preview match A4/margins/indents, spacing, 11 pt Arial and bold conclusion; measured line endings recorded (real Word unavailable).');
 stage='calibration preservation and responsive theme UI';await open();
 for(const theme of ['light','dark'])for(const viewport of [{width:1500,height:1000},{width:900,height:600},{width:640,height:480}]){
  await page.setViewportSize(viewport);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await page.locator('.word-preview-dialog>.dialog-body').evaluate(n=>n.scrollTop=0);
  const ui=await page.locator('.word-preview-dialog').evaluate(dialog=>{
   const rect=n=>{const r=n.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right};},field=dialog.querySelector('[data-calibration-target]'),control=dialog.querySelector('.preview-calibration-controls');
   const lum=c=>{const v=c.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2];};
   const ratio=(color,background)=>{const a=lum(color),b=lum(background);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);};const cs=getComputedStyle(control),fs=getComputedStyle(field);
   return{header:rect(dialog.querySelector('header')),footer:rect(dialog.querySelector('footer')),field:rect(field),body:rect(dialog.querySelector('.dialog-body')),textContrast:ratio(cs.color,cs.backgroundColor),inputContrast:ratio(fs.color,fs.backgroundColor),visible:getComputedStyle(field).display!=='none'};
  });
  assert.ok(ui.header.top>=0&&ui.footer.bottom<=viewport.height+1,'header and footer remain in window');assert.ok(ui.visible&&ui.textContrast>=4.5&&ui.inputContrast>=4.5,'settings and input meet 4.5:1 contrast '+JSON.stringify(ui));
  await page.locator('[data-calibration-target]').focus();assert.equal(await page.locator('[data-calibration-target]').inputValue(),String(Number(await page.locator('#preview-calibration-controls').getAttribute('data-base-lines'))-2));
  await page.locator('.word-preview-dialog>.dialog-body').evaluate(n=>n.scrollTop=n.scrollHeight);
  if(viewport.height===480)assert.ok(await page.locator('.word-preview-dialog>.dialog-body').evaluate(n=>n.scrollTop>0),'small dialog body really scrolls');
  await page.locator('.word-preview-dialog>.dialog-body').evaluate(n=>n.scrollTop=0);
  if(viewport.width===1500)await page.screenshot({path:`${output}/word-preview-geometry-${theme}.png`,fullPage:true});
  await page.locator('.word-preview-dialog>header button').focus();
 }
 assert.equal(await page.evaluate(k=>localStorage.getItem(k),calKey),savedCalibration,'existing UUID, offset, enabled and target unchanged byte-for-byte');
 await page.reload();await page.locator('#editor .report-content').waitFor();assert.equal(await page.evaluate(k=>localStorage.getItem(k),calKey),savedCalibration);await open();
 await close();
 console.log('PASS: two themes, three viewport sizes, accessible top/scroll/focus, persisted doctor UUID calibration unchanged.');
 stage='widow and orphan visual lines';
 for(const count of [44.25,44.5,44.75,45,60,61,62,120,180]){
  const source=makeTemplateDocument('head-gm');source.content=[p(sentence.repeat(Math.floor(count))+sentence.slice(0,Math.round((count%1)*sentence.length)),{firstLineIndentPt:28.35,leftIndentPt:14.2}),p('ЗАКЛЮЧЕНИЕ: синтетическое.'),p('Врач: Синтетический. Дата: 01.01.2000')];await load(source);await open();
  const fragments=await page.locator('.word-reference-preview p.preview-paragraph-fragment,.word-reference-preview p.preview-paragraph-continuation').evaluateAll(nodes=>nodes.map(n=>{const range=document.createRange();range.selectNodeContents(n);const tops=[...new Set([...range.getClientRects()].filter(r=>r.width>.1).map(r=>Math.round(r.top)))];return{lines:tops.length,continuation:n.classList.contains('preview-paragraph-continuation'),indent:getComputedStyle(n).textIndent};}));
  console.log(`Measured long paragraph ${count}: ${fragments.map(f=>f.lines).join('/')} lines per fragment`);if(count>=45)assert.ok(fragments.length>=2,'long paragraph actually splits at repeat count '+count);assert.ok(fragments.every(f=>f.lines>=2),'no single leftover visual line '+JSON.stringify({count,fragments}));assert.ok(fragments.filter(f=>f.continuation).every(f=>parseFloat(f.indent)===0),'first line indent is not repeated on continuation');
  const result=await page.locator('.word-reference-preview .report-content').allTextContents();assert.equal(result.join('').replace(/\s/gu,''),plain(source).replace(/\s/gu,''));
  assert.ok(await page.locator('.word-reference-preview').evaluateAll(papers=>papers.every(paper=>{const footer=paper.querySelector('.preview-word-footer').getBoundingClientRect();return [...paper.querySelector('.report-content').querySelectorAll('*')].every(n=>n.getBoundingClientRect().bottom<footer.top);})), 'no footer overlap');
 }
 stage='physician settings after a rejected preview layout';await load(doc);
 const prior=await page.evaluate(k=>localStorage.getItem(k),calKey),priorText=await page.locator('#editor .report-content').innerText();
 // Simulate the same safe layout rejection seen with real Windows fonts. Only
 // detached Word-preview measurements change; editor/export geometry is intact.
 await page.evaluate(()=>{const original=Element.prototype.getBoundingClientRect;window.__restorePreviewMeasurement=()=>{Element.prototype.getBoundingClientRect=original;};Element.prototype.getBoundingClientRect=function(){const r=original.call(this);return this.matches('.word-reference-preview .report-content')&&this.children.length?new DOMRect(r.x,r.y,r.width,r.height+2000):r;};});
 await page.locator('#settings').click();await page.locator('#settings-expand-all').click();await page.locator('#settings-preview-calibration,#settings-calibration-status').filter({hasText:'Калибровка недоступна:'}).first().waitFor();
 await page.locator('#doctor-name').fill('Синтетический новый врач');await page.locator('#apply-doctor-now').check();
 assert.equal(await page.locator('#xrs-emergency').count(),0,'a rejected preview must not stop autosave or block physician settings');
 assert.match(await page.locator('#settings-preview-calibration,#settings-calibration-status').filter({hasText:'Калибровка недоступна:'}).first().innerText(),/Калибровка недоступна:.*Неделимый блок/);
 assert.equal(await page.locator('#editor .report-content').innerText(),priorText);assert.equal(await page.evaluate(k=>localStorage.getItem(k),calKey),prior);
 await page.evaluate(()=>window.__restorePreviewMeasurement());await page.locator('.dialog>footer [data-close]').click();await open();await close();
 console.log('PASS: rejected preview remains an explicit local warning; physician name/checkbox work, no fatal screen, original text/calibration survive and preview recovers.');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS: real measured line splits, no widows/orphans, no repeated first-indent, every character and physician preserved, footer clear; Word rendering remains unverified.');
 await writeFile(`${output}/word-preview-geometry.json`,JSON.stringify(details,null,2));
}catch(error){await writeFile(`${output}/word-preview-geometry-failure.json`,JSON.stringify({stage,error:error.stack,...details},null,2));await page?.screenshot({path:`${output}/word-preview-geometry-failure.png`,fullPage:true}).catch(()=>{});console.log(`::error title=Word preview geometry::${(stage+': '+error.message).replaceAll('%','%25').replaceAll('\n','%0A')}`);throw error;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
