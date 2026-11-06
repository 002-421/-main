import type { RichNode } from './model';

/** Normalize only the rendered Word paragraph, leaving saved editor state intact. */
export function compactWordSpaces(nodes: RichNode[]): RichNode[] {
  const copy = structuredClone(nodes);
  let beginning = true, previousSpace = false;
  const clean = (value: string) => {
    let result = '';
    for (const char of value) {
      const space = char === ' ' || char === '\u00a0';
      if (space && (beginning || previousSpace)) continue;
      result += char;
      beginning = /[\r\n]/.test(char);
      previousSpace = space;
    }
    return result;
  };
  const walk = (node: RichNode) => {
    if (node.type === 'text') node.text = clean(node.text ?? '');
    else if (node.type === 'reportField') {
      const key = node.attrs?.value ? 'value' : 'hint';
      node.attrs = {...node.attrs, [key]:clean(String(node.attrs?.[key] ?? ''))};
    } else if (node.type === 'hardBreak') {beginning=true;previousSpace=false;}
    else if (node.content) node.content.forEach(walk);
    else {beginning=false;previousSpace=false;}
  };
  copy.forEach(walk);
  // Remove the trailing space even if formatting split it into a separate run.
  const trimEnd = (list: RichNode[]): boolean => {
    for (let index=list.length-1;index>=0;index--) {
      const node=list[index];
      if(node.type==='text') {node.text=(node.text ?? '').replace(/[ \u00a0]+$/,'');if(node.text)return true;}
      else if(node.content) {if(trimEnd(node.content))return true;}
      else return true;
    }
    return false;
  };
  trimEnd(copy);
  return copy;
}
