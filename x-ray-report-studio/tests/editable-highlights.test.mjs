import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {TextStyleKit} from '@tiptap/extension-text-style';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {TemplateHighlight,TemplateSize,TemplateField,SourceFormat,InlineFieldEditing,resetInlineTemplate,prepareInlineDocument} from '../src/inline-fields.ts';
import {initializeEditableHighlights,editableHighlightStructure,textOf} from '../src/template-highlights.ts';
import {reportHistoryPlugin,runReportHistoryCommand,getReportHistory,restoreReportHistory} from '../src/report-history.ts';
import {reportTemplates,makeTemplateDocument} from '../src/catalog.ts';
import {validateTemplate} from '../src/model.ts';
import {exportDocx,importOwnDocx} from '../src/docx.ts';
import {unzipSync,strFromU8} from 'fflate';
const schema=getSchema([StarterKit,TextStyleKit,SourceFormat,TemplateField,TemplateHighlight,TemplateSize]);
const yellow={type:'highlight',attrs:{color:'#ffff00'}};
const paragraph=(text,marks=[yellow])=>({type:'paragraph',content:[{type:'text',text,marks}]});
const fixture=()=>resetInlineTemplate({type:'doc',content:[paragraph('Антелистез L на 0,0 см и 0,00 см, ещё 0,0 см.'),paragraph('Соседний абзац 0,0 см.'),paragraph('Обычное число 0,0.',[])]});
function viewFor(doc=fixture()) {
 const view={state:EditorState.create({schema,doc:schema.nodeFromJSON(doc),plugins:[...InlineFieldEditing.config.addProseMirrorPlugins.call(InlineFieldEditing),reportHistoryPlugin()]})};
 view.focus=()=>{}; view.dispatch=tr=>{view.state=view.state.applyTransaction(tr).state;};return view;
}
const sizes=state=>{const rows=[];state.doc.descendants((node,pos)=>{const m=node.marks.find(m=>m.type.name==='templateSize');if(m)rows.push({pos,text:node.text,...m.attrs});});return rows;};
const countParagraphMarks=state=>{let n=0;state.doc.descendants(node=>{if(node.marks.some(m=>m.type.name==='templateHighlight'))n++;});return n;};
const insert=(view,pos,text)=>view.dispatch(view.state.tr.insertText(text,pos));
const input=(view,from,text,paste=false)=> {
 view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,from)));
 const plugin=view.state.plugins.find(p=>p.props.handleTextInput);
 return paste?plugin.props.handlePaste(view,{clipboardData:{getData:()=>text}}):plugin.props.handleTextInput(view,from,from,text);
};

