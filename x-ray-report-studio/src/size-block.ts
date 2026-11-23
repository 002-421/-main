import {initializeEditableHighlights} from './template-highlights.ts';
import type { RichNode } from './model';

export function makeSizeBlock(ct = false): RichNode {
  const unit = ct ? 'мм' : 'см';
  const content: RichNode[] = [];
  content.push({type:'text',text:'0,0',marks:[{type:'highlight',attrs:{color:'#ffff00'}}]});
  content.push({type:'text',text:`\u00a0${unit} (фронтальный/\u200bсагиттальный/\u200bвертикальный)`});
  const doc=initializeEditableHighlights({type:'doc',content:[{type:'paragraph',attrs:{lineHeight:1.05},content}]});
  const prefix=`size_${crypto.randomUUID().replaceAll('-','')}`;
  const visit=(node:RichNode)=>{if(node.attrs?.editableHighlight)node.attrs.editableHighlight.id=prefix;for(const mark of node.marks??[])if(mark.type==='templateHighlight')mark.attrs!.id=prefix;else if(mark.type==='templateSize')mark.attrs!.id=`${prefix}.value`;node.content?.forEach(visit);};
  visit(doc);return doc;
}
