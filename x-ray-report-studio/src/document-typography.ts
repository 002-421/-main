import type {Editor} from '@tiptap/core';
import type {EditorState} from '@tiptap/pm/state';
import type {Node as PMNode, Mark} from '@tiptap/pm/model';
export const FIRST_LINE_INDENTS=[0,.5*72/2.54,.625*72/2.54,.75*72/2.54,72/2.54,1.25*72/2.54] as const;
export function fontPoints(value:unknown):number|undefined {
 const match=/^(\d+(?:\.\d+)?)(px|pt)?$/.exec(String(value??''));if(!match)return;
 const points=Number(match[1])*(match[2]==='px'?.75:1);return points>0&&points<=200?Math.round(points*1000)/1000:undefined;
}
const valid=(value:unknown,fallback:number)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1000?value:fallback;
export function paragraphStyle(state:EditorState,here:PMNode=state.selection.$from.parent,marks:readonly Mark[]|null=null){
 const targetMarks=marks??state.storedMarks??state.selection.$from.marks(),root=state.doc.attrs;
 let sample:PMNode|undefined;state.doc.descendants(node=>{if(!sample&&node.type.name==='reportSection'&&node.attrs.id==='description'){node.descendants(n=>{if(!sample&&n.isTextblock)sample=n;});return false;}});
 const a=here.isTextblock?here.attrs:sample?.attrs??{},base=sample?.attrs??{};
 const stored=targetMarks.find(m=>m.type.name==='textStyle')?.attrs;
 const current=targetMarks.find(m=>m.type.name==='textStyle')?.attrs;
 return {fontFamily:stored?.fontFamily??a.fontFamily??root.fontFamily??base.fontFamily??'Arial',fontSizePt:fontPoints(stored?.fontSize)??valid(a.fontSizePt,valid(root.fontSizePt,valid(base.fontSizePt,11))),textAlign:a.textAlign??base.textAlign??'justify',firstLineIndentPt:valid(a.firstLineIndentPt,valid(root.firstLineIndentPt,valid(base.firstLineIndentPt,0))),lineHeight:valid(a.lineHeight,valid(root.lineHeight,valid(base.lineHeight,1.05))),spaceBeforePt:valid(a.spaceBeforePt,valid(base.spaceBeforePt,0)),spaceAfterPt:valid(a.spaceAfterPt,valid(root.spaceAfterPt,valid(base.spaceAfterPt,0))),leftIndentPt:valid(a.leftIndentPt,0),rightIndentPt:valid(a.rightIndentPt,0),color:current?.color??'#000000'};
}
function sizeAt(state:EditorState,node:PMNode,pos:number,marks:readonly Mark[]=node.marks){
 const inline=fontPoints(marks.find(m=>m.type.name==='textStyle')?.attrs.fontSize);
 return inline??fontPoints(state.doc.resolve(pos).parent.attrs.fontSizePt)??fontPoints(state.doc.attrs.fontSizePt)??11;
}
export function selectionFontSize(state:EditorState):number|'mixed'{
 if(state.selection.empty)return sizeAt(state,state.selection.$from.parent,state.selection.from,state.storedMarks??state.selection.$from.marks());
 const sizes=new Set<number>();for(const range of state.selection.ranges)state.doc.nodesBetween(range.$from.pos,range.$to.pos,(n,pos)=>{if(n.isText)sizes.add(sizeAt(state,n,pos));});return sizes.size>1?'mixed':[...sizes][0]??paragraphStyle(state).fontSizePt;
}
export function selectionIndent(state:EditorState):number|'mixed'{
 const values=new Set<number>(),{from,to,$from}=state.selection;
 state.doc.nodesBetween(from,to,(n,pos)=>{if(n.isTextblock&&(from===to||pos+1<to))values.add(valid(n.attrs.firstLineIndentPt,0));});if(!values.size)values.add(valid($from.parent.attrs.firstLineIndentPt,0));return values.size>1?'mixed':[...values][0];
}
export function setFirstLineIndent(editor:Editor,points:number){
 if(!Number.isFinite(points)||points<0||points>1000)return false;
 return editor.chain().focus().command(({tr,dispatch})=>{let found=false;const {from,to}=tr.selection;tr.doc.nodesBetween(from,to,(node,pos)=>{if(!node.isTextblock||from<to&&pos+1>=to)return;found=true;if(dispatch)tr.setNodeMarkup(pos,undefined,{...node.attrs,firstLineIndentPt:points});return false;});return found;}).run();
}
export function setReportFontSize(editor:Editor,points:number){
 if(!Number.isFinite(points)||points<6||points>200)return false;
 const css=String(Number((points*4/3).toFixed(5)))+'px';
 return editor.chain().focus().setFontSize(css).command(({tr,dispatch})=>{const {from,to}=tr.selection;if(from===to)return true;tr.doc.nodesBetween(from,to,(node,pos)=>{if(node.isTextblock&&from<=pos+1&&to>=pos+node.nodeSize-1&&dispatch)tr.setNodeMarkup(pos,undefined,{...node.attrs,fontSizePt:points});});return true;}).run();
}
