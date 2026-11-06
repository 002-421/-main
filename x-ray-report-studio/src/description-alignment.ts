import type {RichNode} from './model';
import {addReportSeparators} from './report-separators.ts';

/** Set the default only within the description bounded by the two report rules. */
export function justifyDescription(input:RichNode):RichNode {
  const doc=addReportSeparators(input);
  let boundary=0;
  const align=(node:RichNode)=>{
    if(node.type==='paragraph')node.attrs={...node.attrs,textAlign:'justify'};
    node.content?.forEach(align);
  };
  for(const node of doc.content ?? []){
    if(node.type==='horizontalRule'){boundary++;continue;}
    if(boundary===1)align(node);
  }
  return doc;
}
