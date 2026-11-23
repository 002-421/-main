import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {reportTemplates,makeTemplateDocument} from '../src/catalog.ts';
import {resetInlineTemplate} from '../src/inline-fields.ts';
import {editableHighlightStructure,textOf,initializeEditableHighlights} from '../src/template-highlights.ts';
const rows=[];
for(const template of reportTemplates){
 const original=makeTemplateDocument(template.id),structured=initializeEditableHighlights(original);
 assert.equal(textOf(structured),textOf(original));
 const contract=editableHighlightStructure(resetInlineTemplate(original));
 rows.push({id:template.id,templateVersion:template.templateVersion,sourceSha256:createHash('sha256').update(JSON.stringify(template)).digest('hex'),paragraphPrompts:contract.paragraphs.length,measurementPrompts:contract.sizes.length,nativeFieldIds:contract.fields.map(f=>f.id),status:'PASS'});
}
await mkdir('test-output/editable-highlights',{recursive:true});
await writeFile('test-output/editable-highlights/catalog-audit.json',JSON.stringify({schemaVersion:1,coverage:'automated structure/content/ID audit; not manual clinical verification',count:rows.length,templates:rows},null,2)+'\n');
console.log(`PASS: ${rows.length} templates audited; ${rows.reduce((n,r)=>n+r.paragraphPrompts,0)} paragraph prompts; ${rows.reduce((n,r)=>n+r.measurementPrompts,0)} measurement prompts.`);
