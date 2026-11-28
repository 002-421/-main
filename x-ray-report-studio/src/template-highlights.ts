import type { RichNode } from './model.ts';

export const EDITABLE_HIGHLIGHT_VERSION = 1;
export const textOf = (node: RichNode): string => node.type === 'text' ? node.text ?? '' : node.type === 'reportField'
  ? String(node.attrs?.value || node.attrs?.hint || '') : node.content?.map(textOf).join('') ?? '';
const yellow = (node: RichNode) => node.marks?.some(mark => mark.type === 'highlight' && /^(#ffff00|yellow)$/i.test(String(mark.attrs?.color ?? '')));
const fingerprint = (text: string) => {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
};

/** Interpret legacy yellow ONLY at the template boundary, never when restoring a report. */
export function initializeEditableHighlights(input: RichNode): RichNode {
  const doc = structuredClone(input);
  if (doc.attrs?.editableHighlightsVersion === EDITABLE_HIGHLIGHT_VERSION) return doc;
  const occurrences = new Map<string, number>();
  const visit = (node: RichNode) => {
    if (['paragraph', 'heading'].includes(node.type)) {
      const children = node.content ?? [];
      if (!children.some(child => child.type === 'text' && yellow(child) && !child.marks?.some(mark => mark.type === 'templateField'))) return;
      const original = textOf(node), key = fingerprint(original), occurrence = occurrences.get(key) ?? 0;
      occurrences.set(key, occurrence + 1);
      const id = node.attrs?.editableHighlight?.id ?? `editable.${key}.${occurrence}`;
      node.attrs = {...node.attrs, editableHighlight: {id, original, edited: false}};
      const runs = children.map(child => ({child, from: 0, to: 0}));
      let offset = 0;
      for (const run of runs) { run.from = offset; offset += textOf(run.child).length; run.to = offset; }
      const sizes = [...original.matchAll(/(?<![\d,])0,0+(?![\d,])/g)].filter(match => {
        const start = match.index!, end = start + match[0].length;
        return runs.filter(run => run.from < end && run.to > start).every(run => run.child.type === 'text' && yellow(run.child)
          && !run.child.marks?.some(mark => mark.type === 'templateField'));
      }).map((match, index) => ({from: match.index!, to: match.index! + match[0].length, id: `${id}.size.${index}`, original: match[0]}));
      node.content = runs.flatMap(({child, from, to}) => {
        if (child.type !== 'text' || !yellow(child) || child.marks?.some(mark => mark.type === 'templateField')) return [child];
        const marks = (child.marks ?? []).filter(mark => !(mark.type === 'highlight' && /^(#ffff00|yellow)$/i.test(String(mark.attrs?.color ?? ''))));
        const cuts = [...new Set([from, to, ...sizes.flatMap(size => [size.from, size.to]).filter(at => at > from && at < to)])].sort((a,b) => a-b);
        return cuts.slice(0,-1).map((start,index) => {
          const end = cuts[index+1], size = sizes.find(size => start >= size.from && end <= size.to);
          return {...child, text: child.text!.slice(start-from,end-from), marks: [...marks,
            {type:'templateHighlight',attrs:{id}}, ...(size ? [{type:'templateSize',attrs:{id:size.id,original:size.original,filled:false}}] : [])]};
        });
      });
      return;
    }
    node.content?.forEach(visit);
  };
  visit(doc);
  doc.attrs = {...doc.attrs, editableHighlightsVersion: EDITABLE_HIGHLIGHT_VERSION};
  return doc;
}

/** Snapshot used by audit/import tooling; no patient text is logged. */
export function editableHighlightStructure(doc: RichNode) {
  const paragraphs: string[] = [], sizes = new Map<string,string>(), fields = new Map<string,string>();
  const visit = (node: RichNode) => {
    if (node.attrs?.editableHighlight) paragraphs.push(node.attrs.editableHighlight.id);
    for (const mark of node.marks ?? []) {
      if (mark.type === 'templateSize') sizes.set(mark.attrs?.id,mark.attrs?.original);
      if (mark.type === 'templateField') fields.set(mark.attrs?.id,mark.attrs?.hint);
    }
    if (node.type === 'reportField') fields.set(node.attrs?.id,node.attrs?.hint);
    node.content?.forEach(visit);
  };
  visit(doc); return {paragraphs, sizes:[...sizes].map(([id,original])=>({id,original})), fields:[...fields].map(([id,hint])=>({id,hint}))};
}
