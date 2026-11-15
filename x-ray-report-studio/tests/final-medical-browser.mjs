import {chromium} from 'playwright-core';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';
const server=createServer(async(_,r)=>r.end(await readFile('dist/index.html')));await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const cases=[
 ['spelling','Ошибкка.','Без особенностей.'],['punctuation','Исследование  завершено.','Без особенностей.'],['style','Суставная щели нерезко сужена.','Без особенностей.'],['terminology','МРТ: гиперинтенсвный очаг.','Без особенностей.'],
 ['consistency','На уровне L4–L5 определяется правосторонняя парамедианная экструзия межпозвонкового диска размером 6 мм.','Левосторонняя экструзия диска L5–S1.'],
 ['clinical','Позвоночный канал на исследованных уровнях не сужен.','Выраженный стеноз позвоночного канала.'],
 ['clinical','Грыж межпозвонковых дисков не выявлено.','Экструзия диска L5–S1.']];
 for(const [category,d,c,expected=true] of [...cases,...['spelling','punctuation','style','terminology','consistency','clinical'].map(category=>[category,'Исследование завершено.','Без особенностей.',false])]){const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('.report-content').waitFor();
  await page.addInitScript(({d,c})=>{const get=Storage.prototype.getItem;let once=false;Storage.prototype.getItem=function(key){const raw=get.call(this,key);if(once||key!=='mri-report-studio.workspace.v1'||!raw)return raw;once=true;const w=JSON.parse(raw),r=w.reports.find(x=>x.id===w.activeId);for(const [id,text] of [['description',d],['conclusion',c]])r.doc.content.find(n=>n.attrs?.id===id).content=[{type:'paragraph',content:[{type:'text',text}]}];return JSON.stringify(w);};},{d,c});await page.reload();
  if(!expected){await page.waitForFunction(()=>document.querySelector('#ai-review-status')?.textContent==='Замечаний не найдено');assert.equal(await page.locator('.ai-review-'+category).count(),0);await page.close();continue;}
  const mark=page.locator('.ai-review-'+category).first();await mark.waitFor({timeout:30000});await mark.click();assert.ok(await page.locator('.ai-review-card').count());assert.equal(await page.getByRole('button',{name:'Проверить',exact:true}).count(),0);if(['clinical','consistency','terminology','spelling'].includes(category))assert.equal(await page.getByRole('button',{name:'Заменить',exact:true}).count(),0);assert.ok((await page.locator('.report-content').innerText()).includes(d));assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS six categories: findings reach real decorations and cards without automatic medical edits.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
