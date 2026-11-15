import type { RichNode } from './model';
/** Preserve all nodes and order while extracting known blocks from legacy inline-only paragraphs. */
export function recoverParagraphBlocks(input:RichNode):{doc:RichNode;changed:boolean} {
 const doc=structuredClone(input);let changed=false;
 const blocks=new Set(['image','table','bulletList','orderedList','blockquote','horizontalRule']);
 const walk=(node:RichNode):RichNode[]=>{
  if(node.content)node.content=node.content.flatMap(walk);
  if(!['paragraph','heading'].includes(node.type)||!node.content?.some(n=>blocks.has(n.type)))return [node];
  changed=true;const out:RichNode[]=[];let inline:RichNode[]=[];
  const flush=()=>{if(inline.length){out.push({...node,content:inline});inline=[];}};
  for(const child of node.content){if(blocks.has(child.type)){flush();out.push(child);}else inline.push(child);}flush();return out;
 };
 walk(doc);return {doc,changed};
}
