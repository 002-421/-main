import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
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

let browser;
try {
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 for(const long of [false,true]){
  const page=await browser.newPage({viewport:{width:1400,height:900},acceptDownloads:true});
  const doc={...makeTemplateDocument('head-gm'),content:[
   section('header',[p('Синтетический протокол')]),
   section('description',[...Array.from({length:51},(_,i)=>p('Контрольная строка описания '+(i+1))),p('Послѣдний абзац описания.')]),
   section('conclusion',[{type:'horizontalRule',attrs:{manual:true}},p('ЗАКЛЮЧЕНИЕ:',[{type:'bold'}]),p(''),p(long?sentence.repeat(100):'Синтетический результат заключения.',[{type:'bold'}]),p('Рекомендации: синтетическая запись.')]),
   section('signature',[p('Врач: Синтетический. Дата: 01.01.2000')]),
  ]};
  await page.addInitScript(({doc,key})=>{
   sessionStorage.getItem('seeded')||(
    sessionStorage.setItem('seeded','1'),
    localStorage.setItem(key,JSON.stringify({activeId:'pagination-test',reports:[{id:'pagination-test',templateId:'head-gm',doc,dirty:false}]})),
    localStorage.setItem('xrs.doctor-format.v1',JSON.stringify({version:1,activeId:'physician',profiles:{physician:{id:'physician',name:'',fontSize:11,optimize:false}}}))
   );
  },{doc,key});
  await page.goto(url);
  const preview=async()=>{await page.locator('#preview-report').click();await page.locator('.paginated-browser-preview .preview-page').first().waitFor();};
  await preview();
  const output=await page.locator('.paginated-browser-preview .preview-page').evaluateAll(pages=>pages.map(p=>{
   const body=p.querySelector('.report-content'),footer=p.querySelector('.preview-word-footer');
   const bottom=Math.max(...[...body.querySelectorAll('*')].map(e=>e.getBoundingClientRect().bottom));
   return {text:body.textContent,heading:!!body.querySelector('[data-conclusion-start]'),
    startsBody:!!body.querySelector('[data-conclusion-body]'),description:!!body.querySelector('[data-last-description]'),
    rule:!!body.querySelector('hr[data-manual-rule]'),safe:bottom<footer.getBoundingClientRect().top,
    width:body.getBoundingClientRect().width};
  }));
  const headingPage=output.findIndex(x=>x.heading);
  assert.ok(headingPage>=1,'fixture reaches a physical page boundary');
  assert.equal(output.filter(x=>x.heading).length,1,'standalone heading is emitted exactly once');
  assert.ok(output[headingPage].startsBody&&output[headingPage].description&&output[headingPage].rule,'description, rule, heading and first content share a page');
  assert.ok(output.every(x=>x.safe));
  assert.equal(normalized(output.map(x=>x.text).join('')),normalized(text(doc)));
  if(long)assert.ok(output.length>headingPage+1,'long conclusion continues without a single oversized block');
  const download=page.waitForEvent('download');await page.locator('#preview-save-word').click();
  const zip=unzipSync(await readFile(await (await download).path()));
  const xml=strFromU8(zip['word/document.xml']);
  const paragraphs=[...xml.matchAll(/<w:p(?: [^>]*)?>.*?<\/w:p>/gs)].map(match=>match[0]);
  const find=value=>paragraphs.find(p=>p.includes(value));
  const last=find('Послѣдний абзац'),rule=find('8C9CAE'),heading=find('ЗАКЛЮЧЕНИЕ:'),body=find(long?'Синтетический полужирный':'Синтетический результат');
  for(const item of [last,rule,heading])assert.match(item,/<w:keepNext\s*\/>/);
  assert.match(heading,/<w:keepLines\s*\/>/);
  assert.match(body,/<w:keepLines w:val="false"\s*\/>/);
  assert.match(body,/<w:keepNext w:val="false"\s*\/>/);
  assert.match(body,/<w:widowControl\s*\/>/);
  assert.match(body,/<w:sz w:val="22"\s*\/>/);
  assert.match(body,/<w:b\s*\/>/);
  assert.match(xml,/<w:sectPr>/);

  await preview();
  await page.evaluate(()=>{
   document.querySelector('#app').style.display='none';
   const copy=document.createElement('div');copy.id='print-fix-copy';copy.className='export-only-editor';
   copy.innerHTML=document.querySelector('.paginated-browser-preview').innerHTML;document.body.append(copy);
  });
  const pdf=await page.pdf({preferCSSPageSize:true,printBackground:true});
  assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,output.length);
  await page.evaluate(()=>{document.querySelector('#print-fix-copy').remove();document.querySelector('#app').style.display='';});
  await page.locator('.word-preview-dialog [data-close]').last().click();

  if(!long){
   assert.equal(await page.locator('#insert-field').count(),0);
   assert.ok(await page.locator('#insert-size').isVisible());
   assert.ok(await page.locator('[data-command=bulletList]').isVisible());
   assert.ok(await page.locator('[data-command=orderedList]').isVisible());
   for(const theme of ['light','dark']){
    await page.setViewportSize(theme==='light'?{width:1400,height:900}:{width:720,height:520});
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    if(!await page.locator('#settings').isVisible())await page.locator('#toggle-sidebar').click();
    await page.locator('#settings').click();
    const dialog=page.locator('.doctor-settings-dialog'),sections=dialog.locator('[data-settings-section]');
    assert.equal(await sections.count(),8);
    assert.equal(await dialog.locator('[data-settings-section][open]').count(),0);
    await dialog.locator('[data-settings-section=doctor] > summary').click();
    await dialog.locator('#doctor-name').fill('Синтетический врач');
    await dialog.locator('[data-settings-section=doctor] > summary').click();
    await dialog.locator('[data-settings-section=format] > summary').click();
    assert.equal(await dialog.locator('[data-settings-section][open]').count(),1);
    await dialog.getByRole('button',{name:'Развернуть все',exact:true}).click();
    assert.equal(await dialog.locator('[data-settings-section][open]').count(),8);
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
  await page.close();
 }
 console.log('PASS: conclusion heading, first body, divider and description share the page; long body splits; OOXML, PDF, settings and ribbon.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
