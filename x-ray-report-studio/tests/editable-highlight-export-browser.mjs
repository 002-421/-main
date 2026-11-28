import {installToolbarDriver} from './helpers/toolbar-driver.mjs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {unzipSync,strFromU8} from 'fflate';
import {makeTemplateDocument} from '../src/catalog.ts';
import {resetInlineTemplate} from '../src/inline-fields.ts';
import {editableHighlightStructure} from '../src/template-highlights.ts';
import {importOwnDocx} from '../src/docx.ts';
import {capturePrintLayout,renderCapturedPdf,removePrintCapture,chooseExport} from './print-export-helpers.mjs';
const ids=['spine-shop','spine-shop-m','spine-shop-art','spine-gop','spine-gop-m','spine-pop','spine-pop-m','spine-kkop'];
const reports=ids.map(id=>({id:`test-${id}`,templateId:id,doc:resetInlineTemplate(makeTemplateDocument(id)),dirty:false}));
const html=await readFile('dist/index.html'),server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const page=await browser.newPage({viewport:{width:1500,height:1000},acceptDownloads:true});
try{
 await page.addInitScript(reports=>{
  localStorage.setItem('mri-report-studio.workspace.v1',JSON.stringify({activeId:reports[0].id,reports}));
  localStorage.setItem('xrs.doctor-format.v1',JSON.stringify({version:1,activeId:'synthetic',profiles:{synthetic:{id:'synthetic',name:'',fontSize:11,optimize:false}}}));
 },reports);
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('.report-content').waitFor();
 await mkdir('test-output/editable-highlights/exports',{recursive:true});
 for(const id of ids){
  await page.locator(`[data-report-select="test-${id}"]`).click();
  const snapshot=await page.evaluate(()=>document.querySelector('.report-content').editor.getJSON());
  const expected=editableHighlightStructure(snapshot);
  const downloaded=page.waitForEvent('download');await chooseExport(page,'#save-docx');
  const download=await downloaded,bytes=new Uint8Array(await readFile(await download.path()));
  const imported=await importOwnDocx(bytes);
  assert.deepEqual(editableHighlightStructure(imported.doc),expected,`${id}: DOCX retains all independent IDs`);
  const files=unzipSync(bytes),xml=strFromU8(files['word/document.xml']),footer=strFromU8(files['word/footer1.xml']);
  assert.ok(xml.includes('FFFF00'),`${id}: pending fields exported yellow`);
  assert.match(footer,/<w:sz w:val="21"/);
  await writeFile(`test-output/editable-highlights/exports/${id}.docx`,bytes);
  const printed=await capturePrintLayout(page);
  const total=await printed.locator('[data-template-highlight], [data-template-size][data-size-filled="false"]').count();
  assert.ok(total>0,`${id}: system state reaches the actual PDF print DOM`);
  const colors=await printed.locator('[data-template-size][data-size-filled="false"]').evaluateAll(els=>els.map(el=>getComputedStyle(el).backgroundColor));
  assert.ok(colors.every(c=>c==='rgb(255, 255, 0)'),`${id}: PDF measurement color`);
  const pdf=await renderCapturedPdf(page);assert.equal(pdf.subarray(0,4).toString(),'%PDF');
  await writeFile(`test-output/editable-highlights/exports/${id}.pdf`,pdf);
  await removePrintCapture(page);
  assert.deepEqual(await page.evaluate(()=>document.querySelector('.report-content').editor.getJSON()),snapshot,`${id}: exports do not mutate protocol state`);
  console.log(`PASS ${id}: DOCX state/IDs, footer, real Chromium PDF (${pdf.length} bytes), unchanged editor`);
 }
}catch(error){await page.screenshot({path:'test-output/editable-highlights/export-failure.png'}).catch(()=>{});throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
