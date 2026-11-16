import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const server=createServer(async(_req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(await readFile('dist/index.html'));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
 browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
 const page=await browser.newPage(),errors=[],external=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(/^https?:/.test(request.url())&&!request.url().startsWith(origin))external.push(request.url());});
 await page.goto(origin);await page.locator('.report-content').waitFor();
 const text='МРТ: Гипофиз, гипофиза, гипофизу. Микрокиста, микрокисты, микрокист. Гемисфера, гемисферы. Дорзальный, дорзальных. Изоинтенсивный, изоинтенсивные. Гиперинтенсивный, гиперинтенсивные. Резидуальный, резидуального. Микроангиопатия. Нерезко. Суставная щели нерезко сужена.';
 await page.addInitScript(text=>{
  const get=Storage.prototype.getItem;let once=false;
  Storage.prototype.getItem=function(key){const raw=get.call(this,key);if(key!=='mri-report-studio.workspace.v1'||once||!raw)return raw;
   const workspace=JSON.parse(raw),report=workspace.reports.find(r=>r.id===workspace.activeId);
   report.doc.content.find(n=>n.attrs?.id==='description').content=[{type:'paragraph',content:[{type:'text',text}]}];
   report.doc.content.find(n=>n.attrs?.id==='conclusion').content=[{type:'paragraph',content:[{type:'text',text:'Без особенностей.'}]}];once=true;return JSON.stringify(workspace);
  };
 },text);
 await page.reload();
 await page.locator('.ai-review-style').filter({hasText:'щели'}).first().waitFor({timeout:30000});
 assert.deepEqual(await page.locator('.ai-review-spelling,.ai-review-terminology').allTextContents(),[],'valid forms are accepted by both analyzers');
 await page.locator('.ai-review-style').filter({hasText:'щели'}).first().click({button:'right'});
 assert.equal(await page.getByRole('button',{name:'Проверить',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Заменить',exact:true}).count(),0,'ambiguous grammar remains a physician comment');
 assert.match(await page.locator('.ai-review-card').innerText(),/Форма существительного не согласована/);
 assert.match(await page.locator('.report-content').innerText(),/изоинтенсивные/i,'medical meaning preserved');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 console.log('PASS: automatic offline morphology, inflections recognized across spelling and terminology, clinical comments have no fake action.');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
