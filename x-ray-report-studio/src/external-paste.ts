import {Extension} from '@tiptap/core';
import {Plugin} from '@tiptap/pm/state';
import {Fragment,Slice} from '@tiptap/pm/model';
import {paragraphStyle} from './document-typography.ts';
/** Clinical field handlers run first. Word/template import never enters this path. */
export const ExternalPaste=Extension.create({
 name:'externalPaste',priority:90,
 addProseMirrorPlugins(){let plain=false;return [new Plugin({props:{handleKeyDown(_view,event){plain=Boolean((event.ctrlKey||event.metaKey)&&event.shiftKey&&(event.code==='KeyV'||event.key.toLowerCase()==='v'));return false;},handlePaste(view,event,slice){
  const plainOnly=plain;plain=false;
  const html=event.clipboardData?.getData('text/html')??'';
  // Preserve internal XRS field copies; their existing plugin rekeys identities.
  if(!plainOnly&&/data-template-(?:field|size|highlight)\b/.test(html))return false;
  const clipboardText=event.clipboardData?.getData('text/plain');
  const text=(clipboardText||slice.content.textBetween(0,slice.content.size,'\n','\n')).replace(/\r\n?/g,'\n');if(!text)return false;
  const style=paragraphStyle(view.state),{color,...attrs}=style,schema=view.state.schema;
  const mark=schema.marks.textStyle.create({fontFamily:style.fontFamily,fontSize:String(Number((style.fontSizePt*4/3).toFixed(5)))+'px',color});
  const paragraphs=text.split('\n').map(line=>schema.nodes.paragraph.create(attrs,line?schema.text(line,[mark]):undefined));
  const tr=view.state.tr.replaceSelection(new Slice(Fragment.fromArray(paragraphs),1,1)).setMeta('paste',true).setMeta('uiEvent','paste');
  tr.setStoredMarks([mark]);view.dispatch(tr.scrollIntoView());return true;
 }}})];}
});
