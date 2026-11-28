import {migrateManualYellow} from './yellow-lifecycle.ts';
import { clipboardText } from './clipboard-text.ts';
import { initializeEditableHighlights } from './template-highlights.ts';
import { normalizeDateInput } from './date-input.ts';
import { reportHistoryKey } from './report-history.ts';
import { Extension, Mark, mergeAttributes, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Mark as PMMark } from '@tiptap/pm/model';
import type { RichNode } from './model';

export type InlineField = { id: string; hint: string; original: string; value: string; filled: boolean };
const fieldMark = (node: RichNode) => node.marks?.find(m => m.type === 'templateField');
const visibleText = (node: RichNode): string => node.type === 'text' ? node.text ?? '' : node.type === 'reportField'
  ? String(node.attrs?.value || node.attrs?.hint || '') : node.content?.map(visibleText).join('') ?? '';

/** Upgrade old atom fields without changing a saved report's visible text. */
export function prepareInlineDocument(input: RichNode, trackOriginal = true): RichNode {
  const doc = structuredClone(input);
  function walk(node: RichNode): RichNode {
    if (node.type === 'reportField') {
      const hint = String(node.attrs?.hint || 'Введите данные');
      const value = String(node.attrs?.value ?? '');
      return { type: 'text', text: value.trim() ? value : hint, marks: [...(node.marks ?? []).filter(m => m.type !== 'templateField'), { type: 'templateField', attrs: { id: String(node.attrs?.id ?? crypto.randomUUID()), hint, original: hint, filled: Boolean(value.trim()) } }] };
    }
    if (node.content) node.content = node.content.map(walk);
    if (trackOriginal && ['paragraph', 'heading'].includes(node.type) && node.attrs?.templateOriginal == null) node.attrs = { ...node.attrs, templateOriginal: visibleText(node) };
    return node;
  }
  return migrateManualYellow(walk(doc));
}

export function initializeTemplateTracking(doc: RichNode): RichNode {
  const next = initializeEditableHighlights(prepareInlineDocument(doc, false));
  function walk(n: RichNode) {
    if (['paragraph', 'heading'].includes(n.type)) n.attrs = { ...n.attrs, templateOriginal: visibleText(n) };
    n.content?.forEach(walk);
  }
  walk(next); return next;
}

/** Clear patient values; keep the original template prompts and rich formatting. */
export function resetInlineTemplate(doc: RichNode): RichNode {
  const next = prepareInlineDocument(doc, false);
  const seen = new Set<string>();
  // Locally authored text fields may have several styled runs. When their
  // untouched default already equals the hint, retain those runs exactly.
  const localDefaults=new Set(collectInlineFields(next).filter(f=>f.id.startsWith('local.editable.')&&!f.filled&&f.value===f.hint).map(f=>f.id));
  function walk(n: RichNode) {
    if (n.content) n.content = n.content.filter(child => {
      const mark = fieldMark(child);
      if (mark) {
        const id = String(mark.attrs?.id ?? '');
        if(localDefaults.has(id))return true;
        if (seen.has(id)) return false;
        seen.add(id);
        const hint = String(mark.attrs?.hint || mark.attrs?.original || 'Введите данные');
        child.text = hint;
        mark.attrs = { ...mark.attrs, hint, original: hint, filled: false };
      }
      walk(child); return true;
    });
  }
  walk(next); return initializeTemplateTracking(next);
}

/** Save edited prompts as template defaults, never as filled patient values. */
export function promoteInlineTemplate(doc: RichNode): RichNode {
  const next = prepareInlineDocument(doc, false);
  const values = new Map(collectInlineFields(next).map(f => [f.id, f.value]));
  function walk(n: RichNode) {
    const mark = fieldMark(n);
    if (mark) {
      const text = values.get(String(mark.attrs?.id)) || String(mark.attrs?.hint || 'Введите данные');
      mark.attrs = { ...mark.attrs, hint: text, original: text, filled: false };
    }
    n.content?.forEach(walk);
  }
  walk(next); return initializeTemplateTracking(next);
}

