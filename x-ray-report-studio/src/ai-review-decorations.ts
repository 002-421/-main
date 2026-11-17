import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export type ReviewDecorationRange = { id: string; from: number; to: number; category: string; original: string };
const key = new PluginKey<DecorationSet>('xrsAiReviewDecorations');
const categoryClass: Record<string,string> = {
  spelling:'spelling', punctuation:'punctuation', style:'style', template:'style',
  terminology:'terminology', side:'consistency', level:'consistency', size:'consistency', consistency:'consistency', clinical:'clinical',
};

function build(doc: Parameters<typeof DecorationSet.create>[0], input: ReviewDecorationRange[]): DecorationSet {
  const ranges=input.filter(x=>Number.isInteger(x.from)&&Number.isInteger(x.to)&&x.from>=0&&x.to>x.from&&x.to<=doc.content.size);
  ranges.sort((a,b)=>a.from-b.from||a.to-b.to);
  const groups: ReviewDecorationRange[][]=[];
  for(const range of ranges){const group=groups.at(-1);if(group&&range.from<Math.max(...group.map(x=>x.to)))group.push(range);else groups.push([range]);}
  return DecorationSet.create(doc,groups.map(group=>{
    const from=Math.min(...group.map(x=>x.from)),to=Math.max(...group.map(x=>x.to));
    const categories=[...new Set(group.map(x=>categoryClass[x.category]??'style'))];
    return Decoration.inline(from,to,{
      class:`ai-review-underline ${categories.map(x=>`ai-review-${x}`).join(' ')}`,
      'data-ai-review-ids':group.map(x=>x.id).join(','),
      role:'mark', 'aria-label':`Замечание AI Review: ${categories.join(', ')}`,
    },{inclusiveStart:false,inclusiveEnd:false});
  }));
}

export const AiReviewDecorations=Extension.create({
  name:'aiReviewDecorations',
  addProseMirrorPlugins(){
    return [new Plugin<DecorationSet>({
      key,
      state:{
        init:()=>DecorationSet.empty,
        apply(tr,current){
          const ranges=tr.getMeta(key) as ReviewDecorationRange[]|undefined;
          if(ranges)return build(tr.doc,ranges);
          // A fresh editor position is required before a suggestion can be applied.
          // Clearing on edits is conservative and prevents stale ranges from being used.
          if(tr.docChanged)return DecorationSet.empty;
          return current.map(tr.mapping,tr.doc);
        },
      },
      props:{
        decorations(state){return key.getState(state)??DecorationSet.empty;},

      },
    })];
  },
});

export function setAiReviewDecorations(editor:{state:{tr:any};view:{dispatch:(tr:any)=>void}},ranges:ReviewDecorationRange[]){
  editor.view.dispatch(editor.state.tr.setMeta(key,ranges));
}
