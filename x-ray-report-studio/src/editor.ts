import {ExternalPaste} from './external-paste.ts';
import { Editor, Node, Extension, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit, BackgroundColor } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Superscript from '@tiptap/extension-superscript';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import type { RichNode } from './model';
import { TemplateHighlight, TemplateSize, TemplateField, InlineFieldEditing, TemplateReview, SourceFormat, prepareInlineDocument } from './inline-fields';
import { LiveProofreading, type ProofStatus } from './live-proofreading';
import { ReportHistory } from './report-history';
import { AiReviewDecorations } from './ai-review-decorations';
import { BULLET_STYLES, manualFillColor, ruleThickness } from './report-format-options';

const BulletPresentation = Extension.create({
  name: 'bulletPresentation',
  addGlobalAttributes() {
    return [{ types: ['bulletList'], attributes: {
      bulletStyle: {
        default: null,
        parseHTML: element => BULLET_STYLES.find(style => style === element.dataset.bulletStyle) ?? null,
        renderHTML: attrs => attrs.bulletStyle ? { 'data-bullet-style': attrs.bulletStyle } : {},
      },
    } }];
  },
});

const ReportFill = BackgroundColor.extend({
  addGlobalAttributes() {
    return [{types: ['textStyle'], attributes: {
      backgroundColor: {
        default: null,
        parseHTML: element => {
          // A copied system span carries yellow for display, never a manual fill.
          if (element.matches('[data-template-highlight], [data-template-size], [data-template-field], mark[data-color]')) return null;
          return element.style.backgroundColor ? element.getAttribute('data-manual-fill') || element.style.backgroundColor : null;
        },
        renderHTML: attrs => {
          const color = manualFillColor(attrs.backgroundColor);
          if (color) return {'data-manual-fill': color, style: `background-color:${color}`};
          const background = String(attrs.backgroundColor ?? '');
          return /^(#[\da-f]{3,8}|[a-z]+|(?:rgb|hsl)a?\([\d.,%\s+-]+\))$/i.test(background) ? {style: `background-color:${background}`} : {};
        },
      },
    }}];
  },
});

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

const ManualReportRule = Extension.create({
  name: 'manualReportRule',
  addGlobalAttributes() {
    return [{ types: ['horizontalRule'], attributes: {
      manual: {
        default: false,
        parseHTML: element => element.hasAttribute('data-manual-rule'),
        renderHTML: attrs => attrs.manual ? { 'data-manual-rule': '' } : {},
      },
      thicknessPt: {
        default: null,
        parseHTML: element => ruleThickness(element.dataset.ruleThickness) ?? null,
        renderHTML: attrs => {
          const thickness = ruleThickness(attrs.thicknessPt);
          return attrs.manual && thickness ? {'data-rule-thickness': thickness, style: `height:${thickness}pt`} : {};
        },
      },
    } }];
  },
});

const ParagraphPresentation = Extension.create({
  name: 'paragraphPresentation',
  addGlobalAttributes() {
    const points = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000 ? `${value}pt` : '';
    return [{ types: ['paragraph', 'heading'], attributes: {
      fontSizePt: { default: null, parseHTML: (element: HTMLElement) => { const match = /^(\d+(?:\.\d+)?)pt$/i.exec(element.style.fontSize); return match ? Number(match[1]) : null; }, renderHTML: attrs => points(attrs.fontSizePt) ? { style: `font-size:${points(attrs.fontSizePt)}` } : {} },
      spaceBeforePt: { default: null, parseHTML: (element: HTMLElement) => { const match = /^(\d+(?:\.\d+)?)pt$/i.exec(element.style.marginTop); return match ? Number(match[1]) : null; }, renderHTML: attrs => points(attrs.spaceBeforePt) ? { style: `margin-top:${points(attrs.spaceBeforePt)}` } : {} },
      spaceAfterPt: { default: null, parseHTML: (element: HTMLElement) => { const match = /^(\d+(?:\.\d+)?)pt$/i.exec(element.style.marginBottom); return match ? Number(match[1]) : null; }, renderHTML: attrs => points(attrs.spaceAfterPt) ? { style: `margin-bottom:${points(attrs.spaceAfterPt)}` } : {} },
    } }];
  },
});

export type ReportEditorOptions = { authoring?:boolean; getPersonalWords?: () => string[]; onProofStatus?: (status: ProofStatus) => void; onFieldSelect?: (id: string) => void };

export function makeEditor(element: HTMLElement, content: RichNode, options: ReportEditorOptions | ((id: string) => void) = {}) {
  const settings = typeof options === 'function' ? { onFieldSelect: options } : options;
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({
        undoRedo: false,
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: false, defaultProtocol: 'https' },
      }),
      TextStyleKit.configure({backgroundColor:false}),
      ReportFill,
      ParagraphPresentation, ManualReportRule, BulletPresentation,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Highlight.configure({ multicolor: true }),
      Superscript,
      Image.configure({ inline: false, allowBase64: true }),
      TableKit.configure({ table: { resizable: true, allowTableNodeSelection: true } }),
      ExternalPaste, ReportSection, ReportField, ModuleReference, SourceFormat, TemplateHighlight, TemplateSize, TemplateField, InlineFieldEditing.configure({authoring:settings.authoring??false}), TemplateReview, ReportHistory, AiReviewDecorations,
      LiveProofreading.configure({ getPersonalWords: settings.getPersonalWords ?? (() => []), onStatus: settings.onProofStatus }),
    ],
    content: prepareInlineDocument(content),
    editorProps: {
      attributes: { class: 'report-content', spellcheck: 'false', lang: 'ru', 'aria-label': 'Редактор описания МРТ' },
      handleClickOn(view, _pos, node, nodePos, _event, direct) {
        if (direct && node.type.name === 'reportField') {
          settings.onFieldSelect?.(node.attrs.id);
          return true;
        }
        return false;
      },
    },
  });
}