export function collectInlineFields(doc: RichNode): InlineField[] {
  const result = new Map<string, InlineField>();
  function walk(n: RichNode) {
    const mark = fieldMark(n);
    if (mark) {
      const a = mark.attrs ?? {}, id = String(a.id ?? '');
      const field = result.get(id) ?? { id, hint: String(a.hint ?? ''), original: String(a.original ?? a.hint ?? ''), value: '', filled: Boolean(a.filled) };
      field.value += n.text ?? '';
      field.filled ||= Boolean(a.filled);
      result.set(id, field);
    }
    n.content?.forEach(walk);
  }
  walk(doc); return [...result.values()];
}

export function countUnchangedParts(doc: RichNode): number {
  let count = 0;
  function walk(n: RichNode) {
    if (['paragraph', 'heading'].includes(n.type) && n.attrs?.templateOriginal != null && visibleText(n).trim() && visibleText(n) === n.attrs.templateOriginal) { count++; return; }
    if (fieldMark(n)?.attrs?.filled === false) count++;
    n.content?.forEach(walk);
  }
  walk(doc); return count;
}

export const TemplateHighlight = Mark.create({
  name:'templateHighlight', inclusive:false,
  addAttributes(){return {id:{default:'',parseHTML:el=>el.getAttribute('data-editable-id')}};},
  parseHTML(){return [{tag:'span[data-template-highlight]'}];},
  renderHTML({mark}){return ['span',{'data-template-highlight':'','data-editable-id':mark.attrs.id,style:'background-color:#ffff00'},0];},
});
export const TemplateSize = Mark.create({
  name:'templateSize', inclusive:false,
  addAttributes(){return {
    id:{default:'',parseHTML:el=>el.getAttribute('data-size-id')},
    original:{default:'',parseHTML:el=>el.getAttribute('data-size-original')},
    filled:{default:false,parseHTML:el=>el.getAttribute('data-size-filled')==='true'},
  };},
  parseHTML(){return [{tag:'span[data-template-size]'}];},
  renderHTML({mark}){return ['span',{'data-template-size':'','data-size-id':mark.attrs.id,'data-size-original':mark.attrs.original,'data-size-filled':String(mark.attrs.filled),...(!mark.attrs.filled?{style:'background-color:#ffff00'}:{})},0];},
});

export const TemplateField = Mark.create({
  name: 'templateField', inclusive: false,
  addAttributes() {
    return {
      id: { default: '', parseHTML: el => el.getAttribute('data-field-id'), renderHTML: () => ({}) },
      hint: { default: '', parseHTML: el => el.getAttribute('data-hint'), renderHTML: () => ({}) },
      original: { default: '', parseHTML: el => el.getAttribute('data-original'), renderHTML: () => ({}) },
      filled: { default: false, parseHTML: el => el.getAttribute('data-filled') === 'true', renderHTML: () => ({}) },
    };
  },
  parseHTML() { return [{ tag: 'span[data-template-field]' }]; },
  renderHTML({ mark, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-template-field': '', 'data-field-id': mark.attrs.id, 'data-hint': mark.attrs.hint,
      'data-original': mark.attrs.original, 'data-filled': String(mark.attrs.filled),
      class: `template-field ${mark.attrs.filled ? 'is-filled' : 'is-empty'}`,
      style: 'white-space:pre-wrap',
      title: mark.attrs.filled ? '' : 'Введите текст — подсказка будет заменена',
    }), 0];
  },
});

type FieldRange = { from: number; to: number; mark: PMMark };
const replacesPromptOnFirstInput = (mark: PMMark) => /\.(number|patient|birthdate)$/i.test(String(mark.attrs.id));

function yellowZeroRange(state: EditorState, pos: number): FieldRange | null {
  const ranges: FieldRange[] = [];
  state.doc.descendants((node, from) => {
    const mark = node.marks.find(mark => mark.type.name === 'templateSize' && !mark.attrs.filled);
    if (!node.isText || !mark) return;
    const previous = ranges.at(-1);
    if (previous && previous.to === from && previous.mark.attrs.id === mark.attrs.id) previous.to += node.nodeSize;
    else ranges.push({from, to:from+node.nodeSize, mark});
  });
  return ranges.find(range => pos >= range.from && pos <= range.to) ?? null;
}

