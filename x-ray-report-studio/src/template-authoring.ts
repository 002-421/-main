import type {Editor} from '@tiptap/core';
import type {RichNode} from './model.ts';import {validateTemplate} from './model.ts';
import {initializeEditableHighlights,editableHighlightStructure,textOf} from './template-highlights.ts';
import {sanitizeTemplateForExport} from './template-sanitizer.ts';import {resetInlineTemplate} from './inline-fields.ts';
import {structurePreparedBuiltin} from './ai-review-structure.ts';import {initializeReportFooter} from './report-footer.ts';import {justifyDescription} from './description-alignment.ts';
import {makeBuiltinTemplateDocument,makeTemplateDocument,networkTemplate,networkTemplateSource,reportTemplates,areas} from './catalog.ts';import {checkedTemplateDocxParts,inspectTemplateDocx,sha256Doc} from './template-docx.ts';import {importOwnDocx,recoverDocx} from './docx.ts';
import type {CatalogTemplate} from './template-update-types.ts';
export function finalizeTemplate(input:RichNode):RichNode{
 const templateId=input.attrs?.templateId;let doc=sanitizeTemplateForExport(input);
 // Tiptap appends an empty caret paragraph outside the four report sections.
 // It belongs to the editing surface, not the distributable medical template.
 if(doc.content?.some(n=>n.type==='reportSection')){
  const tail=doc.content.slice(4);
  if(tail.some(n=>n.type!=='paragraph'||(n.content?.length??0)>0))throw Error('Текст вне служебных разделов: явно укажите его раздел.');
  doc.content=doc.content.slice(0,4);
 }
if(doc.attrs)delete doc.attrs.templateSource;
 const rebase=(n:RichNode)=>{if(n.attrs?.editableHighlight)n.attrs.editableHighlight={...n.attrs.editableHighlight,original:textOf(n),edited:false};if(n.attrs?.templateOriginal!=null)n.attrs.templateOriginal=textOf(n);n.content?.forEach(rebase);};rebase(doc);
 // The existing initializer only interprets newly introduced legacy yellow. It
 // preserves already structural identities and independent measurement marks.
 doc.attrs={...doc.attrs,editableHighlightsVersion:1};rebase(doc);const checked=validateTemplate(doc);if(typeof templateId==='string'&&/^[A-Za-z0-9_.:-]{1,120}$/.test(templateId))checked.attrs={...checked.attrs,templateId};return checked;
}
export function editableSource(id:string):CatalogTemplate{
 const network=networkTemplateSource(id);if(network)return network;
 const t=reportTemplates.find(t=>t.id===id);if(!t)throw Error('Шаблон не найден.');
 let doc=networkTemplate(id)?makeTemplateDocument(id):structurePreparedBuiltin(id,justifyDescription(initializeReportFooter(resetInlineTemplate(makeBuiltinTemplateDocument(id)),'дд.мм.гггг')));
 doc=sanitizeTemplateForExport(doc);if(doc.attrs)delete doc.attrs.editableHighlightsVersion;doc=initializeEditableHighlights(doc);const rebase=(n:RichNode)=>{if(n.attrs?.templateOriginal!=null)n.attrs.templateOriginal=textOf(n);n.content?.forEach(rebase);};rebase(doc);validateTemplate(doc);return {id:t.id,title:t.title,areaId:t.areaId,areaTitle:areas.find(a=>a.id===t.areaId)?.title??t.areaId,modality:id.startsWith('ct-')?'CT':'MRI',templateVersion:t.templateVersion,minimumXrsVersion:'0.4.84',doc};
}
export function mapWordSections(doc:RichNode,choices:string[]):RichNode{
 const ids=['header','description','conclusion','signature'];if(!doc.content||choices.length!==doc.content.length||choices.some(id=>!ids.includes(id)))throw Error('Явно укажите раздел каждого блока Word.');
 const content=ids.map(id=>({type:'reportSection',attrs:{id,title:id,moduleId:''},content:doc.content!.filter((_,i)=>choices[i]===id)}));if(content.some(s=>!s.content.length))throw Error('Все четыре служебных раздела должны быть указаны.');return {...structuredClone(doc),content};
}
export async function importAuthoringDocx(bytes:Uint8Array,source:CatalogTemplate){
 checkedTemplateDocxParts(bytes);const own=await importOwnDocx(bytes);if(own){if(own.kind!=='template'||own.templateId!==source.id)throw Error('DOCX не является выбранным XRS-шаблоном. Протокол пациента не допускается.');if(own.templateReview?.templateVersion&&own.templateReview.templateVersion!==source.templateVersion)throw Error('Исходная редакция изменилась.');if(own.templateReview?.baseSha256!==await sha256Doc(sanitizeTemplateForExport(source.doc)))throw Error('Конфликт исходного хеша шаблона.');}
 try{const row=await inspectTemplateDocx(bytes,[{...source,group:source.modality}]);if(row.status==='conflict')throw Error('Исходная редакция изменилась.');return {doc:row.after,manual:false,warnings:row.warnings};}
 catch(error){const message=(error as Error).message;if(/неразрешён|Исходная редакция изменилась|контрольн|хеш|конфликт/i.test(message))throw error;const recovered=await recoverDocx(bytes);if(recovered.warnings.some(w=>/неподдерживаем|Не удалось полностью/.test(w)))throw Error('Неподдерживаемые элементы Word требуют отдельной проверки. Импорт заблокирован.');return {doc:recovered.doc,manual:true,warnings:recovered.warnings};}
}
export function assignNativeField(editor:Editor,field:{id:string;hint:string}){
 const {from,to}=editor.state.selection;if(from===to||editor.state.selection.$from.parent!==editor.state.selection.$to.parent)throw Error('Выделите фрагмент одного абзаца для служебного поля.');let duplicate=false;editor.state.doc.descendants((n,p)=>{if(n.isText&&n.marks.some(m=>m.type.name==='templateField'&&m.attrs.id===field.id)&&(p>=to||p+n.nodeSize<=from))duplicate=true;});if(duplicate)throw Error('Это поле уже назначено другому фрагменту.');
 const marks=editor.state.selection.$from.marks().filter(m=>!['templateField','templateHighlight','templateSize','highlight'].includes(m.type.name)),mark=editor.schema.marks.templateField.create({id:field.id,hint:field.hint,original:field.hint,filled:false});editor.view.dispatch(editor.state.tr.replaceWith(from,to,editor.schema.text(field.hint,[...marks,mark])));
}
export function markEditableParagraph(editor:Editor){const tr=editor.state.tr,{from,to}=tr.selection;tr.doc.nodesBetween(from,to,(n,pos)=>{if(!n.isTextblock||from<to&&pos+1>=to)return;const id=n.attrs.editableHighlight?.id??'editable.manual.'+crypto.randomUUID();tr.setNodeMarkup(pos,undefined,{...n.attrs,editableHighlight:{id,original:n.textContent,edited:false}});n.descendants((child,offset)=>{if(child.isText&&!child.marks.some(m=>m.type.name==='templateField')){for(const mark of child.marks)if(mark.type.name==='highlight'&&/^(#ffff00|yellow)$/i.test(mark.attrs.color))tr.removeMark(pos+1+offset,pos+1+offset+child.nodeSize,mark);tr.addMark(pos+1+offset,pos+1+offset+child.nodeSize,editor.schema.marks.templateHighlight.create({id}));}});return false;});editor.view.dispatch(tr);}
export function markMeasurement(editor:Editor,existingId?:string){const {from,to}=editor.state.selection,text=editor.state.doc.textBetween(from,to);if(!/^0,0+$/.test(text)||editor.state.selection.$from.parent!==editor.state.selection.$to.parent)throw Error('Выделите ровно один заполнитель 0,0 в одном абзаце.');const id=existingId||'measurement.manual.'+crypto.randomUUID();let duplicate=false;editor.state.doc.descendants((n,p)=>{if(n.isText&&n.marks.some(m=>m.type.name==='templateSize'&&m.attrs.id===id)&&(p>=to||p+n.nodeSize<=from))duplicate=true;});if(duplicate)throw Error('Этот ID размера уже назначен.');const tr=editor.state.tr;editor.state.doc.nodesBetween(from,to,(n,pos)=>{for(const m of n.marks)if(m.type.name==='highlight'&&/^(#ffff00|yellow)$/i.test(m.attrs.color))tr.removeMark(Math.max(pos,from),Math.min(pos+n.nodeSize,to),m);});tr.addMark(from,to,editor.schema.marks.templateSize.create({id,original:text,filled:false}));editor.view.dispatch(tr);}
export function fieldAudit(before:RichNode,after:RichNode){const a=editableHighlightStructure(before),b=editableHighlightStructure(after);return {before:a,after:b,missingFields:a.fields.filter(f=>!b.fields.some(n=>n.id===f.id)),missingMeasurements:a.sizes.filter(f=>!b.sizes.some(n=>n.id===f.id))};}

export async function templateDataSha(value:unknown){const text=JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
