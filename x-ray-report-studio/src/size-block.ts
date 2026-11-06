import type { RichNode } from './model';

export function makeSizeBlock(ct = false): RichNode {
  const unit = ct ? 'мм' : 'см';
  const content: RichNode[] = [{type:'text',text:'Размеры: '}];
  for (const [index, label] of ['фронтальный', 'сагиттальный', 'вертикальный'].entries()) {
    if (index) content.push({type:'text',text:'/\u200b'});
    content.push({type:'text',text:`${label}\u00a0—\u00a0`},
      {type:'text',text:'0,0',marks:[{type:'highlight',attrs:{color:'#ffff00'}}]},
      {type:'text',text:`\u00a0${unit}`});
  }
  return {type:'doc',content:[{type:'paragraph',attrs:{lineHeight:1.05},content}]};
}
