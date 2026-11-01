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

export const areas = source.areas;
export const PATIENT_FIELD_ID = source.patientFieldId;
export const DOCTOR_FIELD_ID = source.doctorFieldId;
export const DEFAULT_TEMPLATE_ID = source.defaultTemplateId;
export const templatePage = source.page;
export const reportTemplates = source.templates as ReportTemplate[];
export const reportBlocks = source.blocks as ReportBlock[];

/** A new independent document with source formatting and blank entry fields. */
export function makeTemplateDocument(templateId = DEFAULT_TEMPLATE_ID): RichNode {
  const template = reportTemplates.find(item => item.id === templateId);
  if (!template) throw new Error('Шаблон исследования не найден.');
  return structuredClone(template.doc);
}
