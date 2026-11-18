import type { RichNode } from './model';
const text = (n: RichNode): string => n.text ?? (n.content ?? []).map(text).join('');
/** Print-only copy. Preserve text, explicit fonts and the editor's saved document. */
export function preparePrintDocument(input: RichNode): RichNode {
 const doc=structuredClone(input);
 const flatten=(nodes:RichNode[]):RichNode[]=>nodes.flatMap(n=>n.type==='reportSection'?flatten(n.content??[]):[n]);
 const nodes=flatten(doc.content??[]);
 const conclusion=nodes.findIndex(n=>/^\s*ЗАКЛЮЧЕНИЕ\s*[.:]/iu.test(text(n)));
 if(conclusion>0){
  let previous=conclusion-1;
  // Empty decorative blocks at this boundary have no medical content.
  while(previous>=0&&(nodes[previous].type==='horizontalRule'||nodes[previous].type==='paragraph'&&!text(nodes[previous]).trim()))previous--;
  if(previous>=0&&nodes[previous].type==='paragraph'){
   nodes[previous].attrs={...nodes[previous].attrs,keepNext:true,...(nodes[conclusion].attrs?.pageBreakBefore?{pageBreakBefore:true}:{})};
   nodes.splice(previous+1,conclusion-previous-1);
   const closing=nodes[previous+1];
   // Keep one description paragraph with the first conclusion paragraph only.
   closing.attrs={...closing.attrs,pageBreakBefore:false,keepNext:false};
  }
 }
 doc.content=nodes;
 return doc;
}
