import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {reportTemplates,makeTemplateDocument,applyTemplateCatalog,templateAvailable} from '../src/catalog.ts';
import {editableHighlightStructure,textOf} from '../src/template-highlights.ts';
import {fixture} from './helpers/template-fixture.mjs';
import p from '../electron/template-protocol.cjs';
const baseline=createRequire(import.meta.url)('../electron/template-baseline.cjs');
test('all 113 package roundtrips preserve exact structured data, IDs, native fields, manual formatting and independent measurements',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'xrs-catalog-baseline-'));t.after(()=>rm(directory,{recursive:true,force:true}));execFileSync(process.execPath,['scripts/prepare-template-baseline.mjs',directory],{stdio:'pipe'});const f=fixture();let nativeSpine=0,paragraphs=0,sizes=0;
 assert.equal(baseline.templates.length,113);for(const row of baseline.templates){const template=p.parse(await readFile(path.join(directory,row.id+'.json')));assert.equal(p.sha256(p.bytes(template)),row.sha256,row.id);p.validateTemplate(template,{allowedImages:baseline.allowedImages});assert.deepEqual(p.structure(template.doc),row.contract,row.id);
 const raw=p.makePackage(template,[f.key]),entry={templateId:template.id,templateVersion:template.templateVersion,action:'update',size:raw.length,sha256:p.sha256(raw)};const decoded=p.readPackage(raw,entry,f.root,{appVersion:'0.4.84',channel:'test',allowedImages:baseline.allowedImages});assert.deepEqual(decoded,template,row.id);const structure=editableHighlightStructure(decoded.doc);paragraphs+=structure.paragraphs.length;sizes+=structure.sizes.length;
 if(['spine-shop','spine-shop-m','spine-shop-art','spine-gop','spine-gop-m','spine-pop','spine-pop-m','spine-kkop'].includes(template.id))nativeSpine+=structure.fields.length;
 assert.equal(new Set(structure.sizes.map(s=>s.id)).size,structure.sizes.length,row.id);
 }assert.equal(nativeSpine,40);assert.ok(paragraphs>=988);assert.ok(sizes>=735);
});
test('effective catalog replaces only selected snapshots; old document objects and builtins remain unchanged on rollback',()=>{
 const before=structuredClone(reportTemplates),saved=makeTemplateDocument(),savedText=textOf(saved),f=fixture(),item=f.template('synthetic-catalog-template');
 try{applyTemplateCatalog([item]);assert.equal(reportTemplates.length,before.length+1);assert.deepEqual(makeTemplateDocument(item.id),item.doc);assert.equal(textOf(saved),savedText);for(const row of before)assert.deepEqual(reportTemplates.find(t=>t.id===row.id),row);
 applyTemplateCatalog([]);assert.equal(templateAvailable(item.id),false);assert.equal(textOf(saved),savedText);for(const row of before)assert.deepEqual(reportTemplates.find(t=>t.id===row.id),row);
 }finally{applyTemplateCatalog([]);}
});
