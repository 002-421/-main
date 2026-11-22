import { chooseExport, capturePrintLayout, renderCapturedPdf, removePrintCapture, assertNoPrintPreview } from './print-export-helpers.mjs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import packageInfo from '../package.json' with {type:'json'};
import {chromium} from 'playwright-core';
import {strFromU8,unzipSync} from 'fflate';
import {makeTemplateDocument} from '../src/catalog.ts';

const html=await readFile('dist/index.html');
const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port;
const key='mri-report-studio.workspace.v1';
const p=(text,marks=[])=>({type:'paragraph',attrs:{fontFamily:'Arial',fontSizePt:11,lineHeight:1.05,spaceAfterPt:0,spaceBeforePt:0},...(text?{content:[{type:'text',text,marks}]}:{})});
const section=(id,content)=>({type:'reportSection',attrs:{id,title:id},content});
const sentence='Синтетический полужирный текст заключения с проверкой границ и сохранности строк. ';
const text=n=>n.text??(n.content??[]).map(text).join('');
const normalized=s=>s.replace(/\s+/gu,'').toLowerCase();

const outputDir=process.env.XRS_DOCX_VALIDATION_DIR;
if(outputDir)await mkdir(outputDir,{recursive:true});
const table={type:'table',content:[{type:'tableRow',content:[{type:'tableCell',content:[p('Таблица перед заключением.')]},{type:'tableCell',content:[p('Условное значение.')]}]}]};
let browser;
try {
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 for(const scenario of [
  {name:'short',rows:3},
  {name:'boundary',rows:51},
  {name:'long',rows:51,long:true},
  {name:'table',rows:49,table:true},
  {name:'oversized-description',rows:4,oversized:true},
 ]){
  const {name,rows,long,oversized}=scenario;
  const page=await browser.newPage({viewport:{width:1400,height:900},acceptDownloads:true});
  const doc={...makeTemplateDocument('head-gm'),content:[
   section('header',[p('Синтетический протокол')]),
   section('description',[...Array.from({length:rows},(_,i)=>p('Контрольная строка описания '+(i+1))),p(oversized?'Послѣдний абзац описания. '+sentence.repeat(130):'Послѣдний абзац описания.'),...(scenario.table?[table]:[])]),
   section('conclusion',[{type:'horizontalRule',attrs:{manual:true}},p('ЗАКЛЮЧЕНИЕ:',[{type:'bold'}]),p(''),p(long?sentence.repeat(100):'Синтетический результат заключения.',[{type:'bold'}]),p('Рекомендации: синтетическая запись.')]),
   section('signature',[p('Врач: Синтетический. Дата: 01.01.2000')]),
  ]};
  await page.addInitScript(({doc,key,stamp})=>{
   sessionStorage.getItem('seeded')||(
    sessionStorage.setItem('seeded','1'),
    localStorage.setItem(key,JSON.stringify({activeId:'pagination-test',reports:[{id:'pagination-test',templateId:'head-gm',doc,dirty:false}]})),
    localStorage.setItem('xrs.doctor-format.v1',JSON.stringify({version:1,activeId:'physician',profiles:{physician:{id:'physician',name:'',fontSize:11,optimize:false}}}))
   );
   if(stamp){
    const name='Синтетический';
    const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW+0AAAAASUVORK5CYII=';
    localStorage.setItem('mri-alliance.settings.v3',JSON.stringify({doctor:name,doctors:[name],
     doctorStamps:{[name]:image},doctorStampSizes:{[name]:{width:80,height:40}},
     doctorStampHeights:{[name]:40},doctorStampPositions:{[name]:{x:-15,y:0}}}));
   }
  },{doc,key,stamp:name==='short'});
  await page.goto(url);
  await capturePrintLayout(page);
  const output=await page.locator('#test-print-layout .preview-page').evaluateAll(pages=>pages.map(p=>{
   const body=p.querySelector('.report-content'),footer=p.querySelector('.preview-word-footer');
   const bottom=Math.max(...[...body.querySelectorAll('*')].map(e=>e.getBoundingClientRect().bottom));
   return {text:body.textContent,heading:!!body.querySelector('[data-conclusion-start]'),
    startsBody:!!body.querySelector('[data-conclusion-body]'),description:!!body.querySelector('[data-last-description]'),
    rule:!!body.querySelector('hr[data-manual-rule]'),safe:bottom<footer.getBoundingClientRect().top,
    width:body.getBoundingClientRect().width};
  }));
  const headingPage=output.findIndex(x=>x.heading);
  if(name==='short'){
   assert.equal(output.length,1);
   const stamp=page.locator('#test-print-layout .doctor-stamp-image');
   assert.equal(await stamp.count(),1);
   assert.equal(await stamp.evaluate(el=>el.style.getPropertyValue('--stamp-x')),'-15px');
   assert.equal(await stamp.evaluate(el=>el.style.getPropertyValue('--stamp-height')),'40px');
  }
  if(['boundary','long','oversized-description'].includes(name))assert.ok(headingPage>=1,'fixture reaches a physical page boundary');
  assert.equal(output.filter(x=>x.heading).length,1,'standalone heading is emitted exactly once');
  assert.ok(output[headingPage].startsBody&&output[headingPage].description&&output[headingPage].rule,'description, rule, heading and first content share a page');
  assert.ok(output.every(x=>x.safe));
  assert.equal(normalized(output.map(x=>x.text).join('')),normalized(text(doc)));
  if(long)assert.ok(output.length>headingPage+1,'long conclusion continues without a single oversized block');
  const download=page.waitForEvent('download');await chooseExport(page,'#save-docx');await assertNoPrintPreview(page);
  const bytes=await readFile(await (await download).path());
  if(outputDir)await writeFile(join(outputDir,`${name}.docx`),bytes);
  const zip=unzipSync(bytes);
  const xml=strFromU8(zip['word/document.xml']);
  const paragraphs=[...xml.matchAll(/<w:p(?: [^>]*)?>.*?<\/w:p>/gs)].map(match=>match[0]);
  const find=value=>paragraphs.find(p=>p.includes(value));
  const last=find('Послѣдний абзац'),rule=find('8C9CAE'),heading=find('ЗАКЛЮЧЕНИЕ:'),body=find(long?'Синтетический полужирный':'Синтетический результат');
  const markedDescription=scenario.table?find('Таблица перед заключением'):last;
  for(const item of [rule,heading])assert.match(item,/<w:keepNext\s*\/>/);
  assert.match(markedDescription,oversized?/<w:keepNext w:val="false"\s*\/>/:/<w:keepNext\s*\/>/);
  assert.doesNotMatch(last,/<w:pageBreakBefore/);
  assert.match(heading,/<w:keepLines\s*\/>/);
  assert.match(body,/<w:keepLines w:val="false"\s*\/>/);
  assert.match(body,/<w:keepNext w:val="false"\s*\/>/);
  assert.match(body,/<w:widowControl\s*\/>/);
  assert.match(body,/<w:sz w:val="22"\s*\/>/);
  assert.match(body,/<w:b\s*\/>/);
  assert.match(xml,/<w:sectPr>/);
  if(name==='short'){
   assert.match(xml,/<w:drawing>/);
   assert.ok(Object.keys(zip).some(name=>name.startsWith('word/media/')));
  }

  const pdf=await renderCapturedPdf(page);
  assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,output.length);
  await removePrintCapture(page);

  if(name==='boundary'){
   assert.equal(await page.locator('#insert-field').count(),0);
   assert.ok(await page.locator('#insert-size').isVisible());
   assert.ok(await page.locator('[data-format-toggle=list]').isVisible());
   assert.ok(await page.locator('[data-format-toggle=align]').isVisible());
   for(const theme of ['light','dark']){
    await page.setViewportSize(theme==='light'?{width:1400,height:900}:{width:720,height:520});
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    if(!await page.locator('#settings').isVisible())await page.locator('#toggle-sidebar').click();
    await page.locator('#settings').click();
    const dialog=page.locator('.doctor-settings-dialog'),sections=dialog.locator('[data-settings-section]');
    assert.equal(await sections.count(),3);
    assert.equal(await dialog.locator('#check-updates').isVisible(),true);
    assert.equal(await dialog.locator('#update-current-version').textContent(),packageInfo.version);
    assert.equal(await dialog.locator('[data-settings-section=dictionary] summary').last().textContent(),'Лицензии словаря');
    assert.equal(await dialog.locator('[data-settings-section=doctor] #stamp-preview').count(),1);
    await assertNoPrintPreview(page);
    assert.equal(await dialog.locator('[data-settings-section][open]').count(),0);
    await dialog.locator('[data-settings-section=doctor] > summary').click();
    await dialog.locator('#doctor-name').fill('Синтетический врач');
    await dialog.locator('[data-settings-section=doctor] > summary').click();
    await dialog.locator('[data-settings-section=history] > summary').click();
    assert.equal(await dialog.locator('[data-settings-section][open]').count(),1);
    await dialog.getByRole('button',{name:'Развернуть все',exact:true}).click();
    assert.equal(await dialog.locator('[data-settings-section][open]').count(),3);
    assert.equal(await dialog.locator('#doctor-name').inputValue(),'Синтетический врач');
    const geometry=await dialog.evaluate(el=>{const body=el.querySelector('.dialog-body'),save=el.querySelector('#save-settings').getBoundingClientRect();return{scroll:body.scrollHeight>body.clientHeight,footer:save.top>=0&&save.bottom<=innerHeight};});
    assert.ok(geometry.scroll&&geometry.footer);
    await dialog.getByRole('button',{name:'Свернуть все',exact:true}).click();
    assert.equal(await dialog.locator('[data-settings-section][open]').count(),0);
    await dialog.getByRole('button',{name:'Отмена',exact:true}).click();
    await page.locator('#settings').click();
    assert.equal(await dialog.locator('[data-settings-section][open]').count(),0);
    await dialog.locator('[data-settings-section=doctor] > summary').click();
    assert.equal(await dialog.locator('#doctor-name').inputValue(),'');
    await dialog.locator('#doctor-name').fill('Синтетический врач');
    await dialog.locator('#save-settings').click();
    await page.locator('#settings').click();
    await dialog.locator('[data-settings-section=doctor] > summary').click();
    assert.equal(await dialog.locator('#doctor-name').inputValue(),'Синтетический врач');
    await dialog.locator('#doctor-name').fill('');
    await dialog.locator('#save-settings').click();
   }
  }
  console.log(`${name}: ${output.length} pages; conclusion starts on page ${headingPage+1}`);
  await page.close();
 }
 console.log('PASS: conclusion heading, first body, divider and description share the page; long body splits; OOXML, PDF, settings and ribbon.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
