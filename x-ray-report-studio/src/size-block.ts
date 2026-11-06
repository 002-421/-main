import type { RichNode } from './model';

export function makeSizeBlock(ct = false): RichNode {
  const unit = ct ? 'мм' : 'см';
  const content: RichNode[] = [];
  content.push({type:'text',text:'0,0',marks:[{type:'highlight',attrs:{color:'#ffff00'}}]});
  content.push({type:'text',text:`\u00a0${unit} (фронтальный/\u200bсагиттальный/\u200bвертикальный)`});
  return {type:'doc',content:[{type:'paragraph',attrs:{lineHeight:1.05},content}]};
}
