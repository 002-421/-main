// Compile a reviewed backend snapshot into one packaged CommonJS component.
// Medical source data are embedded verbatim; no private key or auth is copied.
import {build} from 'esbuild';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const source=path.resolve(process.argv[2]??'');
if(!process.argv[2])throw Error('Usage: node scripts/sync-template-publisher.mjs <reviewed XRS-Templates checkout>');
const baseline=JSON.parse(await readFile(path.join(source,'baseline.json'),'utf8'));
const templates=[];for(const name of (await readdir(path.join(source,'sources'))).filter(n=>n.endsWith('.json')).sort())templates.push(JSON.parse(await readFile(path.join(source,'sources',name),'utf8')));
const schemas=[];for(const name of (await readdir(path.join(source,'schemas'))).filter(n=>n.endsWith('.json')).sort())schemas.push(JSON.parse(await readFile(path.join(source,'schemas',name),'utf8')));
const output=path.resolve('electron/template-publisher-runtime.cjs');
await build({absWorkingDir:source,entryPoints:[path.join(source,'scripts/simple-publisher-admin.cjs')],outfile:output,bundle:true,platform:'node',format:'cjs',target:'node24',legalComments:'inline',plugins:[{name:'embedded-reviewed-sources',setup(builder){
 builder.onLoad({filter:/[/\\]scripts[/\\]validate\.cjs$/},async args=>{
  let code=await readFile(args.path,'utf8');
  const start=code.indexOf('async function schemas()'),end=code.indexOf('function checkPrivacy');
  if(start<0||end<0)throw Error('Backend loader changed; review sync integration.');
  code=code.slice(0,start)+`async function schemas(){const ajv=new Ajv({strict:true,allErrors:true});for(const schema of ${JSON.stringify(schemas)})ajv.addSchema(schema);return ajv;}\nasync function loadSources(){return {baseline:${JSON.stringify(baseline)},sources:new Map(${JSON.stringify(templates)}.map(t=>[t.id,t]))};}\n`+code.slice(end);
  return {contents:code,loader:'js',resolveDir:path.dirname(args.path)};
 });
}}]});
const bytes=await readFile(output,'utf8'),sha256=createHash('sha256').update(bytes.replaceAll('\r\n','\n')).digest('hex');
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
const provenance={protocolVersion:2,repository:'002-421/XRS-Templates',commit,sha256,sourceTemplates:templates.length};
await writeFile('electron/template-publisher-provenance.cjs',"'use strict';\nmodule.exports = "+JSON.stringify(provenance)+";\n");
const notices=[];
for(const name of ['ajv','fast-deep-equal','fast-uri','json-schema-traverse','require-from-string']){
 const directory=path.join(source,'node_modules',name),metadata=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'));
 const license=(await readdir(directory)).find(file=>/^licen[sc]e(?:\.txt|\.md)?$/i.test(file));
 if(!license)throw Error('Publisher dependency license missing: '+name);
 notices.push(`${metadata.name} ${metadata.version}\n${(await readFile(path.join(directory,license),'utf8')).replaceAll('\r\n','\n').trim()}\n`);
}
await writeFile('public/template-publisher-LICENSE.txt',notices.join('\n'));
console.log(`Publisher snapshot ${commit}: ${templates.length} templates; runtime SHA-256 ${sha256}`);

await writeFile('electron/template-simple-catalog.cjs',await readFile(path.join(source,'scripts/lib/simple-catalog.cjs')));
await writeFile('electron/template-protocol.cjs',await readFile(path.join(source,'scripts/lib/template-protocol.cjs')));
