import test from 'node:test';import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';import StarterKit from '@tiptap/starter-kit';import {TextStyleKit} from '@tiptap/extension-text-style';import {EditorState,TextSelection} from '@tiptap/pm/state';import {Slice} from '@tiptap/pm/model';
import {SourceFormat,TemplateField,TemplateSize,TemplateHighlight} from '../src/inline-fields.ts';
import {fontPoints,selectionFontSize,paragraphStyle,selectionIndent,FIRST_LINE_INDENTS} from '../src/document-typography.ts';import {ExternalPaste} from '../src/external-paste.ts';
const schema=getSchema([StarterKit,TextStyleKit,SourceFormat,TemplateField,TemplateSize,TemplateHighlight]);
const para=(text,fontSizePt=11,marks=[],attrs={})=>({type:'paragraph',attrs:{fontSizePt,...attrs},content:[{type:'text',text,marks}]});
function state(content,from=1,to=from){const doc=schema.nodeFromJSON({type:'doc',attrs:{fontSizePt:11,fontFamily:'Arial',lineHeight:1.05},content});return EditorState.create({schema,doc,selection:TextSelection.create(doc,from,to)});}
test('font selection resolves paragraph inheritance, px/pt, mixed values and stored insertion formatting',()=>{
 assert.equal(fontPoints('12pt'),12);assert.equal(fontPoints('16px'),12);assert.equal(fontPoints('14.66667px'),11);assert.equal(fontPoints('url(x)'),undefined);
 const s=state([para('AAA',11),para('BBB',12)],6,9);assert.equal(selectionFontSize(s),12);assert.equal(selectionFontSize(s.apply(s.tr.setSelection(TextSelection.create(s.doc,1,9)))),'mixed');
 const inline=state([para('ABC',11,[{type:'textStyle',attrs:{fontSize:'12pt'}}])],1,4);assert.equal(selectionFontSize(inline),12);
 const caret=state([para('ABC')],2);assert.equal(selectionFontSize(caret.apply(caret.tr.setStoredMarks([schema.marks.textStyle.create({fontSize:'17.33333px'})]))),13);
});
test('paste styles use current paragraph/document settings and never import external colors or fills',()=>{
 let s=state([para('BEFORE AFTER',13,[],{fontFamily:'Calibri',firstLineIndentPt:FIRST_LINE_INDENTS[2],lineHeight:1.5,spaceBeforePt:6,spaceAfterPt:12,textAlign:'justify'}),para('NEIGHBOR',14)],8),neighbor=s.doc.child(1).toJSON();
 const view={get state(){return s;},dispatch:tr=>{s=s.apply(tr);}};const plugin=ExternalPaste.config.addProseMirrorPlugins.call(ExternalPaste)[0];
 const event={clipboardData:{getData:type=>type==='text/plain'?'Первый абзац\r\nВторой абзац':'<p style="font-size:40pt;background:red">foreign</p>'}};
 assert.equal(plugin.props.handlePaste(view,event,Slice.empty),true);assert.equal(s.doc.textContent,'BEFORE Первый абзацВторой абзацAFTERNEIGHBOR');assert.deepEqual(s.doc.lastChild.toJSON(),neighbor);
 for(let i=0;i<2;i++){const p=s.doc.child(i);assert.equal(p.attrs.firstLineIndentPt,FIRST_LINE_INDENTS[2]);assert.equal(p.attrs.lineHeight,1.5);assert.equal(p.attrs.fontSizePt,13);}
 const pasted=[];s.doc.descendants(n=>{if(n.isText&&/[ПВ]/.test(n.text))pasted.push(n);});assert.ok(pasted.length);for(const n of pasted){const m=n.marks.find(m=>m.type.name==='textStyle');assert.equal(m.attrs.fontFamily,'Calibri');assert.equal(fontPoints(m.attrs.fontSize),13);assert.equal(m.attrs.backgroundColor,null);assert.equal(m.attrs.color,'#000000');assert.ok(!n.marks.some(m=>['templateField','templateSize','highlight'].includes(m.type.name)));}
});
test('internal field clipboard retains the established parser while match-style paste normalizes it',()=>{
 let s=state([para('ABC')]);const view={get state(){return s;},dispatch:tr=>s=s.apply(tr)},plugin=ExternalPaste.config.addProseMirrorPlugins.call(ExternalPaste)[0],event={clipboardData:{getData:t=>t==='text/html'?'<span data-template-size="">0,0</span>':'0,0'}};
 assert.equal(plugin.props.handlePaste(view,event,Slice.empty),false);plugin.props.handleKeyDown(view,{ctrlKey:true,shiftKey:true,code:'KeyV',key:'v'});assert.equal(plugin.props.handlePaste(view,event,Slice.empty),true);assert.equal(s.doc.textContent,'0,0ABC');
});
test('indent selection reports mixed values without changing text or source metadata',()=>{const s=state([para('AAA',11,[],{firstLineIndentPt:0}),para('BBB',11,[],{firstLineIndentPt:FIRST_LINE_INDENTS[1]})],1,9);assert.equal(selectionIndent(s),'mixed');assert.equal(s.doc.textContent,'AAABBB');});