function replaceYellowZero(view: EditorView, text: string, range: FieldRange): boolean {
  const tr = view.state.tr;
  const marks = view.state.doc.resolve(range.from).nodeAfter?.marks.filter(mark => !['templateHighlight','templateSize'].includes(mark.type.name)) ?? [];
  const filled = range.mark.type.create({...range.mark.attrs,filled:true});
  if (text) {
    tr.replaceWith(range.from, range.to, view.state.schema.text(text, [...marks,filled]));
    tr.setSelection(TextSelection.create(tr.doc, range.from + text.length));
    tr.setStoredMarks([...marks,filled]);
  } else tr.delete(range.from, range.to);
  view.dispatch(tr.scrollIntoView());
  return true;
}

function placeholderRange(state: EditorState, pos?: number, includeFilledLocal = false): FieldRange | null {
  const ranges: FieldRange[] = [];
  state.doc.descendants((node, at) => {
    const mark = node.marks.find(m => m.type.name === 'templateField' && (m.attrs.filled === false || includeFilledLocal && String(m.attrs.id).startsWith('local.editable.')));
    if (!node.isText || !mark) return;
    const previous = ranges.at(-1);
    if (previous && previous.to === at && previous.mark.attrs.id === mark.attrs.id) previous.to = at + node.nodeSize;
    else ranges.push({ from: at, to: at + node.nodeSize, mark });
  });
  const cursor = pos ?? state.selection.from;
  return ranges.find(r => cursor >= r.from && (pos === undefined ? cursor < r.to && state.selection.to <= r.to : cursor <= r.to)) ?? null;
}

function replacePlaceholder(view: EditorView, text: string, range: FieldRange): boolean {
  const tr = view.state.tr;
  const marks = view.state.doc.resolve(range.from).nodeAfter?.marks.filter(m => m.type.name !== 'templateField') ?? [];
  if (text) {
    const filled = range.mark.type.create({ ...range.mark.attrs, filled: true });
    tr.replaceWith(range.from, range.to, view.state.schema.text(text, [...marks, filled]));
    tr.setSelection(TextSelection.create(tr.doc, range.from + text.length));
    tr.setStoredMarks([...marks, filled]);
  } else tr.delete(range.from, range.to);
  view.dispatch(tr.scrollIntoView()); return true;
}

