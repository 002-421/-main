// Explicit MOCK OAuth for local authoring regression. Real main/IPC/files remain.
import {mkdir,readdir,copyFile,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
export async function ownerRuntime(root){
 await mkdir(path.join(root,'electron'),{recursive:true});await mkdir(path.join(root,'dist'),{recursive:true});
 for(const file of await readdir('electron'))if(file.endsWith('.cjs'))await copyFile(path.join('electron',file),path.join(root,'electron',file));
 await copyFile('dist/index.html',path.join(root,'dist/index.html'));
 const version=JSON.parse(await readFile('package.json','utf8')).version;await writeFile(path.join(root,'package.json'),JSON.stringify({name:'xrs-isolated-owner-fixture',version,main:'electron/main.cjs'}));
 await writeFile(path.join(root,'electron/github-desktop-auth.cjs'),`exports.createDesktopAuth=()=>({status:async()=>({connected:true,configured:true,scopes:['synthetic']}),transport:{authorize:async()=>({login:'002-421',id:210672295}),api:async(method,route)=>{if(method!=='GET')throw Object.assign(Error('MOCK_WRITE_FORBIDDEN'),{code:'MOCK_WRITE_FORBIDDEN'});if(route==='/user')return {login:'002-421',id:210672295,type:'User'};if(route==='/repos/002-421/XRS-Templates')return {full_name:'002-421/XRS-Templates',permissions:{push:true}};if(route.startsWith('/repos/002-421/XRS-Templates/releases?'))return [];throw Error('UNEXPECTED_MOCK_ROUTE');}}});`);
 return root;
}
export async function chooseTheme(page,theme){await page.locator('#settings').click();const section=page.locator('[data-settings-section=appearance]');await section.locator('summary').click();await page.selectOption('#interface-theme',theme);await page.locator('.dialog [data-close]').first().click();}
