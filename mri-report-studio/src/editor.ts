import { Editor, Node, Extension, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import { TableKit } from '@tiptap/extension-table';
import type { RichNode } from './model';

export const ReportSection = Node.create({
  name: 'reportSection',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      id: { default: '', parseHTML: el => el.getAttribute('data-section-id'), renderHTML: attrs => ({ 'data-section-id': attrs.id }) },
      title: { default: '', parseHTML: el => el.getAttribute('data-section-title'), renderHTML: attrs => ({ 'data-section-title': attrs.title }) },
      moduleId: { default: '', parseHTML: el => el.getAttribute('data-module-id'), renderHTML: attrs => ({ 'data-module-id': attrs.moduleId }) },
    };
  },
  parseHTML() { return [{ tag: 'section[data-report-section]' }]; },
  renderHTML({ HTMLAttributes }) { return ['section', mergeAttributes(HTMLAttributes, { 'data-report-section': '' }), 0]; },
});

export const ReportField = Node.create({
  name: 'reportField',
  group: 'inline', inline: true, atom: true,
  addAttributes() {
    return { id: { default: '' }, hint: { default: 'Введите данные' }, value: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'span[data-report-field]', getAttrs: (el: HTMLElement) => ({
      id: el.dataset.fieldId ?? '', hint: el.dataset.hint ?? '', value: el.dataset.value ?? '',
    }) }];
  },
  renderHTML({ node }) {
    const filled = Boolean(node.attrs.value.trim());
    return ['span', {
      'data-report-field': '', 'data-field-id': node.attrs.id,
      'data-hint': node.attrs.hint, 'data-value': node.attrs.value,
      class: `report-field ${filled ? 'is-filled' : 'is-empty'}`,
      style: 'white-space: pre-wrap;',
      title: node.attrs.hint,
    }, filled ? node.attrs.value : `⟦${node.attrs.hint}⟧`];
  },
  renderText({ node }) { return node.attrs.value.trim() ? node.attrs.value : `⟦${node.attrs.hint}⟧`; },
});

const ModuleReference = Extension.create({
  name: 'moduleReference',
  addGlobalAttributes() {
    return [{ types: ['paragraph'], attributes: {
      moduleRef: { default: null, parseHTML: el => el.getAttribute('data-module-ref'), renderHTML: a => a.moduleRef ? { 'data-module-ref': a.moduleRef } : {} },
    } }];
  },
});

export function makeEditor(element: HTMLElement, content: RichNode, selectField: (id: string) => void) {
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: false, defaultProtocol: 'https' },
      }),
      TextStyleKit,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Highlight.configure({ multicolor: true }),
      TableKit.configure({ table: { resizable: true, allowTableNodeSelection: true } }),
      ReportSection, ReportField, ModuleReference,
    ],
    content,
    editorProps: {
      attributes: { class: 'report-content', spellcheck: 'false', 'aria-label': 'Редактор описания МРТ' },
      handleClickOn(view, _pos, node, nodePos, _event, direct) {
        if (direct && node.type.name === 'reportField') {
          selectField(node.attrs.id);
          return true;
        }
        return false;
      },
    },
  });
}
