// Two real, isolated Electron instances over a local HTTPS signed test channel.
// This does NOT replace the separate acceptance test against GitHub Releases.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:https';
import path from 'node:path';
import os from 'node:os';
import {_electron} from 'playwright-core';
import {fixture} from './helpers/template-fixture.mjs';
import {prepareInlineDocument} from '../src/inline-fields.ts';
import {initializeEditableHighlights} from '../src/template-highlights.ts';
import p from '../electron/template-protocol.cjs';
const temp=await mkdtemp(path.join(os.tmpdir(),'xrs-template-electron-')),f=fixture(),apps=[],rendererErrors=[],output='test-output/template-updates';let server;
const executable=process.env.ELECTRON_PATH||path.resolve('node_modules/electron/dist',process.platform==='win32'?'electron.exe':'electron');
const openssl=process.platform==='win32'&&existsSync('C:/Program Files/Git/usr/bin/openssl.exe')?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
const documentSnapshot=page=>page.evaluate(()=>document.querySelector('.report-content').editor.getJSON());
async function manager(page){await page.locator('#settings').click();await page.locator('[data-settings-section="medical-templates"] summary').click();await page.locator('#medical-template-settings').click();await page.locator('#template-catalog-check').waitFor();}
try{
 await mkdir(output,{recursive:true});
 execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(temp,'tls.key'),'-out',path.join(temp,'tls.crt'),'-days','2','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1','-addext','basicConstraints=critical,CA:TRUE'],{stdio:'ignore'});
 const synthetic=f.template('synthetic-catalog-test','0.0.1');synthetic.doc.content[1].content=[{type:'paragraph',content:[{type:'text',text:'Тестовые размеры 0,0 см и 0,0 см.',marks:[{type:'highlight',attrs:{color:'#ffff00'}}]}]}];delete synthetic.doc.attrs.editableHighlightsVersion;synthetic.doc=initializeEditableHighlights(synthetic.doc);
 const packageBytes=p.makePackage(synthetic,[f.key],'add');let manifestBytes;let manifestRequests=0,packageRequests=0;
 server=createServer({key:await readFile(path.join(temp,'tls.key')),cert:await readFile(path.join(temp,'tls.crt'))},(req,res)=>{if(req.url==='/manifest.json'){manifestRequests++;res.end(manifestBytes);}else if(req.url==='/synthetic.xrszip'){packageRequests++;res.end(packageBytes);}else{res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`https://127.0.0.1:${server.address().port}`;
 const now=Date.now(),payload={schemaVersion:1,type:'xrs-template-catalog',catalogId:'isolated-electron-test',catalogVersion:'1.0.1',sequence:1,channel:'test',minimumXrsVersion:'0.4.84',publishedAt:new Date(now).toISOString(),expiresAt:new Date(now+86400000).toISOString(),publisher:{name:'Isolated synthetic test',keyId:f.id},packages:[{templateId:synthetic.id,templateVersion:synthetic.templateVersion,action:'add',url:origin+'/synthetic.xrszip',sha256:p.sha256(packageBytes),size:packageBytes.length,summary:'Синтетический тест двух экземпляров'}]};manifestBytes=p.bytes(p.envelope(payload,[f.key]));
 async function launch(index){const root=path.join(temp,'app-'+index);await mkdir(path.join(root,'electron'),{recursive:true});await mkdir(path.join(root,'dist'),{recursive:true});
 for(const name of await readdir('electron'))if(name.endsWith('.cjs'))await copyFile(path.join('electron',name),path.join(root,'electron',name));await copyFile('dist/index.html',path.join(root,'dist/index.html'));await writeFile(path.join(root,'package.json'),JSON.stringify({name:'xrs-isolated-template-test',version:'0.4.84',main:'electron/main.cjs'}));await writeFile(path.join(root,'electron/template-source.cjs'),'module.exports='+JSON.stringify({schemaVersion:1,enabled:true,channel:'test',manifestUrl:origin+'/manifest.json',allowedPrefixes:[origin+'/'],root:f.root})+';');
 const app=await _electron.launch({executablePath:executable,cwd:root,args:['.',`--user-data-dir=${path.join(temp,'profile-'+index)}`,'--no-sandbox','--ozone-platform=headless','--disable-gpu'],env:{...process.env,NODE_EXTRA_CA_CERTS:path.join(temp,'tls.crt')}});apps.push(app);const page=await app.firstWindow();page.on('pageerror',e=>{rendererErrors.push(e.message);console.error('RENDERER',e.stack);});await page.locator('.report-content').waitFor();return {app,page};}
 const a=await launch(1),b=await launch(2);const beforeA=await documentSnapshot(a.page),beforeB=await documentSnapshot(b.page);
 for(const {page}of[a,b]){await manager(page);await page.locator('#template-catalog-check').click();await page.getByRole('button',{name:'Установить',exact:true}).waitFor();assert.equal(packageRequests,apps.indexOf(page===a.page?a.app:b.app),'no download before confirmation');await page.getByRole('button',{name:'Установить',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#template-catalog-status')?.textContent.includes('1.0.1'));await page.locator('.dialog [data-close]').first().click();}
 assert.deepEqual(await documentSnapshot(a.page),beforeA);assert.deepEqual(await documentSnapshot(b.page),beforeB);
 const stateA=await a.page.evaluate(()=>window.desktop.templateCatalogState()),stateB=await b.page.evaluate(()=>window.desktop.templateCatalogState());assert.deepEqual(stateA.templates,stateB.templates);assert.equal(stateA.version,'1.0.1');assert.equal(packageRequests,2);
 await a.page.locator('[data-tab="templates"]').click();await a.page.locator('#area-select').selectOption('synthetic');await a.page.locator('[data-template="synthetic-catalog-test"]').click();await a.page.waitForFunction(()=>document.querySelector('.report-content')?.textContent.includes('Тестовые размеры'));
 const measurements=()=>a.page.evaluate(()=>{const e=document.querySelector('.report-content').editor,rows=[];e.state.doc.descendants((n,pos)=>{const m=n.marks.find(m=>m.type.name==='templateSize');if(m)rows.push({pos,text:n.text,...m.attrs});});return rows;});
 let sizes=await measurements();assert.equal(sizes.length,2);await a.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].focus());await a.page.bringToFront();await a.page.locator('.report-content').focus();await a.page.evaluate(pos=>{const e=document.querySelector('.report-content').editor;e.commands.setTextSelection(pos+1);e.view.dom.focus();},sizes[0].pos);await a.page.waitForFunction(()=>document.activeElement===document.querySelector('.report-content'));await a.page.keyboard.insertText('7');sizes=await measurements();assert.deepEqual(sizes.map(s=>[s.text,s.filled]),[['7',true],['0,0',false]]);await a.page.keyboard.press('Control+z');assert.deepEqual((await measurements()).map(s=>s.text),['0,0','0,0']);await a.page.keyboard.press('Control+y');assert.deepEqual((await measurements()).map(s=>s.text),['7','0,0']);
 await a.page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='Сохранено на компьютере');const saved=await documentSnapshot(a.page);
 await manager(a.page);await a.page.locator('#template-catalog-rollback').click();await a.page.getByRole('button',{name:'Подтвердить откат',exact:true}).click();await a.page.waitForFunction(()=>document.querySelector('#template-catalog-status')?.textContent.includes('встроенный каталог'));await a.page.locator('.dialog [data-close]').first().click();assert.deepEqual(await documentSnapshot(a.page),saved);assert.equal((await b.page.evaluate(()=>window.desktop.templateCatalogState())).version,'1.0.1');
 await a.app.close();apps.splice(apps.indexOf(a.app),1);const reopened=await launch(1);// Existing restore code normalizes the trailing editor paragraph's null
 // templateOriginal cache to an empty string. Compare using that same baseline
 // normalization; all visible text, fields, formatting and completion states stay exact.
 assert.deepEqual(prepareInlineDocument(await documentSnapshot(reopened.page)),prepareInlineDocument(saved),'new template document survives rollback and cold restart');
 assert.deepEqual(rendererErrors,[]);
 await writeFile(output+'/two-instances.json',JSON.stringify({status:'PASS',scope:'two actual Electron instances using local HTTPS, ephemeral test root; not GitHub publication acceptance',catalogVersion:'1.0.1',packageSha256:p.sha256(packageBytes),packageRequests,manifestRequests,activeReportPreserved:true,rollbackIsolated:true,coldRestart:true},null,2));
 console.log('PASS: two Electron instances, signed HTTPS catalog, explicit install, identical templates, independent measurements, Undo/Redo, isolated rollback, saved report after restart. GitHub publication still requires separate acceptance.');
}catch(error){for(let i=0;i<apps.length;i++){const page=(await apps[i].windows())[0];await page?.screenshot({path:`${output}/two-instances-failure-${i}.png`}).catch(()=>{});}throw error;}
finally{for(const app of apps)await app.close().catch(()=>{});if(server)await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});}
