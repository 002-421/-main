import type {RichNode} from './model';
const textOf=(node:RichNode):string=>node.type==='reportField'?String(node.attrs?.value||node.attrs?.hint||''):node.text??node.content?.map(textOf).join('')??'';
export function studyTitleText(doc:RichNode):string {
 let result='';
 const walk=(node:RichNode)=>{if(result)return;if(['paragraph','heading'].includes(node.type)&&/^(?:Область и вид исследования|Вид исследования)\s*:/i.test(textOf(node).trim()))result=textOf(node);else node.content?.forEach(walk);};
 walk(doc);return result;
}
function sides(text:string){
 return {right:/(?<!\p{L})прав(?:ый|ая|ое|ого|ой|ую|ом|ым|ые|ых|ыми)(?!\p{L})/iu.test(text),left:/(?<!\p{L})лев(?:ый|ая|ое|ого|ой|ую|ом|ым|ые|ых|ыми)(?!\p{L})/iu.test(text)};
}
/** A selected side belongs to the study heading, never to findings in the body. */
export function titleWithStudySide(title:string,template:RichNode,current:RichNode):string {
 const original=studyTitleText(template),choice=sides(original);
 if(!choice.right||!choice.left||!original.includes('/'))return title;
 const selected=sides(studyTitleText(current));
 if(selected.right===selected.left)return title;
 return `${title} ${selected.right?'пр':'лев'}`;
}
