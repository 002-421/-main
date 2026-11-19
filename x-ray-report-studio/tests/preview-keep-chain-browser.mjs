import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {build} from 'vite';
import {chromium} from 'playwright-core';
const result=await build({configFile:false,logLevel:'silent',build:{write:false,minify:false,lib:{entry:resolve('src/preview-pages.ts'),name:'PreviewGeometryTest',formats:['iife']}}});
const code=(Array.isArray(result)?result[0]:result).output.find(file=>file.type==='chunk').code;
const server=createServer(async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await readFile('dist/index.html'));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000}});await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('#editor .report-content').waitFor();await page.addScriptTag({content:code});
 const actual=await page.evaluate(()=>{
  const paragraph=label=>`<p data-keep-next="true" style="font-family:Arial;font-size:11pt;line-height:1.05;margin:0">${label} 1<br>${label} 2<br>${label} 3</p>`;
  const html=paragraph('Синтетический А')+paragraph('Синтетический Б')+'<div class="doctor-signature-row"><p style="font-size:11pt;line-height:1.05;margin:0">Врач: Синтетический</p><p style="font-size:11pt;line-height:1.05;margin:0">Дата: 01.01.2000</p></div>';
  const doc={type:'doc',attrs:{fontFamily:'Arial',fontSizePt:11,lineHeight:1.05},content:[]};
  const output=window.PreviewGeometryTest.paginateBrowserPreview(html,doc,undefined,{width:650,height:100,imageHeight:100});
  const box=document.createElement('div');box.innerHTML=output;document.body.append(box);
  const input=document.createElement('div');input.innerHTML=html;
  return {input:input.textContent,output:box.textContent.replace(/Страница \d+/gu,'').replace(/\d+$/u,''),content:[...box.querySelectorAll('.report-content')].map(node=>({text:node.textContent,height:node.getBoundingClientRect().height,children:node.children.length})),authored:[...box.querySelectorAll('.report-content')].map(n=>n.textContent).join('')};
 });
 assert.equal(actual.authored,actual.input,'every character and signature survives an oversized keep-with-next chain');assert.equal(actual.content.length,2);assert.deepEqual(actual.content.map(p=>p.children),[1,2]);assert.ok(actual.content.every(p=>p.height<=100),'height limit is never relaxed');assert.match(actual.content[1].text,/Синтетический Б.*Врач:/u);
 const empty=await page.evaluate(()=>{
  const p=label=>`<p style="font-family:Arial;font-size:11pt;line-height:1.05;margin:0">${label} 1<br>${label} 2<br>${label} 3</p>`;
  const html=p('А')+p('Б')+'<p style="font-size:11pt;line-height:1.05;margin:0"><br class="ProseMirror-trailingBreak"></p>';
  const doc={type:'doc',attrs:{fontFamily:'Arial',fontSizePt:11,lineHeight:1.05},content:[]};
  const output=window.PreviewGeometryTest.paginateBrowserPreview(html,doc,undefined,{width:650,height:100,imageHeight:100});
  const box=document.createElement('div');box.innerHTML=output;document.body.append(box);
  return[...box.querySelectorAll('.report-content')].map(n=>({height:n.getBoundingClientRect().height,count:n.children.length,empty:n.querySelector('p:has(br.ProseMirror-trailingBreak)')!==null}));
 });
 assert.equal(empty.length,2);assert.deepEqual(empty.map(p=>p.count),[2,1]);assert.ok(empty[1].empty,'empty source paragraph is retained on the next page');assert.ok(empty.every(p=>p.height<=100));
 console.log('PASS: an empty trailing paragraph moves to the next page without deletion, overflow or an indivisible-block exception.');
 console.log('PASS: oversized keep-with-next chain splits at a paragraph boundary, retains the nearest paragraph with the signature, preserves all text and the strict height limit.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
