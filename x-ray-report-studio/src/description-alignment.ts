import type {RichNode} from './model';
import {addReportSeparators} from './report-separators.ts';

/** Default alignment for the study title, description and conclusion blocks. */
export function justifyDescription(input:RichNode):RichNode {
  const doc=addReportSeparators(input);
  let boundary=0;
  let closingFinished=false;
  const text=(node:RichNode):string=>node.text??node.content?.map(text).join('')??'';
  const align=(node:RichNode)=>{
    if(node.type==='paragraph')node.attrs={...node.attrs,textAlign:'justify'};
    node.content?.forEach(align);
  };
  for(const node of doc.content ?? []){
    if(node.type==='horizontalRule'){boundary++;continue;}
    const line=text(node).trim();
    if(boundary>=2&&/^(?:Врач(?:-рентгенолог)?\s*:|Дата\s*:|Справочная информация)/i.test(line))closingFinished=true;
    const studyTitle=/^(?:Область и вид исследования|Вид исследования)\s*:/i.test(line);
    if(studyTitle||boundary===1||boundary>=2&&!closingFinished)align(node);
  }
  return doc;
}
