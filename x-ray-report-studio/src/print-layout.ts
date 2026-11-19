import type { RichNode } from './model';
import type { PrintBox } from './print-document.ts';
export type LayoutMetrics={pages:number;safe:boolean;descriptionOnConclusion:boolean};
export type PrintVariant={document:RichNode;name:string;delta:number;spacing:number};
export type PrintPlan=PrintVariant&{html:string;previewSourceHtml?:string;metrics:LayoutMetrics;box?:PrintBox;wordRendering:'unverified'};
export class PrintLayoutError extends Error {constructor(message:string){super(message);this.name='PrintLayoutError';}}
const walk=(n:RichNode,visit:(n:RichNode)=>void)=>{visit(n);n.content?.forEach(child=>walk(child,visit));};
const content=(n:RichNode):string=>n.text??(n.content??[]).map(content).join('');
function compact(input:RichNode,line=false):RichNode{
 const doc=structuredClone(input);
 walk(doc,n=>{
  if(n.content&&!['paragraph','heading'].includes(n.type)){const kept=n.content.filter(c=>!(c.type==='paragraph'&&!content(c).trim()&&!c.content?.some(x=>x.type!=='text'&&x.type!=='hardBreak')));if(kept.length)n.content=kept;}
  if(['paragraph','heading'].includes(n.type)){
   const a={...n.attrs};if(typeof a.spaceBeforePt==='number')a.spaceBeforePt=Math.max(0,Math.min(6,a.spaceBeforePt));if(typeof a.spaceAfterPt==='number')a.spaceAfterPt=Math.max(0,Math.min(4,a.spaceAfterPt));
   if(line&&typeof a.lineHeight==='number'&&a.lineHeight>1.05)a.lineHeight=Math.max(1.05,a.lineHeight-0.05);n.attrs=a;
  }
 });return doc;
}
/** Individual sizes/families never participate in the font-size search. */
function uniformArial(doc:RichNode,base:number){let uniform=doc.attrs?.fontFamily==='Arial';walk(doc,n=>{if(['paragraph','heading'].includes(n.type)&&n.attrs?.fontFamily&&n.attrs.fontFamily!=='Arial')uniform=false;if(['paragraph','heading'].includes(n.type)&&n.attrs?.fontSizePt!=null&&n.attrs.fontSizePt!==base)uniform=false;for(const m of n.marks??[])if(m.type==='textStyle'){if(m.attrs?.fontFamily&&m.attrs.fontFamily!=='Arial')uniform=false;if(m.attrs?.fontSize&&Math.abs(parseFloat(m.attrs.fontSize)*(String(m.attrs.fontSize).endsWith('pt')?1:0.75)-base)>.02)uniform=false;}});return uniform;}
function resized(input:RichNode,base:number,delta:number){const doc=structuredClone(input);doc.attrs={...doc.attrs,fontSizePt:base+delta};walk(doc,n=>{if(['paragraph','heading'].includes(n.type)&&n.attrs?.fontSizePt===base)n.attrs={...n.attrs,fontSizePt:base+delta};for(const m of n.marks??[])if(m.type==='textStyle'&&m.attrs?.fontSize)m.attrs={...m.attrs,fontSize:`${(base+delta)*4/3}px`};});return doc;}
export function printVariants(input:RichNode,optimize:boolean):PrintVariant[]{
 const base=Number(input.attrs?.fontSizePt)||11;
 const variants:PrintVariant[]=[{document:structuredClone(input),name:'original',delta:0,spacing:0}];
 if(!optimize)return variants;
 const spaced=compact(input),lined=compact(input,true);
 variants.push({document:spaced,name:'paragraph-spacing',delta:0,spacing:1},{document:lined,name:'line-spacing',delta:0,spacing:2});
 if(uniformArial(input,base))for(const delta of [-.5,-1,.5,1])if(base+delta>=9&&base+delta<=15)variants.push({document:resized(lined,base,delta),name:`font-${delta}`,delta,spacing:2});
 return variants;
}
/** One deterministic decision, shared by preview and both exports. */
export function choosePrintLayout(input:RichNode,optimize:boolean,render:(doc:RichNode)=>{html:string;previewSourceHtml?:string;metrics:LayoutMetrics;box?:PrintBox}):PrintPlan{
 const plans:PrintPlan[]=[];const failures:string[]=[];
 for(const v of printVariants(input,optimize)){try{const result=render(v.document);if(result.metrics.safe&&content(v.document).replace(/\s/gu,'')===content(input).replace(/\s/gu,''))plans.push({...v,...result,wordRendering:'unverified'});}catch(error){failures.push((error as Error).message);}}
 plans.sort((a,b)=>a.metrics.pages-b.metrics.pages||Number(b.metrics.descriptionOnConclusion)-Number(a.metrics.descriptionOnConclusion)||Math.abs(a.delta)-Math.abs(b.delta)||a.spacing-b.spacing||b.delta-a.delta);
 if(!plans.length)throw new PrintLayoutError('Не найдена безопасная печатная раскладка. '+(failures[0]??'Объект перекрывает область печати.'));
 return plans[0];
}
