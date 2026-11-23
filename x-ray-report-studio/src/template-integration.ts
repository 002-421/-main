import type {RichNode} from './model.ts';
import {manualFillColor} from './report-format-options.ts';
import {editableHighlightStructure} from './template-highlights.ts';

/** Fail closed: matching clinical prose does not establish identity of service fields. */
export function assertTemplateFieldContinuity(before: RichNode, after: RichNode) {
  const old=editableHighlightStructure(before).fields, next=editableHighlightStructure(after).fields;
  const missing=old.filter(field=>!next.some(candidate=>candidate.id===field.id)).map(field=>field.id);
  const added=next.filter(field=>!old.some(candidate=>candidate.id===field.id)).map(field=>field.id);
  const sections=(doc:RichNode)=>{const ids:string[]=[];const visit=(n:RichNode)=>{if(n.type==='reportSection')ids.push(String(n.attrs?.id));n.content?.forEach(visit);};visit(doc);return ids;};
  if(JSON.stringify(sections(before))!==JSON.stringify(sections(after)))throw Error('Изменена структура служебных разделов XRS. Импорт отменён; требуется структурный манифест.');
  const previousStructure=editableHighlightStructure(before), nextStructure=editableHighlightStructure(after);
  if(JSON.stringify(previousStructure.paragraphs)!==JSON.stringify(nextStructure.paragraphs) || JSON.stringify(previousStructure.sizes.map(size=>size.id))!==JSON.stringify(nextStructure.sizes.map(size=>size.id)))
    throw Error('Неоднозначное сопоставление системных ID подсветки и размеров. Импорт отменён; требуется структурный манифест.');
  if(missing.length||added.length) throw Error(`Неоднозначное сопоставление templateField. Отсутствуют ID: ${missing.join(', ')||'нет'}; новые ID: ${added.join(', ')||'нет'}. Импорт отменён; требуется структурный манифест и утверждение изменений полей.`);
  const manual=(doc:RichNode)=>{const rows:{color:string;text:string}[]=[];const visit=(node:RichNode)=>{const color=node.marks?.find(mark=>mark.type==='textStyle')?.attrs?.backgroundColor;if(node.type==='text'&&color){const normalized=manualFillColor(color)??String(color).toLowerCase(),prior=rows.at(-1);if(prior?.color===normalized)prior.text+=node.text??'';else rows.push({color:normalized,text:node.text??''});}node.content?.forEach(visit);};visit(doc);return rows;};
  if(JSON.stringify(manual(before))!==JSON.stringify(manual(after)))throw Error('Неоднозначное восстановление ручной заливки из Word. Импорт отменён; требуется структурный манифест.');
}
