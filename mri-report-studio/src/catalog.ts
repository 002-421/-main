import source from './catalog.json' with { type: 'json' };
import ctSource from './ct-catalog.json' with { type: 'json' };
import type { RichNode } from './model';
import { compactTemplateTables, separateRecommendations, highlightDeletionNotes } from './table-layout.ts';
import piRadsReference from './assets/pi-rads-v21.ts';

export type ReportTemplate = {
  id: string;
  areaId: string;
  title: string;
  description: string;
  sourceFiles: string[];
  doc: RichNode;
};
export type ReportBlock = {
  id: string;
  title: string;
  description: string;
  doc: RichNode;
  conclusion: RichNode[];
};

export const areas = [...source.areas, ...ctSource.areas];
export const PATIENT_FIELD_ID = source.patientFieldId;
export const DOCTOR_FIELD_ID = source.doctorFieldId;
export const DEFAULT_TEMPLATE_ID = source.defaultTemplateId;
export const templatePage = source.page;
export const reportTemplates = [...source.templates, ...ctSource.templates] as ReportTemplate[];
export const reportBlocks = source.blocks as ReportBlock[];

/** A new independent document with source formatting and blank entry fields. */
export function makeTemplateDocument(templateId = DEFAULT_TEMPLATE_ID): RichNode {
  const template = reportTemplates.find(item => item.id === templateId);
  if (!template) throw new Error('Шаблон исследования не найден.');
  const document = structuredClone(template.doc);
  if (templateId === 'pelvis-omt-zh' || templateId === 'pelvis-omt-zh-ku') {
    const content = document.content ??= [];
    if (!content.some(node => node.type === 'paragraph' && /День цикла\s*:/i.test((node.content ?? []).map(child => child.text ?? '').join('')))) {
      const birthDate = content.findIndex(node => node.type === 'paragraph' && /Дата рождения\s*:/i.test((node.content ?? []).map(child => child.text ?? '').join('')));
      content.splice(birthDate >= 0 ? birthDate + 1 : 2, 0, { type: 'paragraph', content: [
        { type: 'text', text: 'День цикла: ', marks: [{ type: 'bold' }] },
        { type: 'reportField', attrs: { id: `${templateId}.cycle-day`, hint: '0', value: '' }, marks: [{ type: 'bold' }] },
        { type: 'text', text: ' день', marks: [{ type: 'bold' }] },
      ] });
    }
  }
  if (templateId === 'pelvis-omt-m' || templateId === 'pelvis-omt-m-ku') {
    const content = document.content ??= [];
    const plain = (node: RichNode): string => node.type === 'text' ? node.text ?? '' : node.content?.map(plain).join('') ?? '';
    const physician = content.findIndex(node => node.type === 'paragraph' && /Врач\s*:/i.test(plain(node)));
    let reference = content.findIndex(node => node.type === 'paragraph' && /Справочная информация/i.test(plain(node)));
    if (reference < 0) {
      reference = physician + 1;
      content.splice(reference, 0, { type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'Справочная информация. Удалять!' }] });
    }
    content.splice(reference + 1, 0, { type: 'image', attrs: {
      src: piRadsReference, alt: 'Справочная схема PI-RADS v2.1 (2019)', width: 640, height: 291,
    } });
  }
  return highlightDeletionNotes(separateRecommendations(compactTemplateTables(document)));
}
