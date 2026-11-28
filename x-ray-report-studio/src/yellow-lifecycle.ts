import type {Editor} from '@tiptap/core';
import type {RichNode} from './model.ts';
import {createEditableField} from './editable-field-command.ts';
import {manualFillColor} from './report-format-options.ts';
const plainMarks=(marks:NonNullable<RichNode['marks']>)=>marks.filter(m=>m.type!=='highlight'||manualFillColor(m.attrs?.color)!=='#ffff00').map(m=>m.type==='textStyle'&&manualFillColor(m.attrs?.backgroundColor)==='#ffff00'?{...m,attrs:{...m.attrs,backgroundColor:null}}:m);
const hash=(text:string)=>{let n=2166136261;for(const c of text)n=Math.imul(n^c.charCodeAt(0),16777619);return(n>>>0).toString(16);};
/** Migrate only formerly manual yellow. Never rearm an already typed filled field. */
export function migrateManualYellow(doc:RichNode):RichNode{
 const eligible=(n:RichNode)=>n.type==='text'&&!n.marks?.some(m=>['templateField','templateSize','templateHighlight'].includes(m.type))&&n.marks?.some(m=>m.type==='textStyle'&&manualFillColor(m.attrs?.backgroundColor)==='#ffff00');
 const walk=(node:RichNode,path:string)=>{if(!node.content)return;const result:RichNode[]=[];
  for(let i=0;i<node.content.length;){const n=node.content[i];if(!eligible(n)){walk(n,path+'.'+i);result.push(n);i++;continue;}
   const start=i,run:RichNode[]=[];while(i<node.content.length&&eligible(node.content[i]))run.push(node.content[i++]);const text=run.map(n=>n.text??'').join('');
   let offset=0;const spans=run.map(n=>{const from=offset;offset+=(n.text??'').length;return {node:n,from,to:offset};});
   for(const [j,match]of [...text.matchAll(/0,0+|(?:(?!0,0+)[\s\S])+/g)].entries()){const value=match[0],from=match.index!,to=from+value.length,id=path+'.'+start+'.'+j+'.'+hash(value),numeric=/^0,0+$/.test(value);
    for(const span of spans){const a=Math.max(from,span.from),b=Math.min(to,span.to);if(a>=b)continue;result.push({...span.node,text:text.slice(a,b),marks:[...plainMarks(span.node.marks??[]),{type:numeric?'templateSize':'templateField',attrs:numeric?{id:'measurement.manual.legacy.'+id,original:value,filled:false}:{id:'local.editable.legacy.'+id,hint:value,original:value,filled:false}}]});}
   }
  }node.content=result;
 };walk(doc,'yellow');return doc;
}
export function markSelectionYellow(editor:Editor){
 try{return createEditableField(editor);}catch{/* Multi-paragraph/mixed native selections are split into independent typed ranges. */}
 const {state}=editor,{from,to}=state.selection;if(from===to)return;const tr=state.tr;
 const existing=new Map<string,{type:string;attrs:Record<string,any>;text:string}>();state.doc.nodesBetween(from,to,n=>{for(const m of n.marks)if(['templateField','templateSize'].includes(m.type.name))existing.set(m.attrs.id,{type:m.type.name,attrs:m.attrs,text:''});});
 state.doc.descendants(n=>{if(n.isText)for(const m of n.marks)if(existing.has(m.attrs.id))existing.get(m.attrs.id)!.text+=n.text;});
 state.doc.descendants((n,pos)=>{if(!n.isText)return;const service=n.marks.find(m=>existing.has(m.attrs.id));if(service){const row=existing.get(service.attrs.id)!;tr.addMark(pos,pos+n.nodeSize,service.type.create({...row.attrs,original:row.text,...(row.type==='templateField'?{hint:row.text}:{}),filled:false}));return;}
  const start=Math.max(from,pos),end=Math.min(to,pos+n.nodeSize);if(start>=end)return;const value=n.text!.slice(start-pos,end-pos);for(const match of value.matchAll(/0,0+|(?:(?!0,0+)[\s\S])+/g)){const text=match[0],numeric=/^0,0+$/.test(text),a=start+match.index!,b=a+text.length;tr.addMark(a,b,numeric?state.schema.marks.templateSize.create({id:'measurement.manual.'+crypto.randomUUID(),original:text,filled:false}):state.schema.marks.templateField.create({id:'local.editable.'+crypto.randomUUID(),hint:text,original:text,filled:false}));}
 });editor.view.dispatch(tr.setMeta('uiEvent','editable-yellow'));
}
/** Explicit fill-off keeps service identities and completes only selected fields. */
export function clearSelectionYellow(editor:Editor,background:string|null){const {state}=editor,{from,to}=state.selection;if(from===to)return;const tr=state.tr,ids=new Set<string>();state.doc.nodesBetween(from,to,n=>{for(const m of n.marks)if(['templateField','templateSize'].includes(m.type.name))ids.add(m.attrs.id);});state.doc.descendants((n,pos)=>{if(n.isText){for(const m of n.marks)if(ids.has(m.attrs.id))tr.addMark(pos,pos+n.nodeSize,m.type.create({...m.attrs,filled:true}));const a=Math.max(pos,from),b=Math.min(pos+n.nodeSize,to);if(a>=b)return;for(const m of n.marks)if(m.type.name==='templateHighlight')tr.removeMark(a,b,m);const style=n.marks.find(m=>m.type.name==='textStyle');if(style||background)tr.addMark(a,b,state.schema.marks.textStyle.create({...style?.attrs,backgroundColor:background}));}else if(n.isTextblock&&n.attrs.editableHighlight&&from<=pos+1&&to>=pos+n.nodeSize-1)tr.setNodeMarkup(pos,undefined,{...n.attrs,editableHighlight:{...n.attrs.editableHighlight,edited:true}});});editor.view.dispatch(tr.setMeta('uiEvent','fill'));}
