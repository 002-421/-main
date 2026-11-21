import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { DEFAULT_RULE_THICKNESS } from './report-format-options.ts';
import { isSpacingReference, spacingAtLineHeight } from './paragraph-spacing.ts';

export function insertReportLine(editor: Editor, thicknessPt = DEFAULT_RULE_THICKNESS) {
  return editor.chain().focus().command(({tr, dispatch}) => {
    const selection = tr.selection;
    if (selection instanceof NodeSelection && selection.node.type.name === 'horizontalRule') {
      if (dispatch) {
        tr.setNodeMarkup(selection.from, undefined, {...selection.node.attrs, manual: true, thicknessPt});
        tr.setSelection(NodeSelection.create(tr.doc, selection.from));
      }
      return true;
    }
    const {$head} = selection;
    for (let depth = $head.depth; depth > 0; depth--) {
      const node = $head.node(depth);
      if (!node.isTextblock) continue;
      const parent = $head.node(depth - 1), index = $head.index(depth - 1);
      const rule = tr.doc.type.schema.nodes.horizontalRule;
      // Insert beside the paragraph, never at an inline cursor position.
      const before = $head.parentOffset === 0 || index === parent.childCount - 1;
      for (const insertBefore of [before, !before]) {
        if (!insertBefore && parent === tr.doc && index === parent.childCount - 1) continue;
        const at = index + (insertBefore ? 0 : 1);
        if (!parent.canReplaceWith(at, at, rule)) continue;
        if (dispatch) {
          const pos = insertBefore ? $head.before(depth) : $head.after(depth);
          tr.insert(pos, rule.create({manual: true, thicknessPt}));
        }
        return true;
      }
    }
    return false;
  }).run();
}

export function setParagraphLineHeight(editor: Editor, lineHeight: number) {
  return editor.chain().focus().command(({tr, dispatch}) => {
    const {from, to} = tr.selection;
    let changed = false;
    tr.doc.nodesBetween(from, to, (node, pos) => {
      if (!['paragraph', 'heading'].includes(node.type.name)) return;
      if (from < to && to === pos + 1) return false;
      changed = true;
      if (!dispatch) return false;
      const element = editor.view.nodeDOM(pos);
      const style = element instanceof HTMLElement ? getComputedStyle(element) : null;
      const marked: number[] = [];
      node.descendants((child, offset) => {
        const mark = child.marks.find(item => item.type.name === 'textStyle' && item.attrs.lineHeight != null);
        if (!mark) return;
        const value = String(mark.attrs.lineHeight);
        const ratio = parseFloat(value) / (value.endsWith('%') ? 100 : 1);
        if (ratio >= .5 && ratio <= 5) marked.push(ratio);
        // Upgrade legacy inline line-height without affecting other marks.
        const start = pos + 1 + offset;
        tr.removeMark(start, start + child.nodeSize, mark);
        const attrs = {...mark.attrs, lineHeight: null};
        if (Object.values(attrs).some(value => value != null)) tr.addMark(start, start + child.nodeSize, mark.type.create(attrs));
      });
      const computedRatio = parseFloat(style?.lineHeight ?? '') / parseFloat(style?.fontSize ?? '');
      const ratio = marked.length ? Math.max(...marked)
        : Number(node.attrs.lineHeight ?? tr.doc.attrs.lineHeight ?? computedRatio);
      const points = (explicit: unknown, margin: string | undefined) =>
        typeof explicit === 'number' ? explicit : Math.max(0, (parseFloat(margin ?? '') || 0) * .75);
      const reference = isSpacingReference(node.attrs.spacingReference) ? node.attrs.spacingReference : {
        lineHeight: ratio >= .5 && ratio <= 5 ? ratio : 1.05,
        beforePt: points(node.attrs.spaceBeforePt, style?.marginTop),
        afterPt: points(node.attrs.spaceAfterPt, style?.marginBottom),
      };
      tr.setNodeMarkup(pos, undefined, {...node.attrs, ...spacingAtLineHeight(reference, lineHeight)});
      return false;
    });
    return changed;
  }).run();
}
