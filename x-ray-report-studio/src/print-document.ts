import { previewPageLayout } from './page-geometry.ts';
import type { RichNode } from './model';
const text = (n: RichNode): string => n.text ?? (n.content ?? []).map(text).join('');
/** Print-only copy. Preserve text, explicit fonts and the editor's saved document. */
export type PrintBox = {width:number;height:number;imageHeight?:number};
export function preparePrintDocument(input: RichNode, box?: PrintBox): RichNode {
 const doc=structuredClone(input);
 const geometry=previewPageLayout(doc),maxWidth=box?.width??(geometry.widthMm-geometry.leftMm-geometry.rightMm)*96/25.4,maxHeight=box?.imageHeight??box?.height??(geometry.heightMm-geometry.topMm-geometry.bottomMm)*96/25.4;
 if(maxWidth<=0||maxHeight<=0)throw new Error('Поля не оставляют безопасной области печати.');
 const images=(n:RichNode)=>{if(n.type==='image'&&typeof n.attrs?.width==='number'&&typeof n.attrs?.height==='number'){const ratio=Math.min(1,maxWidth/n.attrs.width,maxHeight/n.attrs.height);if(ratio<1)n.attrs={...n.attrs,width:n.attrs.width*ratio,height:n.attrs.height*ratio};}n.content?.forEach(images);};images(doc);
 const flatten=(nodes:RichNode[]):RichNode[]=>nodes.flatMap(n=>n.type==='reportSection'?flatten(n.content??[]):[n]);
 const nodes=flatten(doc.content??[]);
 const conclusion=nodes.findIndex(n=>/^\s*ЗАКЛЮЧЕНИЕ\s*[.:]/iu.test(text(n)));
 if(conclusion>0){
  let previous=conclusion-1;
  // Empty decorative blocks at this boundary have no medical content.
  while(previous>=0&&(nodes[previous].type==='horizontalRule'||nodes[previous].type==='paragraph'&&!text(nodes[previous]).trim()))previous--;
  if(previous>=0&&nodes[previous].type==='paragraph'){
   nodes[previous].attrs={...nodes[previous].attrs,keepNext:true,...(nodes[conclusion].attrs?.pageBreakBefore?{pageBreakBefore:true}:{})};
   for(let at=previous+1;at<conclusion;at++)nodes[at].attrs={...nodes[at].attrs,keepNext:true};
   const closing=nodes[conclusion];
   // Keep one description paragraph with the first conclusion paragraph only.
   closing.attrs={...closing.attrs,pageBreakBefore:false,keepNext:false};
  }else if(previous>=0&&nodes[previous].type==='table'){const row=nodes[previous].content?.at(-1);const keep=(n:RichNode)=>{if(n.type==='paragraph')n.attrs={...n.attrs,keepNext:true};n.content?.forEach(keep);};if(row)keep(row);nodes[conclusion].attrs={...nodes[conclusion].attrs,keepNext:false};}
 }
 doc.content=nodes;
 return doc;
}
