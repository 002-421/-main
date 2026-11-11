import type { Editor } from '@tiptap/core';
import type { ReviewBlocks, Suggestion } from './ai-review.ts';
import { reviewPlain } from './ai-review.ts';
import type { RichNode } from './model';

/** Map a reviewed substring to one ProseMirror text node. Complex spans require manual editing. */
export function resolveReviewRange(editor: Editor, suggestion: Suggestion, blocks: ReviewBlocks): { from: number; to: number } {
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
  let offset = 0;
  let match: { from: number; to: number } | null = null;
  node.forEach((child, childPos, index) => {
    const childText = reviewPlain(child.toJSON() as RichNode);
    if ((child.type.name === 'paragraph' || child.type.name === 'heading') && child.content.content.every(inline => inline.isText)) {
      child.forEach((inline, inlinePos) => {
        const segmentStart = offset + inlinePos;
        const segmentEnd = segmentStart + inline.text!.length;
        if (start >= segmentStart && end <= segmentEnd) {
          const pmFrom = pos + 1 + childPos + 1 + inlinePos + start - segmentStart;
          match = { from: pmFrom, to: pmFrom + end - start };
        }
      });
    }
    offset += childText.length + (index < node.childCount - 1 ? 1 : 0);
  });
  if (!match) throw new Error('Фрагмент требует ручного редактирования');
  return match;
}

export function highlightReviewSuggestion(editor: Editor, suggestion: Suggestion, blocks: ReviewBlocks): void {
  const range = resolveReviewRange(editor, suggestion, blocks);
  editor.commands.setTextSelection(range);
  editor.commands.focus();
}

/** Called only after a separate physician click; one editor transaction keeps Undo/Redo intact. */
export function applyReviewSuggestion(editor: Editor, suggestion: Suggestion, blocks: ReviewBlocks): void {
  if (suggestion.state !== 'pending' || suggestion.operation === 'comment') throw new Error('Замечание не изменяет текст');
  const range = resolveReviewRange(editor, suggestion, blocks);
  if (suggestion.operation === 'insert' && range.from !== range.to) throw new Error('Неверная вставка');
  if (suggestion.operation === 'delete' && suggestion.proposed) throw new Error('Неверное удаление');
  const replacement = suggestion.operation === 'delete' ? '' : suggestion.proposed;
  editor.view.dispatch(editor.state.tr.insertText(replacement, range.from, range.to));
}
