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
  return walk(doc);
}

export function initializeTemplateTracking(doc: RichNode): RichNode {
  const next = prepareInlineDocument(doc, false);
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
  function walk(n: RichNode) {
    if (n.content) n.content = n.content.filter(child => {
      const mark = fieldMark(child);
      if (mark) {
        const id = String(mark.attrs?.id ?? '');
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
function placeholderRange(state: EditorState, pos?: number): FieldRange | null {
  const ranges: FieldRange[] = [];
  state.doc.descendants((node, at) => {
    const mark = node.marks.find(m => m.type.name === 'templateField' && m.attrs.filled === false);
    if (!node.isText || !mark) return;
    const previous = ranges.at(-1);
    if (previous && previous.to === at && previous.mark.attrs.id === mark.attrs.id) previous.to = at + node.nodeSize;
    else ranges.push({ from: at, to: at + node.nodeSize, mark });
  });
  const cursor = pos ?? state.selection.from;
  return ranges.find(r => cursor >= r.from && (pos === undefined ? cursor < r.to && state.selection.to <= r.to : cursor <= r.to)) ?? null;
}

function replacePlaceholder(view: EditorView, text: string, pos?: number): boolean {
  const range = placeholderRange(view.state, pos);
  if (!range) return false;
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
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        transformPasted(slice) {
          // Copied fields are new occurrences. Keep rich text but never merge
          // their values with the original field through a repeated ID.
          const ids = new Map<string, string>();
          const copy = (fragment: Fragment): Fragment => {
            const nodes: import('@tiptap/pm/model').Node[] = [];
            fragment.forEach(node => {
              const marks = node.marks.map(mark => {
                if (mark.type.name !== 'templateField') return mark;
                const old = String(mark.attrs.id);
                const id = ids.get(old) ?? `pasted_${crypto.randomUUID().replaceAll('-', '')}`;
                ids.set(old, id);
                return mark.type.create({ ...mark.attrs, id });
              });
              nodes.push((node.isLeaf ? node : node.copy(copy(node.content))).mark(marks));
            });
            return Fragment.fromArray(nodes);
          };
          return new Slice(copy(slice.content), slice.openStart, slice.openEnd);
        },
        handleClick(view, pos, event) {
          const el = (event.target as HTMLElement).closest<HTMLElement>('[data-template-field][data-filled="false"]');
          if (!el) return false;
          const range = placeholderRange(view.state, pos);
          if (!range) return false;
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to)));
          return true;
        },
        handleTextInput(view, _from, _to, text) { return replacePlaceholder(view, text); },
        handlePaste(view, event) {
          if (!placeholderRange(view.state)) return false;
          const text = event.clipboardData?.getData('text/plain');
          if (text === undefined) return false;
          return replacePlaceholder(view, text.replace(/\r\n?/g, '\n'));
        },
        handleKeyDown: (view, event) => {
          if (!['Backspace', 'Delete', 'Enter'].includes(event.key) || !placeholderRange(view.state)) return false;
          if (!replacePlaceholder(view, '')) return false;
          if (event.key === 'Enter') this.editor.commands.splitBlock();
          return true;
        },
      },
      // Input methods and formatted paste can bypass handleTextInput. A changed
      // prompt is still marked as filled, in the same undo event as the input.
      appendTransaction(transactions, _old, state) {
        if (!transactions.some(t => t.docChanged) || transactions.some(t => t.getMeta('inline-field-fix'))) return null;
        const groups = new Map<string, { text: string; nodes: { pos: number; size: number; mark: PMMark }[] }>();
        state.doc.descendants((node, pos) => {
          const mark = node.marks.find(m => m.type.name === 'templateField' && m.attrs.filled === false);
          if (!node.isText || !mark) return;
          const group = groups.get(mark.attrs.id) ?? { text: '', nodes: [] };
          group.text += node.text; group.nodes.push({ pos, size: node.nodeSize, mark }); groups.set(mark.attrs.id, group);
        });
        let tr: Transaction | undefined;
        for (const group of groups.values()) if (group.text !== group.nodes[0].mark.attrs.hint) {
          tr ??= state.tr;
          for (const n of group.nodes) tr.removeMark(n.pos, n.pos + n.size, n.mark).addMark(n.pos, n.pos + n.size, n.mark.type.create({ ...n.mark.attrs, filled: true }));
        }
        return tr?.setMeta('inline-field-fix', true);
      },
    })];
  },
});

export const SourceFormat = Extension.create({
  name: 'sourceFormat',
  addGlobalAttributes() {
    const attr = (defaultValue: unknown = null) => ({ default: defaultValue, renderHTML: () => ({}) });
    const paragraphAttrs: Record<string, any> = { templateOriginal: attr(), sourceStyle: { default: null, renderHTML: (a: Record<string,any>) => a.sourceStyle ? { 'data-source-style':a.sourceStyle } : {} } };
    for (const [name, property, unit] of [
      ['fontFamily', 'font-family', ''], ['fontSizePt', 'font-size', 'pt'], ['spaceBeforePt', 'margin-top', 'pt'], ['spaceAfterPt', 'margin-bottom', 'pt'], ['lineHeight', 'line-height', ''],
    ]) paragraphAttrs[name] = { default: null, renderHTML: (a: Record<string, any>) => a[name] != null ? { style: `${property}:${a[name]}${unit}` } : {} };
    paragraphAttrs.keepNext = { default: null, renderHTML: (a: Record<string, any>) => a.keepNext ? { style: 'break-after:avoid', 'data-keep-next':'true' } : {} };
    paragraphAttrs.pageBreakBefore = { default: null, renderHTML: (a: Record<string, any>) => a.pageBreakBefore ? { style: 'break-before:page', 'data-page-break-before':'true' } : {} };
    return [
      { types: ['doc'], attributes: Object.fromEntries(['sourceFormat', 'pageWidthMm', 'pageHeightMm', 'marginTopMm', 'marginBottomMm', 'marginLeftMm', 'marginRightMm', 'fontFamily', 'fontSizePt', 'lineHeight', 'spaceAfterPt'].map(k => [k, attr()])) },
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
