import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type { ReviewBlocks, Suggestion } from './ai-review.ts';
import { reviewPlain } from './ai-review.ts';
import type { RichNode } from './model';

/** Map a reviewed substring within one text-only block, across any number of marked text runs. */
export function resolveReviewRange(editor: Editor, suggestion: Suggestion, blocks: ReviewBlocks, expectedTabId?: string, activeTabId?: string): { from: number; to: number } {
  if (expectedTabId && expectedTabId !== activeTabId) throw new Error('Открыта другая вкладка');
  const doc = editor.state.doc;
  const sections: { node: typeof doc; pos: number }[] = [];
  doc.forEach((node, pos) => { if (node.type.name === 'reportSection' && node.attrs.id === suggestion.blockId) sections.push({ node, pos }); });
  if (sections.length !== 1) throw new Error('Структура блока изменилась');
  const { node, pos } = sections[0];
  const raw = reviewPlain(node.toJSON() as RichNode);
  if (raw.trim() !== blocks[suggestion.blockId]) throw new Error('Текст блока изменился после проверки');
  const trimStart = raw.length - raw.trimStart().length;
  const start = suggestion.from + trimStart, end = suggestion.to + trimStart;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > raw.length || start > end || raw.slice(start, end) !== suggestion.original) throw new Error('Правка устарела');
  const segments:{from:number;to:number;pos:number}[]=[];
  let offset=0;
  const visit=(current:typeof doc,position:number)=>{
    if(current.isText){segments.push({from:offset,to:offset+(current.text?.length??0),pos:position});offset+=current.text?.length??0;return;}
    if(current.type.name==='hardBreak'){offset++;return;}
    const separator=['paragraph','heading','listItem'].includes(current.type.name)?0:1;
    current.forEach((child,childPos,index)=>{visit(child,position+1+childPos);if(index<current.childCount-1)offset+=separator;});
  };
  visit(node,pos);
  const first=segments.find(x=>start>=x.from&&start<x.to)||segments.find(x=>start===end&&start===x.to);
  const last=segments.find(x=>end>x.from&&end<=x.to)||first;
  let match:{from:number;to:number}|null=null;
  if(first&&last){const from=first.pos+start-first.from,to=last.pos+end-last.from;
    if(to-from===end-start&&doc.textBetween(from,to,'\n','\n')===suggestion.original)match={from,to};
  }
  if (!match) throw new Error('Фрагмент требует ручного редактирования');
  return match;
}

export function highlightReviewSuggestion(editor: Editor, suggestion: Suggestion, blocks: ReviewBlocks, expectedTabId?: string, activeTabId?: string): void {
  const range = resolveReviewRange(editor, suggestion, blocks, expectedTabId, activeTabId);
  editor.commands.setTextSelection(range);
  editor.commands.focus();
}

/** Called only after a separate physician click; one editor transaction keeps Undo/Redo intact. */
export function applyReviewSuggestion(editor: Editor, suggestion: Suggestion, blocks: ReviewBlocks, expectedTabId?: string, activeTabId?: string): void {
  if (suggestion.state !== 'pending' || suggestion.operation === 'comment') throw new Error('Замечание не изменяет текст');
  const range = resolveReviewRange(editor, suggestion, blocks, expectedTabId, activeTabId);
  if (!isSafeReviewReplacement(suggestion)) throw new Error('Правка может затрагивать медицинский смысл и требует ручной проверки');
  if (suggestion.operation === 'insert' && range.from !== range.to) throw new Error('Неверная вставка');
  if (suggestion.operation === 'delete' && suggestion.proposed) throw new Error('Неверное удаление');
  const replacement = suggestion.operation === 'delete' ? '' : suggestion.proposed;
  if (/\r|\n/.test(replacement)) throw new Error('Правка меняет структуру абзаца');
  const tr=editor.state.tr.insertText(replacement, range.from, range.to);
  tr.setSelection(TextSelection.near(tr.doc.resolve(range.from+replacement.length)));
  editor.view.dispatch(tr);
  editor.view.focus?.();
}

const protectedClinicalValue=/(?<![\p{L}\p{N}])(?:справа|слева|прав\p{L}*|лев\p{L}*|не\p{L}*|двусторонн\p{L}*|отсутств\p{L}*|исключить|грыж\p{L}*|опухол\p{L}*|инфаркт\p{L}*|метастаз\p{L}*|стади\p{L}*|диагноз\p{L}*|мозг\p{L}*|головн\p{L}*|полушари\p{L}*|лобн\p{L}*|теменн\p{L}*|затылочн\p{L}*|височн\p{L}*|ствол\p{L}*|желудоч\p{L}*|гипофиз\p{L}*|эпифиз\p{L}*|гипоталамус\p{L}*|спинн\p{L}*|позвон\p{L}*|позвоноч\p{L}*|диск\p{L}*|сустав\p{L}*|хрящ\p{L}*|кость\p{L}*|печен\p{L}*|селезен\p{L}*|почек\p{L}*|надпочеч\p{L}*|матк\p{L}*|яичник\p{L}*|простата|легк\p{L}*|плевр\p{L}*|бронх\p{L}*|сосуд\p{L}*|артери\p{L}*|вен\p{L}*|лимф\p{L}*|нерв\p{L}*|глаз\p{L}*|орбит\p{L}*|кора\p{L}*|кист\p{L}*|полип\p{L}*)(?![\p{L}\p{N}])|(?<!\d)\d+(?:[,.]\d+)?\s*(?:мм|см|мл|мг|г|°)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?:C|Th|L|S)\d{1,2}(?![\p{L}\p{N}])/iu;
function oneEditApart(left:string,right:string):boolean{
  const a=[...left.toLocaleLowerCase('ru')],b=[...right.toLocaleLowerCase('ru')];
  if(Math.abs(a.length-b.length)>1)return false;
  let i=0,j=0,edits=0;
  while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++edits>1)return false;if(a.length>=b.length)i++;if(b.length>=a.length)j++;}
  return edits+(i<a.length||j<b.length?1:0)<=1;
}
export function isSafeReviewReplacement(suggestion:Suggestion):boolean{
  if(suggestion.operation==='comment'||suggestion.meaningRisk||suggestion.confidence==='limited')return false;
  if(!['spelling','punctuation','style','terminology'].includes(suggestion.category))return false;
  if(protectedClinicalValue.test(suggestion.original)||protectedClinicalValue.test(suggestion.proposed))return false;
  if(suggestion.category==='punctuation')return suggestion.original.replace(/[\p{L}\p{N}]/gu,'')!==suggestion.proposed.replace(/[\p{L}\p{N}]/gu,'')&&suggestion.original.replace(/[^\p{L}\p{N}]/gu,'')===suggestion.proposed.replace(/[^\p{L}\p{N}]/gu,'');
  const original=suggestion.original.trim(),proposed=suggestion.proposed.trim();
  return /^[\p{L}]+$/u.test(original)&&/^[\p{L}]+$/u.test(proposed)&&oneEditApart(original,proposed);
}
