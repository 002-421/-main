import source from './catalog.json' with { type: 'json' };
import type { RichNode } from './model';

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

export const areas = [
  { id: 'brain', title: 'Головной мозг' },
  { id: 'vessels', title: 'Сосуды головного мозга' },
  { id: 'pituitary', title: 'Гипофиз' },
  { id: 'orbits', title: 'Орбиты' },
  { id: 'sinuses', title: 'Околоносовые пазухи' },
  { id: 'custom', title: 'Другая область' },
];

export const PATIENT_FIELD_ID = 'HEAD.BASE.1.FIELD.0001';
export const DOCTOR_FIELD_ID = 'HEAD.BASE.2.FIELD.0043';
export const templatePage = source.page;
export const reportTemplates = source.templates as ReportTemplate[];
export const reportBlocks = source.blocks as ReportBlock[];

/** A new independent document with source formatting and blank entry fields. */
export function makeTemplateDocument(templateId = 'brain'): RichNode {
  const template = reportTemplates.find(item => item.id === templateId);
  if (!template) throw new Error('Шаблон исследования не найден.');
  return structuredClone(template.doc);
}
