import { Extension } from '@tiptap/core';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export type AIHighlightRange = { from:number; to:number; finding:number };
const aiReviewKey = new PluginKey<DecorationSet>('aiReviewHighlights');

export const AIReviewHighlights = Extension.create({
  name: 'aiReviewHighlights',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: aiReviewKey,
      state: {
        init: () => DecorationSet.empty,
        apply(transaction, decorations) {
          const ranges = transaction.getMeta(aiReviewKey) as AIHighlightRange[] | undefined;
          if (ranges) return DecorationSet.create(transaction.doc, ranges.filter(range => range.from >= 0 && range.to <= transaction.doc.content.size && range.from < range.to).map(range =>
            Decoration.inline(range.from, range.to, { class: 'ai-review-highlight', 'data-ai-finding': String(range.finding) }, { inclusiveStart:false, inclusiveEnd:false }),
          ));
          return decorations.map(transaction.mapping, transaction.doc);
        },
      },
      props: { decorations(state) { return aiReviewKey.getState(state) ?? null; } },
    })];
  },
});

export function setAIReviewHighlights(editor: { state:any; view:{dispatch:(transaction:any)=>void} }, ranges:AIHighlightRange[]) {
  editor.view.dispatch(editor.state.tr.setMeta(aiReviewKey, ranges));
}
