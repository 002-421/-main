import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { reportTemplates } from '../src/catalog.ts';

const output=process.env.XRS_VISUAL_OUTPUT||'/tmp/xrs-ai-03-visual';
await mkdir(output,{recursive:true});
const server=createServer(async(_request,response)=>{response.setHeader('Content-Type','text/html;charset=utf-8');response.end(await readFile('dist/index.html'));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 for(const [label,id] of [['mri','head-gm'],['ct','ct-c8babc4c5b']]){
  const context=await browser.newContext();const page=await context.newPage();
  await page.addInitScript(()=>{const add=EventTarget.prototype.addEventListener;EventTarget.prototype.addEventListener=function(type,listener,options){if(this===window&&type==='beforeunload')return;return add.call(this,type,listener,options);};});
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('.report-content').waitFor();
  if(label==='ct'){
   await page.locator('#modality-select').selectOption('ct');
   await page.locator('#area-select').selectOption(reportTemplates.find(t=>t.id===id).areaId);
   await page.locator(`[data-template="${id}"]`).click();
  }
  await page.locator('#new-report').click();await page.evaluate(()=>document.fonts.ready);
  await writeFile(`${output}/${label}-structured.pdf`,await page.pdf({format:'A4',printBackground:true}));
  await page.evaluate(()=>{const key='mri-report-studio.workspace.v1',value=JSON.parse(localStorage.getItem(key));const report=value.reports.find(r=>r.id===value.activeId);const doc=structuredClone(report.doc);doc.content=doc.content.slice(0,4).flatMap(section=>section.content).concat(doc.content.slice(4));report.doc=doc;localStorage.setItem(key,JSON.stringify(value));});
  await page.reload();await page.locator('.report-content').waitFor();await page.evaluate(()=>document.fonts.ready);
  await writeFile(`${output}/${label}-flat.pdf`,await page.pdf({format:'A4',printBackground:true}));
  await context.close();
 }
 console.log(`PDF comparison files: ${output}`);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
