/** Compare exact catalog entries without logging medical or patient content. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const [baselinePath,candidatePath,output]=process.argv.slice(2);
if(!baselinePath||!candidatePath||!output)throw Error('Usage: node scripts/compare-template-catalogs.mjs baseline.json candidate.json diff.json');
const canonical=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const hash=t=>createHash('sha256').update(canonical(t)).digest('hex');
const load=async p=>{const data=JSON.parse(await readFile(p,'utf8'));const rows=Array.isArray(data)?data:data.templates;if(!Array.isArray(rows))throw Error('Catalog templates are required');const ids=rows.map(t=>t.id);if(ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw Error('Catalog has invalid or duplicate IDs');return new Map(rows.map(t=>[t.id,t]));};
const a=await load(baselinePath),b=await load(candidatePath);
const ids=[...new Set([...a.keys(),...b.keys()])].sort();
const rows=ids.map(id=>({id,before:a.has(id)?hash(a.get(id)):null,after:b.has(id)?hash(b.get(id)):null})).map(row=>({...row,status:!row.before?'added':!row.after?'removed':row.before===row.after?'unchanged':'changed'}));
await writeFile(output,JSON.stringify({format:'xrs-catalog-diff',schemaVersion:1,templates:rows},null,2)+'\n');
console.log(JSON.stringify(Object.fromEntries(['added','removed','unchanged','changed'].map(status=>[status,rows.filter(r=>r.status===status).length]))));
