import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {exportTemplateDocx,inspectTemplateDocx,sha256Doc} from '../src/template-docx.ts';
import {reportTemplates,makeTemplateDocument} from '../src/catalog.ts';
import {editableHighlightStructure} from '../src/template-highlights.ts';
import {sanitizeTemplateForExport} from '../src/template-sanitizer.ts';
import {assertTemplateFieldContinuity} from '../src/template-integration.ts';
import {manualFillColor} from '../src/report-format-options.ts';
const bytes=async blob=>new Uint8Array(await blob.arrayBuffer());
test('eight DOCX template exports preserve all 40 original native field IDs and carry structure/provenance',async()=>{
 for(const t of reportTemplates.filter(t=>['spine-shop','spine-shop-m','spine-shop-art','spine-gop','spine-gop-m','spine-pop','spine-pop-m','spine-kkop'].includes(t.id))){
  const item={...t,doc:makeTemplateDocument(t.id)},source=await bytes(await exportTemplateDocx(item,'0.4.83'));
  const row=await inspectTemplateDocx(source,[item]);
  assert.equal(row.status,'unchanged');
  assert.deepEqual(editableHighlightStructure(row.after).fields.map(f=>f.id),editableHighlightStructure(item.doc).fields.map(f=>f.id),t.id);
  assert.equal(row.sourceSha256,createHash('sha256').update(source).digest('hex'));
  assert.equal(row.baseSha256,await sha256Doc(sanitizeTemplateForExport(item.doc)));
  const files=unzipSync(source);files['word/document.xml']=strToU8(strFromU8(files['word/document.xml']).replace(/(<w:t(?:\s[^>]*)?>)([^<]+)/,'$1Уточнено $2'));
  // Special fields in arbitrary edited Word XML cannot be guessed by matching prose.
  await assert.rejects(inspectTemplateDocx(zipSync(files),[item]),/templateField|служебных разделов/,t.id);
 }
});
test('fields may be split into style runs without changing identity; missing or new IDs are rejected',()=>{
 const field=id=>({type:'text',text:'Значение',marks:[{type:'templateField',attrs:{id,hint:'Значение',original:'Значение',filled:false}}]});
 const doc=content=>({type:'doc',content:[{type:'paragraph',content}]});
 assert.doesNotThrow(()=>assertTemplateFieldContinuity(doc([field('same')]),doc([field('same'),field('same')])));
 assert.throws(()=>assertTemplateFieldContinuity(doc([field('same')]),doc([field('other')])),/Отсутствуют ID: same; новые ID: other/);
});
test('manual fill recognizes equivalent persisted CSS colors without confusing system marks',()=>{
 for(const value of ['#FFFF00','#ff0','yellow','rgb(255, 255, 0)'])assert.equal(manualFillColor(value),'#ffff00');
 assert.equal(manualFillColor('url(secret)'),undefined);
});

test('an edited Word file may not lose existing structural highlight IDs',()=>{
 const original={type:'doc',content:[{type:'paragraph',attrs:{editableHighlight:{id:'original',original:'Размер',edited:false}},content:[{type:'text',text:'Размер',marks:[{type:'templateHighlight',attrs:{id:'original'}}]}]}]};
 const flattened={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Размер'}]}]};
 assert.throws(()=>assertTemplateFieldContinuity(original,flattened),/системных ID/);
});
test('new approved yellow in a Word edit receives structural state even if the previous empty contract was version 1',async()=>{
 const item={id:'safe-flat',title:'Synthetic',areaId:'other',doc:{type:'doc',attrs:{editableHighlightsVersion:1},content:[{type:'paragraph',content:[{type:'text',text:'Размер 0,0 см'}]}]}};
 const files=unzipSync(await bytes(await exportTemplateDocx(item,'0.4.83')));
 const xml=strFromU8(files['word/document.xml']);
 files['word/document.xml']=strToU8(xml.replace('<w:r>','<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr>'));
 const row=await inspectTemplateDocx(zipSync(files),[item]);
 assert.equal(row.status,'changed');
 const structure=editableHighlightStructure(row.after);
 assert.equal(structure.paragraphs.length,1);assert.equal(structure.sizes.length,1);
 assert.equal(row.after.content[0].content.some(node=>node.marks?.some(mark=>mark.type==='highlight')),false);
});
