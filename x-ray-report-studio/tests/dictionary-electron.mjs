import assert from 'node:assert/strict';
import { _electron } from 'playwright-core';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import packageInfo from '../package.json' with {type:'json'};

// Exercise a packaged Electron runtime, the real preload, real IPC and real disk IO.
// All profile and shared-dictionary paths are synthetic and isolated.
const root=process.cwd(),temp=await mkdtemp(path.join(os.tmpdir(),'xrs-dictionary-'));
const runtime=path.join(temp,'Installed XRS'),profile=path.join(temp,'Тестовый профиль'),shared=path.join(temp,'Общий словарь');
await cp(path.join(root,'node_modules/electron/dist'),runtime,{recursive:true});
const appRoot=path.join(runtime,'resources/app');await mkdir(appRoot,{recursive:true});
for(const name of ['electron','dist','package.json'])await cp(path.join(root,name),path.join(appRoot,name),{recursive:true});
await mkdir(shared,{recursive:true});await writeFile(path.join(shared,'dictionary.json'),JSON.stringify(['старыйтермин']));
const executablePath=path.join(runtime,process.platform==='win32'?'X-ray Report Studio.exe':'X-ray Report Studio');
await rename(path.join(runtime,process.platform==='win32'?'electron.exe':'electron'),executablePath);
let app,page;const errors=[];
async function launch(){
 app=await _electron.launch({executablePath,args:[`--user-data-dir=${profile}`,'--no-sandbox','--ozone-platform=headless','--disable-gpu'],env:{...process.env,MRI_REPORT_STUDIO_DICTIONARY_DIR:shared}});
 page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 await page.locator('.report-content').waitFor();
 assert.equal(await app.evaluate(({app})=>app.isPackaged),true);
 assert.equal(await app.evaluate(({app})=>app.getVersion()),packageInfo.version);
}
try{
 await launch();
 assert.deepEqual((await page.evaluate(()=>window.desktop.dictionaryLoad())).words,['старыйтермин']);
 await page.addInitScript(()=>{
  const original=Storage.prototype.getItem;let once=false;
  Storage.prototype.getItem=function(key){const value=original.call(this,key);if(key!=='mri-report-studio.workspace.v1'||once||!value)return value;
   const w=JSON.parse(value),r=w.reports.find(r=>r.id===w.activeId);const section=r.doc.content.find(n=>n.attrs?.id==='description');
   const visit=n=>{if(n.type==='text'){n.text='Ошибкка';return true;}return(n.content??[]).some(visit);};visit(section);
   w.reports.push({...structuredClone(r),id:'dictionary-second-tab'});once=true;return JSON.stringify(w);
  };
 });
 await page.reload();
 const mark=page.locator('.ai-review-spelling').filter({hasText:'Ошибкка'}).first();await mark.waitFor({timeout:30000});await mark.click({button:'right'});
 assert.equal(await page.getByRole('button',{name:'Проверить',exact:true}).count(),0);
 await page.getByRole('button',{name:'Запомнить термин',exact:true}).click();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('mri-report-studio.dictionary.v1')||'[]').includes('ошибкка'));
 await page.waitForFunction(()=>![...document.querySelectorAll('.ai-review-spelling')].some(n=>n.textContent==='Ошибкка'));
 await page.locator('[data-report-select="dictionary-second-tab"]').click();
 await page.waitForFunction(()=>!document.querySelector('#ai-review-status')?.hasAttribute('aria-busy'));
 assert.equal(await page.locator('.ai-review-spelling').filter({hasText:'Ошибкка'}).count(),0);
 const again=await page.evaluate(()=>window.desktop.dictionaryMergeSave(['ОШИБККА','ошибкка']));assert.equal(again.words.filter(w=>w==='ошибкка').length,1);
 assert.ok(JSON.parse(await readFile(path.join(shared,'dictionary.json'),'utf8')).includes('ошибкка'));
 await app.close();app=undefined;await launch();
 assert.ok((await page.evaluate(()=>window.desktop.dictionaryLoad())).words.includes('ошибкка'));
 await page.locator('#settings').click();await page.locator('#dictionary-settings').click();
 const input=page.locator('#personal-words');await input.fill((await input.inputValue()).split(/\s+/).filter(w=>w!=='ошибкка').join('\n'));await page.locator('#save-dictionary').click();
 await page.waitForFunction(()=>!JSON.parse(localStorage.getItem('mri-report-studio.dictionary.v1')||'[]').includes('ошибкка'));
 await app.close();app=undefined;await launch();
 await page.locator('.ai-review-spelling').filter({hasText:'Ошибкка'}).first().waitFor({timeout:30000});
 assert.ok((await page.evaluate(()=>window.desktop.dictionaryLoad())).words.includes('старыйтермин'),'old dictionary entries survive');
 // A real broken dictionary must fail visibly and must never be overwritten.
 await writeFile(path.join(shared,'dictionary.json'),'{broken-json');
 await page.locator('.ai-review-spelling').filter({hasText:'Ошибкка'}).first().click({button:'right'});
 await page.getByRole('button',{name:'Запомнить термин',exact:true}).click();
 await page.getByText('Не удалось сохранить термин. Файл словаря повреждён. Сохранение отменено.',{exact:true}).waitFor();
 assert.equal(await readFile(path.join(shared,'dictionary.json'),'utf8'),'{broken-json');
 assert.deepEqual(errors,[]);
 console.log('PASS packaged Electron: real IPC, Cyrillic profile, remember from card, idempotent merge, two tabs, process restart, removal and renewed spelling finding.');
}catch(error){await mkdir('test-output',{recursive:true});await writeFile('test-output/dictionary-electron-error.txt',String(error.stack));if(page)await page.screenshot({path:'test-output/dictionary-electron-error.png'}).catch(()=>{});throw error;
}finally{await app?.close();// Windows can keep a runtime DLL mapped briefly after the main process exits.
 // Retry only test-directory removal; report failure if it remains locked.
 await rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
