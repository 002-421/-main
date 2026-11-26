import type {Editor} from '@tiptap/core';
import {manualFillColor} from './report-format-options.ts';
export const LOCAL_FIELD_PREFIX='local.editable.';
/** Explicit creation only. No color-based inference on restore or document opening. */
export function createEditableField(editor:Editor):'paragraph'|'measurement'|'text'{
 const {state}=editor,{from,to,$from,$to}=state.selection,parent=$from.parent;
 if(from===to||!parent.isTextblock||!$from.sameParent($to))throw Error('Выделите текст одного абзаца или отдельный размер 0,0.');
 const text=state.doc.textBetween(from,to,'','\n');if(!text.trim())throw Error('Выделите непустой текст.');
 const whole=from===$from.start()&&to===$from.end(),numeric=/^0,0+$/.test(text);
 const fields=new Set<string>(),measurements=new Set<string>();
 state.doc.nodesBetween(from,to,n=>{if(n.isAtom&&!n.isText)throw Error('Поле не может включать служебный объект или разрыв строки.');for(const m of n.marks){if(m.type.name==='templateField')fields.add(m.attrs.id);if(m.type.name==='templateSize')measurements.add(m.attrs.id);}});
 if([...fields].some(id=>!id.startsWith(LOCAL_FIELD_PREFIX)))throw Error('Исходные служебные поля нельзя переназначать этой командой.');
 if(fields.size>1)throw Error('Выделите одно поле отдельно; соседние поля не объединяются.');
 if(fields.size&&numeric)throw Error('Выделение пересекает текстовое поле. Не меняйте его тип без отдельного редактирования.');
 if(!whole&&!numeric&&(measurements.size||/0,0+/.test(text)))throw Error('Выделите весь абзац с размерами либо один размер 0,0 отдельно.');
 if(!whole&&!numeric&&text.length>2000)throw Error('Текстовое поле ограничено 2000 символами.');
 let tr=state.tr;const fieldId=[...fields][0];
 if(fieldId){let start=Infinity,end=-Infinity;state.doc.descendants((n,p)=>{if(n.isText&&n.marks.some(m=>m.type.name==='templateField'&&m.attrs.id===fieldId)){start=Math.min(start,p);end=Math.max(end,p+n.nodeSize);}});if(from!==start||to!==end)throw Error('Выделите только существующее поле целиком.');}
 // Explicit command replaces selected manual yellow; unrelated manual fill stays ordinary.
 state.doc.nodesBetween(from,to,(n,pos)=>{if(!n.isText)return;const start=Math.max(from,pos),end=Math.min(to,pos+n.nodeSize);for(const m of n.marks){if(m.type.name==='highlight'&&manualFillColor(m.attrs.color)==='#ffff00')tr.removeMark(start,end,m);if(m.type.name==='textStyle'&&manualFillColor(m.attrs.backgroundColor)==='#ffff00'){tr.removeMark(start,end,m);tr.addMark(start,end,m.type.create({...m.attrs,backgroundColor:null}));}}});
 const size=(start:number,end:number,original:string)=>{const ids=new Set<string>();state.doc.nodesBetween(start,end,n=>{for(const m of n.marks)if(m.type.name==='templateSize')ids.add(m.attrs.id);});if(ids.size>1)throw Error('Размер пересекает несколько независимых полей.');const id=[...ids][0]??'measurement.manual.'+crypto.randomUUID();let outside=false;state.doc.descendants((n,p)=>{if(n.isText&&n.marks.some(m=>m.type.name==='templateSize'&&m.attrs.id===id)&&(p<start||p+n.nodeSize>end))outside=true;});if(outside)throw Error('Выделите существующий размер целиком.');tr.addMark(start,end,state.schema.marks.templateSize.create({id,original,filled:false}));};
 let kind:'paragraph'|'measurement'|'text';
 if(numeric){size(from,to,text);kind='measurement';}
 else if(whole&&!fieldId){const id=parent.attrs.editableHighlight?.id??'editable.manual.'+crypto.randomUUID();tr.setNodeMarkup($from.before(),undefined,{...parent.attrs,editableHighlight:{id,original:parent.textContent,edited:false}});tr.addMark(from,to,state.schema.marks.templateHighlight.create({id}));for(const match of text.matchAll(/(?<![\d,])0,0+(?![\d,])/g))size(from+match.index!,from+match.index!+match[0].length,match[0]);kind='paragraph';}
 else {const id=fieldId??LOCAL_FIELD_PREFIX+crypto.randomUUID();tr.addMark(from,to,state.schema.marks.templateField.create({id,hint:text,original:text,filled:false}));kind='text';}
 editor.view.dispatch(tr.setMeta('uiEvent','template-field').scrollIntoView());return kind;
}
