import type {RichNode} from './model.ts';
import {editableHighlightStructure} from './template-highlights.ts';

/** Fail closed: matching clinical prose does not establish identity of service fields. */
export function assertTemplateFieldContinuity(before: RichNode, after: RichNode) {
  const old=editableHighlightStructure(before).fields, next=editableHighlightStructure(after).fields;
  const missing=old.filter(field=>!next.some(candidate=>candidate.id===field.id)).map(field=>field.id);
  const added=next.filter(field=>!old.some(candidate=>candidate.id===field.id)).map(field=>field.id);
  const sections=(doc:RichNode)=>{const ids:string[]=[];const visit=(n:RichNode)=>{if(n.type==='reportSection')ids.push(String(n.attrs?.id));n.content?.forEach(visit);};visit(doc);return ids;};
  if(JSON.stringify(sections(before))!==JSON.stringify(sections(after)))throw Error('Изменена структура служебных разделов XRS. Импорт отменён; требуется структурный манифест.');
  if(missing.length||added.length) throw Error(`Неоднозначное сопоставление templateField. Отсутствуют ID: ${missing.join(', ')||'нет'}; новые ID: ${added.join(', ')||'нет'}. Импорт отменён; требуется структурный манифест и утверждение изменений полей.`);
}