export const InlineFieldEditing = Extension.create({
  name: 'inlineFieldEditing',
  addOptions(){return {authoring:false};},
  addProseMirrorPlugins() {
    const authoring=this.options.authoring;
    return [new Plugin({
      props: {
        transformPasted(slice) {
          // Copied fields are new occurrences. Keep rich text but never merge
          // their values with the original field through a repeated ID.
          const ids = new Map<string, string>();
          const copiedId = (old:string) => {const id=ids.get(old)??`pasted_${crypto.randomUUID().replaceAll('-','')}`;ids.set(old,id);return id;};
          const copy = (fragment: Fragment): Fragment => {
            const nodes: import('@tiptap/pm/model').Node[] = [];
            fragment.forEach(node => {
              const marks = node.marks.map(mark => {
                if (!['templateField','templateSize','templateHighlight'].includes(mark.type.name)) return mark;
                return mark.type.create({...mark.attrs,id:copiedId(String(mark.attrs.id))});
              });
              const attrs = node.attrs.editableHighlight ? {...node.attrs,editableHighlight:{...node.attrs.editableHighlight,id:copiedId(node.attrs.editableHighlight.id)}} : node.attrs;
              nodes.push(node.isText ? node.mark(marks) : node.type.create(attrs,node.isLeaf?node.content:copy(node.content),marks));
            });
            return Fragment.fromArray(nodes);
          };
          return new Slice(copy(slice.content), slice.openStart, slice.openEnd);
        },
        handleTextInput(view, from, to, text) {
          if(authoring)return false;
          const zero = yellowZeroRange(view.state, from);
          if (zero && to <= zero.to) return replaceYellowZero(view, text, zero);
          const range = placeholderRange(view.state, from);
          if (!range || to > range.to) return false;
          if (!replacesPromptOnFirstInput(range.mark) && (from !== range.from || to !== range.to)) return false;
          return replacePlaceholder(view, text, range);
        },
        handlePaste(view, event, slice) {
          if(authoring)return false;
          const selection = view.state.selection;
          const zero = yellowZeroRange(view.state, selection.from);
          if (zero && selection.to <= zero.to) {
            const pasted = clipboardText(event,slice);
            if (pasted !== undefined) return replaceYellowZero(view, pasted.replace(/\r\n?/g, '\n'), zero);
          }
          const range = placeholderRange(view.state, selection.from, true);
          if (!range || selection.to > range.to) return false;
          // A local text fragment supports partial edits just like typing. Keep
          // its identity (and local visual marks) when external HTML is pasted;
          // the general paste normalizer deliberately strips field identities.
          if (String(range.mark.attrs.id).startsWith('local.editable.')) {
            if (selection.empty && selection.from === range.to) return false;
            const text = clipboardText(event,slice);
            if (text === undefined) return false;
            const marks = (view.state.storedMarks ?? selection.$from.marks()).filter(m => !['templateField','templateHighlight','templateSize'].includes(m.type.name));
            const filled = range.mark.type.create({...range.mark.attrs,filled:true});
            const tr = view.state.tr, value = text.replace(/\r\n?/g,'\n');
            if (!value && selection.empty) return false;
            if (value) tr.replaceWith(selection.from,selection.to,view.state.schema.text(value,[...marks,filled]));
            else tr.delete(selection.from,selection.to);
            tr.doc.descendants((node,pos)=>{const mark=node.marks.find(m=>m.type.name==='templateField'&&m.attrs.id===range.mark.attrs.id);if(node.isText&&mark)tr.removeMark(pos,pos+node.nodeSize,mark).addMark(pos,pos+node.nodeSize,filled);});
            tr.setSelection(TextSelection.create(tr.doc,selection.from+value.length)).setStoredMarks([...marks,filled]);
            view.dispatch(tr.setMeta('paste',true).setMeta('uiEvent','paste').scrollIntoView());return true;
          }
          if (!replacesPromptOnFirstInput(range.mark) && (selection.from !== range.from || selection.to !== range.to)) return false;
          const text = clipboardText(event,slice);
          if (text === undefined) return false;
          return replacePlaceholder(view, text.replace(/\r\n?/g, '\n'), range);
        },
      },
      // Input methods and formatted paste can bypass handleTextInput. A changed
      // prompt is still marked as filled, in the same undo event as the input.
      appendTransaction(transactions, oldState, state) {

        if (!transactions.some(t => t.docChanged) || transactions.some(t => t.getMeta('inline-field-fix'))) return null;
        // History already includes every normalization step. Reapplying field
        // cleanup during replay can drop a highlight that Undo just restored.
        if (transactions.some(t => ['undo', 'redo'].includes(t.getMeta(reportHistoryKey)?.type))) return null;
        const replacesWholeDocument = transactions.some(transaction => transaction.steps.some(step =>
          'from' in step && 'to' in step && step.from === 0 && step.to === oldState.doc.content.size));
        let tr: Transaction | undefined;
        // Only content edits complete paragraph prompts; selections and formatting do not.
        const edited = new Set<string>();
        const nextParagraphs=new Map<string,string>();state.doc.descendants(node=>{if(node.isTextblock&&node.attrs.editableHighlight)nextParagraphs.set(node.attrs.editableHighlight.id,node.textContent);});
        if(!replacesWholeDocument)oldState.doc.descendants(node=>{const prompt=node.attrs.editableHighlight;if(node.isTextblock&&prompt&&!prompt.edited&&nextParagraphs.has(prompt.id)&&nextParagraphs.get(prompt.id)!==node.textContent)edited.add(prompt.id);});
        if(!replacesWholeDocument){const collect=(doc:import('@tiptap/pm/model').Node)=>{const values=new Map<string,string>();doc.descendants(n=>{if(n.isText)for(const m of n.marks)if(m.type.name==='templateHighlight')values.set(m.attrs.id,(values.get(m.attrs.id)??'')+n.text);});return values;};const old=collect(oldState.doc),next=collect(state.doc);for(const [id,text]of old)if(next.has(id)&&next.get(id)!==text)edited.add(id);}
        if (edited.size) state.doc.descendants((node,pos) => {
          const prompt = node.attrs.editableHighlight;
          if (prompt && edited.has(prompt.id)) {
            tr ??= state.tr;
            tr.setNodeMarkup(pos,undefined,{...node.attrs,editableHighlight:{...prompt,edited:true}});
          }
          const mark = node.marks.find(mark=>mark.type.name==='templateHighlight' && edited.has(mark.attrs.id));
          if (node.isText && mark) { tr ??= state.tr; tr.removeMark(pos,pos+node.nodeSize,mark); }
        });
        if (tr?.storedMarks) tr.setStoredMarks(tr.storedMarks.filter(mark=>mark.type.name!=='templateHighlight' || !edited.has(mark.attrs.id)));
        // IME, deletion, and rich paste can bypass the direct placeholder handler.
        const sizes = new Map<string,{text:string;nodes:{pos:number;size:number;mark:PMMark}[]}>();
        state.doc.descendants((node,pos)=>{
          const mark=node.marks.find(mark=>mark.type.name==='templateSize' && !mark.attrs.filled);
          if(!node.isText||!mark)return;
          const group=sizes.get(mark.attrs.id)??{text:'',nodes:[]};
          group.text+=node.text;group.nodes.push({pos,size:node.nodeSize,mark});sizes.set(mark.attrs.id,group);
        });
        const oldSizes=new Map<string,string>();oldState.doc.descendants(n=>{if(n.isText)for(const m of n.marks)if(m.type.name==='templateSize')oldSizes.set(m.attrs.id,(oldSizes.get(m.attrs.id)??'')+n.text);});
        if (!replacesWholeDocument) for (const [id,group] of sizes) if(oldSizes.has(id)&&oldSizes.get(id)!==group.text) {
          tr??=state.tr;
          for(const n of group.nodes) tr.removeMark(n.pos,n.pos+n.size,n.mark).addMark(n.pos,n.pos+n.size,n.mark.type.create({...n.mark.attrs,filled:true}));
        }
        const groups = new Map<string, { text: string; nodes: { pos: number; size: number; mark: PMMark }[] }>();
        state.doc.descendants((node, pos) => {
          const mark = node.marks.find(m => m.type.name === 'templateField' && m.attrs.filled === false);
          if (!node.isText || !mark) return;
          const group = groups.get(mark.attrs.id) ?? { text: '', nodes: [] };
          group.text += node.text; group.nodes.push({ pos, size: node.nodeSize, mark }); groups.set(mark.attrs.id, group);
        });
        const oldFields=new Map<string,string>();oldState.doc.descendants(n=>{if(n.isText){const m=n.marks.find(m=>m.type.name==='templateField');if(m)oldFields.set(m.attrs.id,(oldFields.get(m.attrs.id)??'')+n.text);}});
        for (const [id,group] of groups) if (!replacesWholeDocument&&oldFields.has(id)&&oldFields.get(id)!==group.text) {
          tr ??= state.tr;
          for (const n of group.nodes) tr.removeMark(n.pos, n.pos + n.size, n.mark).addMark(n.pos, n.pos + n.size, n.mark.type.create({ ...n.mark.attrs, filled: true }));
        }
        const dateEdits: Array<{pos:number;size:number;text:string;marks:readonly PMMark[]}> = [];
        if(!replacesWholeDocument)state.doc.descendants((node,pos)=>{if(!node.isText)return;const normalized=normalizeDateInput(node.text??'');if(normalized!==node.text)dateEdits.push({pos,size:node.nodeSize,text:normalized,marks:node.marks});});
        for(const edit of dateEdits.reverse()){tr??=state.tr;tr.replaceWith(edit.pos,edit.pos+edit.size,state.schema.text(edit.text,tr.doc.resolve(edit.pos).nodeAfter?.marks??edit.marks));}
        return tr?.setMeta('inline-field-fix', true);
      },
    })];
  },
});

