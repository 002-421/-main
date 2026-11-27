import type {Slice} from '@tiptap/pm/model';
/** One text interpretation for general paste and existing destination fields. */
export function clipboardText(event:{clipboardData?:{getData:(type:string)=>string}|null},slice?:Slice):string|undefined {
 const plain=event.clipboardData?.getData('text/plain');
 const text=plain||slice?.content.textBetween(0,slice.content.size,'\n','\n');
 return (text??plain)?.replace(/\r\n?/g,'\n');
}