test('all 113 templates: deterministic structural preparation preserves text, native fields and formatting; source catalogs remain untouched',()=>{
 assert.equal(reportTemplates.length,113);
 for(const template of reportTemplates){
  const original=makeTemplateDocument(template.id), before=JSON.stringify(original);
  const prepared=initializeEditableHighlights(original), repeated=initializeEditableHighlights(original);
  assert.equal(textOf(prepared),textOf(original),template.id);
  assert.deepEqual(prepared,repeated,`${template.id}: deterministic IDs`);
  assert.equal(JSON.stringify(original),before,`${template.id}: source untouched`);
  assert.deepEqual(initializeEditableHighlights(prepared),prepared,`${template.id}: idempotent`);
  const structure=editableHighlightStructure(prepared);
  assert.deepEqual(structure.fields,editableHighlightStructure(original).fields,`${template.id}: native field identities unchanged`);
  const withoutSystem=node=>{const copy=JSON.parse(JSON.stringify(node));const walk=n=>{if(n.attrs){delete n.attrs.editableHighlight;delete n.attrs.editableHighlightsVersion;if(!Object.keys(n.attrs).length)delete n.attrs;}if(n.marks){n.marks=n.marks.filter(m=>!['templateHighlight','templateSize'].includes(m.type)&&!(m.type==='highlight'&&/^(#ffff00|yellow)$/i.test(String(m.attrs?.color??''))));if(!n.marks.length)delete n.marks;}if(n.content){n.content.forEach(walk);n.content=n.content.reduce((rows,child)=>{const prior=rows.at(-1);if(child.type==='text'&&prior?.type==='text'&&JSON.stringify(prior.marks)===JSON.stringify(child.marks))prior.text+=child.text;else rows.push(child);return rows;},[]);}};walk(copy);return copy;};
  assert.deepEqual(withoutSystem(prepared),withoutSystem(original),`${template.id}: all non-system text and formatting unchanged`);
  assert.equal(new Set(structure.paragraphs).size,structure.paragraphs.length,template.id);
  assert.equal(new Set(structure.sizes.map(s=>s.id)).size,structure.sizes.length,template.id);
  assert.deepEqual(editableHighlightStructure(validateTemplate(prepared)),structure,`${template.id}: serialized template contract`);
 }
});
test('text edit clears only its paragraph and leaves every independent unfilled size and neighboring paragraph',()=>{
 const v=viewFor(),before=countParagraphMarks(v.state);
 v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc,3)));
 assert.equal(countParagraphMarks(v.state),before,'cursor does not complete prompt');
 insert(v,13,'5');
 assert.equal(v.state.doc.child(0).attrs.editableHighlight.edited,true);
 assert.equal(v.state.doc.child(1).attrs.editableHighlight.edited,false);
 assert.equal(sizes(v.state).filter(s=>!s.filled).length,4);
 assert.ok(!v.state.doc.child(0).content.content.some(n=>n.marks.some(m=>m.type.name==='templateHighlight')));
 const saved=v.state.doc.toJSON();
 assert.deepEqual(prepareInlineDocument(saved).content.map(p=>p.attrs?.editableHighlight),saved.content.map(p=>p.attrs?.editableHighlight));
 assert.deepEqual(viewFor(prepareInlineDocument(saved)).state.doc.toJSON(),saved);
});
test('first/middle/last measurement replacement and paste do not append zeros or complete adjacent measurements',()=>{
 for(const at of [0,1,2]){
  const v=viewFor();const range=sizes(v.state)[at];
  assert.equal(input(v,range.pos+1,'0,50',at===1),true);
  const after=sizes(v.state);
  assert.equal(after[at].text,'0,50');assert.equal(after[at].filled,true);
  assert.equal(after.filter(s=>!s.filled).length,3);
  assert.equal(v.state.doc.child(0).attrs.editableHighlight.edited,true);
  assert.match(v.state.doc.textContent,/см/);
 }
});
test('ordinary literal 0,0 and manual yellow never become measurement fields in saved reports',()=>{
 const raw={type:'doc',content:[paragraph('0,0 и реальное значение',[{type:'textStyle',attrs:{backgroundColor:'#ffff00'}}])]};
 assert.equal(editableHighlightStructure(resetInlineTemplate(raw)).sizes.length,0);
 assert.equal(editableHighlightStructure(prepareInlineDocument({type:'doc',content:[paragraph('0,0')]})).sizes.length,0);
 const v=viewFor();assert.equal(input(v,v.state.doc.content.size-10,'7'),false);
});
test('deletion clears paragraph fill, formatting does not; manual background survives automatic cleanup',()=>{
 const v=viewFor();const before=countParagraphMarks(v.state);
 v.dispatch(v.state.tr.addMark(1,10,schema.marks.textStyle.create({backgroundColor:'#bcebff'})));
 assert.equal(v.state.doc.child(0).attrs.editableHighlight.edited,false);
 v.dispatch(v.state.tr.delete(2,3));
 assert.equal(v.state.doc.child(0).attrs.editableHighlight.edited,true);
 assert.ok(v.state.doc.child(0).firstChild.marks.some(m=>m.type.name==='textStyle'&&m.attrs.backgroundColor==='#bcebff'));
 assert.equal(sizes(v.state).filter(s=>!s.filled).length,4);
});
test('DOCX keeps independent system state in custom XML and renders only pending sizes after paragraph edit',async()=>{
 const v=viewFor();insert(v,13,'5');
 const blob=await exportDocx(v.state.doc.toJSON());const bytes=new Uint8Array(await blob.arrayBuffer());
 const loaded=await importOwnDocx(bytes);
 assert.deepEqual(loaded.doc,JSON.parse(JSON.stringify(v.state.doc.toJSON())));
 const xml=strFromU8(unzipSync(bytes)['word/document.xml']);
 assert.ok(xml.includes('FFFF00'));
 assert.ok(xml.includes('0,00'));
});

test('Undo/Redo atomically restores paragraph and measurement state, including serialized history',()=>{
 const v=viewFor(),before=JSON.stringify(v.state.doc.toJSON()),range=sizes(v.state)[1];
 input(v,range.pos+1,'8');const after=JSON.stringify(v.state.doc.toJSON()),history=JSON.parse(JSON.stringify(getReportHistory(v.state)));
 assert.equal(runReportHistoryCommand(v,'undo'),true);assert.equal(JSON.stringify(v.state.doc.toJSON()),before);
 assert.equal(runReportHistoryCommand(v,'redo'),true);assert.equal(JSON.stringify(v.state.doc.toJSON()),after);
 const reopened=viewFor(JSON.parse(after));restoreReportHistory(reopened,history);
 assert.equal(runReportHistoryCommand(reopened,'undo'),true);assert.equal(JSON.stringify(reopened.state.doc.toJSON()),before);
});
test('Enter and joining paragraphs clear touched paragraph states; deletion never removes unrelated text',()=>{
 const v=viewFor();v.dispatch(v.state.tr.split(12));
 assert.ok(v.state.doc.child(0).attrs.editableHighlight.edited);
 assert.ok(v.state.doc.child(1).attrs.editableHighlight.edited);
 assert.equal(sizes(v.state).filter(s=>!s.filled).length,4);
 assert.equal(v.state.doc.lastChild.textContent,'Обычное число 0,0.');
});
test('styled split measurement remains a single structurally identified prompt',()=>{
 const raw={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Размер 0,',marks:[yellow]},{type:'text',text:'00 см',marks:[yellow,{type:'bold'}]}]}]};
 const doc=initializeEditableHighlights(raw),v=viewFor(doc),range=sizes(v.state)[0];
 assert.equal(editableHighlightStructure(doc).sizes.length,1);
 input(v,range.pos+1,'3');assert.equal(v.state.doc.textContent,'Размер 3 см');
});

test('rich copied pending prompts keep new IDs and clear even when pasted as inline text without paragraph metadata',()=>{
 const v=viewFor(), plugin=v.state.plugins.find(p=>p.props.transformPasted);
 const original=v.state.doc.child(0),fragment=original.content;
 const copied=plugin.props.transformPasted({content:fragment,openStart:0,openEnd:0});
 const before=original.firstChild.marks.find(m=>m.type.name==='templateHighlight').attrs.id;
 const after=copied.content.firstChild.marks.find(m=>m.type.name==='templateHighlight').attrs.id;
 assert.notEqual(after,before);
 const target=schema.nodes.doc.create(null,[schema.nodes.paragraph.create(null,copied.content)]);
 const pasted=viewFor(target.toJSON());insert(pasted,2,'X');
 assert.equal(countParagraphMarks(pasted.state),0);
 assert.equal(sizes(pasted.state).filter(s=>!s.filled).length,3);
});