export const SourceFormat = Extension.create({
  name: 'sourceFormat',
  addGlobalAttributes() {
    const attr = (defaultValue: unknown = null) => ({ default: defaultValue, renderHTML: () => ({}) });
    const paragraphAttrs: Record<string, any> = { editableHighlight: {default:null,parseHTML:(el:HTMLElement)=>{try{return JSON.parse(el.getAttribute('data-editable-highlight')??'null');}catch{return null;}},renderHTML:(a:Record<string,any>)=>a.editableHighlight?{'data-editable-highlight':JSON.stringify(a.editableHighlight)}:{}}, templateOriginal: attr(), spacingReference: attr(), sourceStyle: { default: null, renderHTML: (a: Record<string,any>) => a.sourceStyle ? { 'data-source-style':a.sourceStyle } : {} } };
    for (const [name, property, unit] of [
      ['fontFamily', 'font-family', ''], ['fontSizePt', 'font-size', 'pt'], ['spaceBeforePt', 'margin-top', 'pt'], ['spaceAfterPt', 'margin-bottom', 'pt'], ['lineHeight', 'line-height', ''], ['firstLineIndentPt', 'text-indent', 'pt'], ['leftIndentPt', 'margin-left', 'pt'], ['rightIndentPt', 'margin-right', 'pt'],
    ]) paragraphAttrs[name] = { default: null, renderHTML: (a: Record<string, any>) => a[name] != null ? { style: `${property}:${a[name]}${unit}` } : {} };
    paragraphAttrs.keepNext = { default: null, renderHTML: (a: Record<string, any>) => typeof a.keepNext === 'boolean'
      ? { ...(a.keepNext ? {style: 'break-after:avoid'} : {}), 'data-keep-next':String(a.keepNext) } : {} };
    paragraphAttrs.pageBreakBefore = { default: null, renderHTML: (a: Record<string, any>) => a.pageBreakBefore ? { style: 'break-before:page', 'data-page-break-before':'true' } : {} };
    return [
      { types: ['doc'], attributes: Object.fromEntries(['templateSource','editableHighlightsVersion', 'sourceFormat', 'pageWidthMm', 'pageHeightMm', 'marginTopMm', 'marginBottomMm', 'marginLeftMm', 'marginRightMm', 'fontFamily', 'fontSizePt', 'lineHeight', 'spaceAfterPt'].map(k => [k, attr()])) },
      { types: ['paragraph', 'heading'], attributes: paragraphAttrs },
    ];
  },
});

