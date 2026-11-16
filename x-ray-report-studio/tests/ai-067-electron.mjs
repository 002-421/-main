import assert from 'node:assert/strict';
import {_electron} from 'playwright-core';
import {cp,mkdir,mkdtemp,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const temp=await mkdtemp(path.join(os.tmpdir(),'xrs-ai-067-'));
const runtime=path.join(temp,'Installed XRS');
let app;
try{
 await cp(path.join(process.cwd(),'node_modules/electron/dist'),runtime,{recursive:true});
 const appRoot=path.join(runtime,'resources/app');await mkdir(appRoot,{recursive:true});
 for(const name of ['electron','dist','package.json'])await cp(path.join(process.cwd(),name),path.join(appRoot,name),{recursive:true});
 const executablePath=path.join(runtime,process.platform==='win32'?'X-ray Report Studio.exe':'X-ray Report Studio');
 await rename(path.join(runtime,process.platform==='win32'?'electron.exe':'electron'),executablePath);
 app=await _electron.launch({executablePath,args:[`--user-data-dir=${path.join(temp,'Profile')}`,'--no-sandbox',...(process.platform==='linux'?['--ozone-platform=headless','--disable-gpu']:[])],cwd:runtime,env:{...process.env,MRI_REPORT_STUDIO_DICTIONARY_DIR:path.join(temp,'Dictionary')}});
 const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.locator('.report-content').waitFor();
 assert.equal(await app.evaluate(({app})=>app.isPackaged),true,'the scenario launches a packaged Electron app');
 assert.equal(await app.evaluate(({app})=>app.getVersion()),'0.4.67');
 await app.evaluate(({clipboard})=>clipboard.clear());
 const description='На уровне L4/L5 определяется левосторонняя фораминальная экструзия диска. На уровне L5/S1 определяется правосторонняя парамедианно-фораминальная экструзия. На уровне L3/L4 определяется протрузия диска. Ошибкка. Признаки  дстрофических изменений. Суставная щели нерезко сужена. Гиперинтенсвный очаг. Позвоночный канал на исследованных уровнях не сужен. Осмотрел Иванов Иван.';
 const conclusion='Ошибкка. Экструзии L1/2 и L5/S1. Протрузия L3/L4. Выраженный стеноз позвоночного канала.';
 await page.addInitScript(({description,conclusion})=>{const read=Storage.prototype.getItem;let once=false;Storage.prototype.getItem=function(key){const raw=read.call(this,key);if(once||key!=='mri-report-studio.workspace.v1'||!raw)return raw;once=true;const state=JSON.parse(raw),report=state.reports.find(x=>x.id===state.activeId);report.doc.content.find(x=>x.attrs?.id==='header').content.unshift({type:'paragraph',content:[{type:'text',text:'Ошибкка',marks:[{type:'bold'}]}]},{type:'paragraph',content:[{type:'text',text:'Ошибкка: '},{type:'text',text:'Ошибкка',marks:[{type:'templateField',attrs:{id:'synthetic.patient',hint:'ФИО',filled:true}}]}]});const filler='На серии МР-томограмм в стандартных проекциях визуализируются анатомические структуры. Их положение сохранено; контуры ровные, патологические очаги достоверно не определяются.';report.doc.content.find(x=>x.attrs?.id==='description').content=[...Array.from({length:30},()=>({type:'paragraph',content:[{type:'text',text:filler}]})),{type:'paragraph',content:[{type:'text',text:description}]}];report.doc.content.find(x=>x.attrs?.id==='conclusion').content=[{type:'paragraph',content:[{type:'text',text:conclusion}]}];report.doc.content.find(x=>x.attrs?.id==='signature').content=[{type:'paragraph',content:[{type:'text',text:'Рекомендации: Ошибкка. Наблюдение.'}]},{type:'paragraph',content:[{type:'text',text:'Врач-рентгенолог: Тестовый Врач  Дата: 16.11.2026'}]}];return JSON.stringify(state);};},{description,conclusion});
 await page.reload();
 assert.ok(await page.locator('[data-section-id="description"] p').count()>=31,'the synthetic medical protocol spans many paragraphs');
 for(const category of ['spelling','punctuation','style','terminology','consistency','clinical']){const mark=page.locator(`.ai-review-${category}`).first();await mark.waitFor({timeout:30000});await mark.click({button:'right'});assert.equal(await page.locator('.ai-review-card').count(),1,`${category}: finding reaches the contextual menu in Electron`);await page.keyboard.press('Escape');}
 await page.waitForFunction(()=>[...document.querySelectorAll('.ai-review-spelling')].filter(n=>n.textContent==='Ошибкка').length===5,null,{timeout:30000});
 for(const mark of await page.locator('.ai-review-spelling').filter({hasText:/^Ошибкка$/}).all()){await mark.click({button:'right'});assert.equal(await page.locator('.ai-review-card').count(),1);await page.keyboard.press('Escape');}
 const level=page.locator('.ai-review-consistency').filter({hasText:'L1/2'}).first();await level.waitFor({timeout:30000});
 await level.click();assert.equal(await page.locator('.ai-review-card').count(),0,'left click leaves editing unobstructed');
 await level.click({button:'right'});const menu=page.locator('.ai-review-card');await menu.waitFor();const text=await menu.innerText();assert.match(text,/L1-L2.*отсутствующая/su);assert.match(text,/L4-L5.*не отражённая/su);assert.equal(await menu.getByText('Заменить',{exact:true}).count(),0);
 await page.keyboard.press('Escape');assert.equal(await menu.count(),0);
 const typo=page.locator('.ai-review-spelling').filter({hasText:'дстрофических'}).first();await typo.waitFor({timeout:30000});await typo.click({button:'right'});await page.getByRole('button',{name:'дистрофических',exact:true}).click();assert.match(await page.locator('.report-content').innerText(),/дистрофических/u);
 await page.keyboard.press('Control+z');assert.match(await page.locator('.report-content').innerText(),/дстрофических/u);
 await page.keyboard.press('Control+y');assert.match(await page.locator('.report-content').innerText(),/дистрофических/u);
 await page.locator('#copy-for-ai').click();const preview=page.locator('#ai-copy-text');await preview.waitFor();const before=await preview.inputValue();assert.ok(before.includes('Экструзии L1/2'));assert.ok(before.includes('Иванов Иван'));assert.ok(!before.includes('Пациент:'));
 await page.locator('#ai-copy-confirm').check();await page.locator('#ai-copy-commit').click();assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),'','unresolved personal data must never enter clipboard');
 await preview.fill(before.replace('Осмотрел Иванов Иван.',''));await page.locator('#ai-copy-confirm').check();await page.locator('#ai-copy-commit').click();
 const copied=await app.evaluate(({clipboard})=>clipboard.readText());assert.ok(copied.includes('Экструзии L1/2'));assert.ok(!copied.includes('Иванов')&&!copied.includes('Пациент:')&&!copied.includes('Тестовый Врач'));
 await page.locator('#settings').click();await page.locator('#doctor-name').fill('Тестовый Врач');
 await page.locator('#doctor-stamp-file').setInputFiles({name:'stamp.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW+0AAAAASUVORK5CYII=','base64')});
 await page.locator('#stamp-preview img').waitFor();
 for(const [selector,value] of [['#stamp-height','120'],['#stamp-position-x','25'],['#stamp-position-y','-15']])await page.locator(selector).evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},value);
 assert.equal(await page.locator('#stamp-preview img').evaluate(el=>el.style.transform),'translate(25px, -15px)');
 await page.locator('#save-settings').click();await page.locator('#preview-report').click();
 const stamp=page.locator('.doctor-stamp-image').first();await stamp.waitFor();assert.equal(await stamp.evaluate(el=>el.style.getPropertyValue('--stamp-x')),'25px');assert.equal(await stamp.evaluate(el=>el.style.getPropertyValue('--stamp-y')),'-15px');assert.equal(await stamp.evaluate(el=>el.style.getPropertyValue('--stamp-height')),'120px');
 assert.equal(await stamp.evaluate(el=>getComputedStyle(el).objectFit),'contain');await page.locator('[data-close]').first().click();
 assert.deepEqual(errors,[]);console.log('PASS real Electron: multi-level findings, menu, spelling correction and Undo/Redo, personal-data-gated plain-text clipboard.');
}finally{if(app){try{await app.evaluate(({clipboard})=>clipboard.clear());}catch{}await app.close();}await rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
