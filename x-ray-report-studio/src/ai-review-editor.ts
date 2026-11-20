import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { medicalLexicon } from './medical-lexicon.ts';
import type { ReviewBlocks, Suggestion } from './ai-review.ts';
import { reviewPlain, proofreadingBlocks } from './ai-review.ts';
import type { RichNode } from './model';

const reviewErrors = {
  'wrong-document': 'Открыт другой документ. Вернитесь к проверенной вкладке.',
  'stale-text': 'Текст изменился после проверки. Дождитесь повторной проверки.',
  'unmapped-range': 'Не удалось однозначно найти фрагмент. Повторите проверку.',
  'medical-confirmation': 'Замена может изменить медицинский смысл. Сверьте оба варианта перед подтверждением.',
  'invalid-operation': 'Этот вариант нельзя применить к выбранному фрагменту.',
} as const;

export class ReviewEditError extends Error {
  readonly code: keyof typeof reviewErrors;
  constructor(code: keyof typeof reviewErrors) { super(reviewErrors[code]); this.code = code; }
}

/** Map checked text within one paragraph, across marked text runs only. */
export function resolveReviewRange(editor: Editor, suggestion: Suggestion, blocks: ReviewBlocks, expectedTabId?: string, activeTabId?: string): { from: number; to: number } {
  if (expectedTabId && expectedTabId !== activeTabId) throw new ReviewEditError('wrong-document');
  const doc = editor.state.doc;
  const snapshot = blocks[suggestion.blockId];
  if (typeof snapshot !== 'string') throw new ReviewEditError('unmapped-range');
  if (!Number.isSafeInteger(suggestion.from) || !Number.isSafeInteger(suggestion.to) ||
    suggestion.from < 0 || suggestion.from > suggestion.to || suggestion.to > snapshot.length ||
    snapshot.slice(suggestion.from, suggestion.to) !== suggestion.original) throw new ReviewEditError('stale-text');

  function textRange(from: number, to: number) {
    if (from < 0 || to > doc.content.size) throw new ReviewEditError('unmapped-range');
    const a = doc.resolve(from), b = doc.resolve(to);
    if (!a.sameParent(b) || !a.parent.isTextblock) throw new ReviewEditError('unmapped-range');
    let textOnly = true;
    a.parent.nodesBetween(a.parentOffset, b.parentOffset, node => { if (!node.isText) textOnly = false; });
    if (!textOnly) throw new ReviewEditError('unmapped-range');
    if (doc.textBetween(from, to) !== suggestion.original) throw new ReviewEditError('stale-text');
    return {from, to};
  }

  if (suggestion.blockId.startsWith('paragraph@')) {
    const pos = Number(suggestion.blockId.slice(10));
    if (!Number.isSafeInteger(pos) || pos < 0 || pos >= doc.content.size) throw new ReviewEditError('unmapped-range');
    const node = doc.nodeAt(pos);
    if (!node?.isTextblock) throw new ReviewEditError('unmapped-range');
    const current = proofreadingBlocks(doc.toJSON() as RichNode)[suggestion.blockId];
    if (snapshot !== current) throw new ReviewEditError('stale-text');
    return textRange(pos + 1 + suggestion.from, pos + 1 + suggestion.to);
  }
  const sections: { node: typeof doc; pos: number }[] = [];
  doc.forEach((node, pos) => { if (node.type.name === 'reportSection' && node.attrs.id === suggestion.blockId) sections.push({ node, pos }); });
  if (sections.length !== 1) throw new ReviewEditError('unmapped-range');
  const { node, pos } = sections[0];
  let raw: string;
  try { raw = reviewPlain(node.toJSON() as RichNode); } catch { throw new ReviewEditError('unmapped-range'); }
  if (raw.trim() !== snapshot) throw new ReviewEditError('stale-text');
  const trimStart = raw.length - raw.trimStart().length;
  const start = suggestion.from + trimStart, end = suggestion.to + trimStart;
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
  if (!match) throw new ReviewEditError('unmapped-range');
  return textRange(match.from, match.to);
}

export function highlightReviewSuggestion(editor: Editor, suggestion: Suggestion, blocks: ReviewBlocks, expectedTabId?: string, activeTabId?: string): void {
  const range = resolveReviewRange(editor, suggestion, blocks, expectedTabId, activeTabId);
  editor.commands.setTextSelection(range);
  editor.commands.focus();
}

type ApplyOptions = {
  checkedDocument?: ProseMirrorNode;
  spellingText?: string;
  medicalConfirmed?: boolean;
};