const reviewKey = new PluginKey<boolean>('template-review');
export const TemplateReview = Extension.create({
  name: 'templateReview',
  addProseMirrorPlugins() {
    return [new Plugin<boolean>({
      key: reviewKey, state: { init: () => false, apply: (tr, previous) => typeof tr.getMeta(reviewKey) === 'boolean' ? tr.getMeta(reviewKey) : previous },
      props: { decorations(state) {
        if (!reviewKey.getState(state)) return DecorationSet.empty;
        const result: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (node.isTextblock && node.attrs.templateOriginal != null && node.textContent.trim() && node.textContent === node.attrs.templateOriginal) result.push(Decoration.node(pos, pos + node.nodeSize, { class: 'template-unchanged', 'data-unchanged': 'true' }));
          if (node.isText && node.marks.some(m => m.type.name === 'templateField' && (!m.attrs.filled || node.text === m.attrs.original))) result.push(Decoration.inline(pos, pos + node.nodeSize, { class: 'template-unchanged-field', 'data-unchanged': 'true' }));
        });
        return DecorationSet.create(state.doc, result);
      } },
    })];
  },
});

export function setReviewHighlights(editor: Editor, enabled: boolean) {
  editor.view.dispatch(editor.state.tr.setMeta(reviewKey, enabled));
}
