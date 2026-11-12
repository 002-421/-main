import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('Windows packager reads and writes JSON as UTF-8 regardless of system encoding',async()=>{
 const source=await readFile(path.join(root,'scripts/package_windows.py'),'utf8');
 const reads=[...source.matchAll(/\.read_text\(([^)]*)\)/g)];
 assert.equal(reads.length,3,'all JSON metadata reads are checked');
 for(const [,options] of reads)assert.match(options,/encoding\s*=\s*['"]utf-8['"]/i);
 assert.match(source,/\},\s*indent=2\),\s*encoding=['"]utf-8['"]\)/,'generated package.json is written as UTF-8');
 assert.match(source,/write_text\(collect_licenses\(\),\s*encoding=['"]utf-8['"]\)/);

 const python=process.platform==='win32'?'python':'python3';
 const expectedVersion=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
 const result=spawnSync(python,['-c',"import json,sys; print(json.loads(open(sys.argv[1], encoding='utf-8').read())['version'])",path.join(root,'package.json')],{
  encoding:'utf8',
  env:{...process.env,PYTHONUTF8:'0',PYTHONCOERCECLOCALE:'0',LC_ALL:'C',LANG:'C'},
 });
 assert.equal(result.status,0,result.stderr);
 assert.equal(result.stdout.trim(),expectedVersion);
});

test('portable package copies every Electron CommonJS module and its local require dependencies',async()=>{
 const electronDir=path.join(root,'electron');
 const modules=(await readdir(electronDir)).filter(name=>name.endsWith('.cjs'));
 const moduleSet=new Set(modules);
 assert.ok(moduleSet.has('preload.cjs'),'BrowserWindow preload is packaged');
 for(const name of modules){
  const source=await readFile(path.join(electronDir,name),'utf8');
  for(const [,dependency] of source.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g))
   assert.ok(moduleSet.has(dependency),`${name} local dependency ${dependency} exists in the packaged module set`);
 }
 const packager=await readFile(path.join(root,'scripts/package_windows.py'),'utf8');
 assert.match(packager,/glob\('\*\.cjs'\)/,'packager copies all Electron CommonJS modules');
 assert.match(packager,/app\s*\/\s*'electron'\s*\/\s*module\.name/,'modules are copied into resources/app/electron');
});
