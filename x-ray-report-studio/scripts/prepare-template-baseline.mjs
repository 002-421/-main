import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {reportTemplates,areas,makeTemplateDocument} from '../src/catalog.ts';
import {justifyDescription} from '../src/description-alignment.ts';
import {structurePreparedBuiltin} from '../src/ai-review-structure.ts';
import {initializeReportFooter} from '../src/report-footer.ts';
import {resetInlineTemplate} from '../src/inline-fields.ts';
import {initializeEditableHighlights} from '../src/template-highlights.ts';
import {sanitizeTemplateForExport} from '../src/template-sanitizer.ts';
import {validateTemplate as safeTemplate} from '../src/model.ts';
const require=createRequire(import.meta.url),p=require('../electron/template-protocol.cjs');
const output=path.resolve(process.argv[2]??'test-output/template-updates/baseline');
const records=[],images=new Set();
for(const t of reportTemplates){
 let doc=sanitizeTemplateForExport(structurePreparedBuiltin(t.id,justifyDescription(initializeReportFooter(resetInlineTemplate(makeTemplateDocument(t.id)),'дд.мм.гггг'))));
 delete doc.attrs.editableHighlightsVersion;doc=initializeEditableHighlights(doc);
 // Never distribute hidden source snapshots with personal values. Rebase only the
 // export copy; the builtin catalog and all editor behavior remain unchanged.
 const rebase=n=>{if(n.attrs?.templateOriginal!==undefined)n.attrs.templateOriginal=p.textOf(n);if(n.type==='image')images.add(p.sha256(Buffer.from(n.attrs.src)));n.content?.forEach(rebase);};rebase(doc);
 safeTemplate(doc);
 const item={id:t.id,title:t.title,areaId:t.areaId,areaTitle:areas.find(a=>a.id===t.areaId)?.title??t.areaId,modality:t.id.startsWith('ct-')?'CT':'MRI',templateVersion:t.templateVersion,minimumXrsVersion:'0.4.84',doc};
 const file=p.bytes(item);records.push({id:t.id,title:t.title,areaId:t.areaId,areaTitle:item.areaTitle,modality:item.modality,templateVersion:t.templateVersion,sha256:p.sha256(file),fields:p.structure(doc).fields.map(f=>f.id),contract:p.structure(doc)});
 await mkdir(output,{recursive:true});await writeFile(path.join(output,t.id+'.json'),file);
}
for(const t of reportTemplates){const raw=await import('node:fs/promises').then(fs=>fs.readFile(path.join(output,t.id+'.json')));p.validateTemplate(p.parse(raw),{allowedImages:[...images]});}
await writeFile(path.join(output,'baseline.json'),p.bytes({schemaVersion:1,xrsVersion:'0.4.83',xrsCommit:'49ac5638a2f911030e7687f94901c8c4b585137b',templates:records,allowedImages:[...images]}));
if(process.argv[3]){const raw=p.bytes({schemaVersion:1,templates:records,allowedImages:[...images]});await writeFile(path.resolve(process.argv[3]),process.argv[3].endsWith('.cjs')?Buffer.concat([Buffer.from("'use strict';\nmodule.exports = "),raw,Buffer.from(';\n')]):raw);}
console.log(`PASS: ${records.length} sanitized builtin templates; ${records.reduce((n,t)=>n+t.fields.length,0)} field identities. Local output only: ${output}`);
