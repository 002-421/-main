import {Extension} from '@tiptap/core';
import {Plugin} from '@tiptap/pm/state';
import {DOMSerializer,Fragment,Slice} from '@tiptap/pm/model';
import {paragraphStyle,fontPoints} from './document-typography.ts';
class XrsClipboardSerializer extends DOMSerializer {
  serializeFragment(fragment:Fragment,options:{document?:Document}={},target?:DocumentFragment):DocumentFragment {
    const content=super.serializeFragment(fragment,options),document=options.document??globalThis.document;
    const marker=document.createElement('div');marker.setAttribute('data-xrs-internal-clipboard','');marker.append(content);
    const output=document.createDocumentFragment();output.append(marker);
    if(target){target.append(output);return target;}return output;
  }
}
/** Clinical field handlers run first. Word/template import never enters this path. */
export const ExternalPaste=Extension.create({
 name:'externalPaste',priority:90,
 addProseMirrorPlugins(){let plain=false;const schema=this.editor?.schema;const baseSerializer=schema?DOMSerializer.fromSchema(schema):undefined;const clipboardSerializer=baseSerializer?new XrsClipboardSerializer(baseSerializer.nodes,baseSerializer.marks):undefined;return [new Plugin({props:{clipboardSerializer,handleKeyDown(_view,event){plain=Boolean((event.ctrlKey||event.metaKey)&&event.shiftKey&&(event.code==='KeyV'||event.key.toLowerCase()==='v'));return false;},handlePaste(view,event,slice){
  const plainOnly=plain;plain=false;
  const html=event.clipboardData?.getData('text/html')??'';
  // ProseMirror's parser preserves the copied marks and the later transform
  // safely rekeys copied service-field IDs. Do not flatten our own rich copy.
  if(!plainOnly&&/data-xrs-internal-clipboard\b/.test(html))return false;
  // Preserve internal XRS field copies; their existing plugin rekeys identities.
  if(!plainOnly&&/data-template-(?:field|size|highlight)\b/.test(html))return false;
  const clipboardText=event.clipboardData?.getData('text/plain');
  const text=(clipboardText||slice.content.textBetween(0,slice.content.size,'\n','\n')).replace(/\r\n?/g,'\n');if(!text)return false;
  const local=view.state.storedMarks??(view.state.selection.empty?view.state.selection.$from.marks():view.state.selection.$from.marksAcross(view.state.selection.$to)??view.state.selection.$from.marks());
  const character=local.find(m=>m.type.name==='textStyle')?.attrs;
  const style={...paragraphStyle(view.state),...(character?.fontFamily?{fontFamily:character.fontFamily}:{}),...(fontPoints(character?.fontSize)?{fontSizePt:fontPoints(character?.fontSize)!}:{})},{color,...attrs}=style,schema=view.state.schema;
  const mark=schema.marks.textStyle.create({fontFamily:style.fontFamily,fontSize:String(Number((style.fontSizePt*4/3).toFixed(5)))+'px',color});
  // Copy visual character formatting, never field identities, links or system/manual fill.
  const marks=[mark,...local.filter(m=>['bold','italic','underline','strike','superscript','subscript'].includes(m.type.name))];
  const paragraphs=text.split('\n').map(line=>schema.nodes.paragraph.create(attrs,line?schema.text(line,marks):undefined));
  const tr=view.state.tr.replaceSelection(new Slice(Fragment.fromArray(paragraphs),1,1)).setMeta('paste',true).setMeta('uiEvent','paste');
  tr.setStoredMarks(marks);view.dispatch(tr.scrollIntoView());return true;
 }}})];}
});
