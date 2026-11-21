import { previewPageLayout } from './page-geometry.ts';
import type { RichNode } from './model';
const text = (n: RichNode): string => n.text ?? (n.content ?? []).map(text).join('');
function compactManualRuleNeighbors(nodes: RichNode[]) {
 for (let i = 0; i < nodes.length; i++) {
  const node = nodes[i];
  if (node.type === 'paragraph' || node.type === 'heading') {
   if (nodes[i - 1]?.type === 'horizontalRule' && nodes[i - 1]?.attrs?.manual) node.attrs = {...node.attrs, spaceBeforePt: 0};
   if (nodes[i + 1]?.type === 'horizontalRule' && nodes[i + 1]?.attrs?.manual) node.attrs = {...node.attrs, spaceAfterPt: 0};
  }
 }
}
const conclusionLabel = /^\s*заключение\s*(?:[:.]|$)/iu;
const trailingReportBlock = /^\s*(?:рекомендац|рекомендован|врач(?:-рентгенолог)?\s*:|дата\s*:)/iu;
const hasBody = (node: RichNode) => node.type !== 'horizontalRule' && Boolean(text(node).trim());

/** Indices in the flattened print copy. A label with text on the same line is already its own body. */
export function printConclusion(nodes: RichNode[], firstConclusionBlock = 0) {
 const heading = nodes.findIndex((node, index) => index >= firstConclusionBlock &&
  ['paragraph','heading'].includes(node.type) && conclusionLabel.test(text(node)));
 if (heading < 0) return null;
 const standalone = !text(nodes[heading]).replace(conclusionLabel, '').trim();
 let body = heading;
 if (standalone) {
  body = heading + 1;
  while (body < nodes.length && !hasBody(nodes[body])) body++;
  if (body === nodes.length || trailingReportBlock.test(text(nodes[body]))) body = heading;
 }
 let description = heading - 1;
 while (description >= 0 && !hasBody(nodes[description])) description--;
 return {description, heading, body};
}
const flatten=(nodes: RichNode[]):RichNode[]=>nodes.flatMap(node=>node.type==='reportSection'?flatten(node.content??[]):[node]);
export function firstPrintedConclusionBlock(doc:RichNode) {
 const sections=doc.content??[];
 const index=sections.findIndex(node=>node.type==='reportSection'&&node.attrs?.id==='conclusion');
 return index>=0?flatten(sections.slice(0,index)).length:0;
}
/** Print-only copy. Preserve text, explicit fonts and the editor's saved document. */
export type PrintBox = {width:number;height:number;imageHeight?:number};
export function preparePrintDocument(input: RichNode, box?: PrintBox, breakBeforeDescription = false): RichNode {
 const doc=structuredClone(input);
 const geometry=previewPageLayout(doc),maxWidth=box?.width??(geometry.widthMm-geometry.leftMm-geometry.rightMm)*96/25.4,maxHeight=box?.imageHeight??box?.height??(geometry.heightMm-geometry.topMm-geometry.bottomMm)*96/25.4;
 if(maxWidth<=0||maxHeight<=0)throw new Error('Поля не оставляют безопасной области печати.');
 const images=(n:RichNode)=>{if(n.type==='image'&&typeof n.attrs?.width==='number'&&typeof n.attrs?.height==='number'){const ratio=Math.min(1,maxWidth/n.attrs.width,maxHeight/n.attrs.height);if(ratio<1)n.attrs={...n.attrs,width:n.attrs.width*ratio,height:n.attrs.height*ratio};}n.content?.forEach(images);};images(doc);
 const flatten=(nodes:RichNode[]):RichNode[]=>nodes.flatMap(n=>n.type==='reportSection'?flatten(n.content??[]):[n]);
 const nodes=flatten(doc.content??[]);

 const compactRules = (children: RichNode[]) => {
  compactManualRuleNeighbors(children);
  for (const child of children) if (child.content) compactRules(child.content);
 };
 compactRules(nodes);
 const group = printConclusion(nodes, firstPrintedConclusionBlock(doc));
 if (group) {
  const {description, heading, body} = group;
  const lastDescription = nodes[description];
  const keep = (n: RichNode) => {
   if (n.type === 'paragraph' || n.type === 'heading') n.attrs = {...n.attrs, keepNext: true};
   n.content?.forEach(keep);
  };
  if (lastDescription?.type === 'table') {
   const row = lastDescription.content?.at(-1);
   if (row) keep(row);
  }
  const start = lastDescription && ['paragraph','heading'].includes(lastDescription.type) ? description : description + 1;
  const explicitBreak = nodes.slice(start, body + 1).some(node => node.attrs?.pageBreakBefore);
  for (let at = start; at <= body; at++) {
   const node = nodes[at];
   node.attrs = {...node.attrs, keepNext: at < body};
   if (at === heading && heading !== body) node.attrs.keepLines = true;
   if (at === body) node.attrs.keepLines = false;
   if (at !== start && node.attrs.pageBreakBefore) node.attrs.pageBreakBefore = false;
   if (at === start && (explicitBreak || breakBeforeDescription && start === description) && node.type !== 'horizontalRule') node.attrs.pageBreakBefore = true;
  }
 }
 doc.content=nodes;
 return doc;
}