/** Called after a physician click. All checks run before the single undoable transaction. */
export function applyReviewSuggestion(editor: Editor, suggestion: Suggestion, blocks: ReviewBlocks, expectedTabId?: string, activeTabId?: string, options: ApplyOptions = {}): void {
  if (expectedTabId && expectedTabId !== activeTabId) throw new ReviewEditError('wrong-document');
  if (options.checkedDocument && options.checkedDocument !== editor.state.doc) throw new ReviewEditError('stale-text');
  const manual = options.spellingText !== undefined;
  if (suggestion.state !== 'pending' || (manual ? suggestion.category !== 'spelling' : suggestion.operation === 'comment')) {
    throw new ReviewEditError('invalid-operation');
  }
  const range = resolveReviewRange(editor, suggestion, blocks, expectedTabId, activeTabId);
  const operation = manual ? 'replace' : suggestion.operation;
  const replacement = manual ? options.spellingText! : operation === 'delete' ? '' : suggestion.proposed;
  if ((operation === 'insert') !== (range.from === range.to) ||
    (operation === 'delete' && suggestion.proposed) ||
    (operation === 'replace' && (manual ? !replacement.trim() : !replacement)) ||
    /[\p{Cc}\p{Zl}\p{Zp}]/u.test(replacement) || replacement === suggestion.original) {
    throw new ReviewEditError('invalid-operation');
  }
  // A manual spelling edit is the physician's text. Uncertain or clinical
  // changes still require a second, explicit confirmation of these exact words.
  if (manual) {
    if (!isRoutineReviewReplacement(suggestion, replacement) && !options.medicalConfirmed) {
      throw new ReviewEditError('medical-confirmation');
    }
  } else if (!isSafeReviewReplacement(suggestion)) {
    throw new ReviewEditError('invalid-operation');
  }
  const tr = editor.state.tr.insertText(replacement, range.from, range.to).setMeta('preserve-yellow-highlight', true);
  tr.setSelection(TextSelection.near(tr.doc.resolve(range.from + replacement.length)));
  editor.view.dispatch(tr);
  editor.view.focus?.();
}

const protectedClinicalValue=/(?<![\p{L}\p{N}])(?:справа|слева|прав\p{L}*|лев\p{L}*|не|нет|без|мм|см|мл|мг|невыявл\p{L}*|двусторонн\p{L}*|отсутств\p{L}*|исключить|(?:гипо|гипер|изо|просто)(?:интенсивн|денсивн)\p{L}*|грыж\p{L}*|протрузи\p{L}*|экструзи\p{L}*|опухол\p{L}*|инфаркт\p{L}*|метастаз\p{L}*|стади\p{L}*|диагноз\p{L}*|размер\p{L}*|диаметр\p{L}*|очаг\p{L}*|выявл\p{L}*|заключени\p{L}*|мозг\p{L}*|головн\p{L}*|полушари\p{L}*|лобн\p{L}*|теменн\p{L}*|затылочн\p{L}*|височн\p{L}*|ствол\p{L}*|желудоч\p{L}*|гипофиз\p{L}*|эпифиз\p{L}*|гипоталамус\p{L}*|спинн\p{L}*|позвон\p{L}*|позвоноч\p{L}*|диск\p{L}*|сустав\p{L}*|хрящ\p{L}*|кость\p{L}*|печен\p{L}*|селезен\p{L}*|почек\p{L}*|надпочеч\p{L}*|матк\p{L}*|яичник\p{L}*|простата|легк\p{L}*|плевр\p{L}*|бронх\p{L}*|сосуд\p{L}*|артери\p{L}*|вен\p{L}*|лимф\p{L}*|нерв\p{L}*|глаз\p{L}*|орбит\p{L}*|кора\p{L}*|кист\p{L}*|полип\p{L}*)(?![\p{L}\p{N}])|(?<!\d)\d+(?:[,.]\d+)?\s*(?:мм|см|мл|мг|г|°)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?:C|Th|L|S)\d{1,2}(?![\p{L}\p{N}])/iu;
function oneEditApart(left:string,right:string):boolean{
  const a=[...left.toLocaleLowerCase('ru')],b=[...right.toLocaleLowerCase('ru')];
  if(Math.abs(a.length-b.length)>1)return false;
  let i=0,j=0,edits=0;
  while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++edits>1)return false;if(a.length>=b.length)i++;if(b.length>=a.length)j++;}
  return edits+(i<a.length||j<b.length?1:0)<=1;
}
const clinicalWords = new Set<string>(medicalLexicon);
function hasClinicalContent(text: string) {
  return /\p{N}/u.test(text) || protectedClinicalValue.test(text) ||
    text.toLocaleLowerCase('ru-RU').match(/\p{L}+/gu)?.some(word => clinicalWords.has(word));
}
function isRoutineReviewReplacement(suggestion: Suggestion, proposed: string): boolean {
  const {category, original, meaningRisk} = suggestion;
  if (meaningRisk || !['spelling','punctuation','style','terminology'].includes(category)) return false;
  if (hasClinicalContent(original) || hasClinicalContent(proposed)) return false;
  if (category === 'spelling' && original !== proposed &&
    original.replace(/\s/gu, '') === proposed.replace(/\s/gu, '') && /^[\p{L} ]+$/u.test(proposed)) return true;
  if (category === 'punctuation') {
    return original.replace(/[\p{L}\p{N}]/gu, '') !== proposed.replace(/[\p{L}\p{N}]/gu, '') &&
      original.replace(/[^\p{L}\p{N}]/gu, '') === proposed.replace(/[^\p{L}\p{N}]/gu, '');
  }
  return /^[\p{L}]+$/u.test(original.trim()) && /^[\p{L}]+$/u.test(proposed.trim()) && oneEditApart(original.trim(), proposed.trim());
}

export function isSafeReviewReplacement(suggestion: Suggestion): boolean {
  return suggestion.operation !== 'comment' && suggestion.confidence !== 'limited' &&
    isRoutineReviewReplacement(suggestion, suggestion.proposed);
}
