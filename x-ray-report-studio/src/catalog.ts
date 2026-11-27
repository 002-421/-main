import { justifyDescription } from './description-alignment.ts';
import source from './catalog.json' with { type: 'json' };
import ctSource from './ct-catalog.json' with { type: 'json' };
import { addReportSeparators } from './report-separators.ts';
import {validateTemplate, type RichNode} from './model.ts';
import type {CatalogTemplate,TemplateRevision} from './template-update-types.ts';
import { compactTemplateTables, separateRecommendations, highlightDeletionNotes } from './table-layout.ts';
import piRadsReference from './assets/pi-rads-v21.ts';
import { highlightBrainAlternatives } from './template-alternatives.ts';
import { INITIAL_TEMPLATE_VERSION } from './template-versioning.ts';

export type ReportTemplate = {
  id: string;
  areaId: string;
  title: string;
  description: string;
  templateVersion: string;
  sourceFiles: string[];
  doc: RichNode;
  retired?: boolean;
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
const rawReportTemplates = [...source.templates, ...ctSource.templates] as unknown as ReportTemplate[];
export const reportTemplates = rawReportTemplates.map(template => ({
  ...template,
  // Template revisions evolve independently from XRS releases. Existing local
  // revision maps are applied by the workspace without rewriting user overrides.
  templateVersion: typeof template.templateVersion === 'string' ? template.templateVersion : INITIAL_TEMPLATE_VERSION,
})) as ReportTemplate[];
export const reportBlocks = source.blocks as ReportBlock[];
const baseTemplates=structuredClone(reportTemplates),baseAreas=structuredClone(areas);
let revisionMetadata:TemplateRevision[]=[];
export const setTemplateRevisions=(rows:TemplateRevision[])=>{revisionMetadata=structuredClone(rows);};
export const revisionsForTemplate=(id:string)=>revisionMetadata.filter(r=>r.templateId===id);
const networkTemplates=new Map<string,RichNode>(),networkRecords=new Map<string,CatalogTemplate>();
export const networkTemplateSource=(id:string)=>{const row=networkRecords.get(id);return row?structuredClone(row):undefined;};
/** Only validated template snapshots are replaced. Existing report documents,
 * local overrides, histories and doctor settings are never accessed here. */
export function applyTemplateCatalog(input:CatalogTemplate[],latestActive:CatalogTemplate[]=input){
 if(!Array.isArray(input)||input.length>500)throw Error('Некорректный каталог шаблонов.');
 const prepared=new Map<string,CatalogTemplate>();
 for(const item of input){
  if(prepared.has(item.id)||!item.title||!item.areaTitle)throw Error('Конфликт шаблонов.');
  validateTemplate(item.doc);prepared.set(item.id,structuredClone(item));
 }
 const next=structuredClone(baseTemplates),nextAreas=structuredClone(baseAreas);
 // Keep retired metadata so old tabs and saved reports can still resolve their
 // template IDs; only the list for creating a report hides retired templates.
 for(const old of reportTemplates)if(!next.some(t=>t.id===old.id))next.push({...structuredClone(old),retired:true});
 const docs=new Map<string,RichNode>();
 for(const item of prepared.values()){
  const index=next.findIndex(t=>t.id===item.id),previous=index>=0?next[index]:undefined;
  const row:ReportTemplate={id:item.id,title:item.title,areaId:item.areaId,description:previous?.description??'',sourceFiles:previous?.sourceFiles??[],templateVersion:item.templateVersion,doc:item.doc,retired:item.retired};
  if(index>=0)next[index]=row;else next.push(row);
  if(!nextAreas.some(a=>a.id===item.areaId))nextAreas.push({id:item.areaId,title:item.areaTitle});docs.set(item.id,item.doc);
 }
 if(!next.some(t=>!t.retired))throw Error('В каталоге нет доступных шаблонов.');
 reportTemplates.splice(0,reportTemplates.length,...next);areas.splice(0,areas.length,...nextAreas);
 networkTemplates.clear();networkRecords.clear();for(const [id,doc]of docs)networkTemplates.set(id,doc);for(const [id,row]of prepared)networkRecords.set(id,structuredClone(row));for(const row of latestActive)if(!row.retired&&reportTemplates.some(t=>t.id===row.id&&!t.retired)){networkRecords.set(row.id,structuredClone(row));}
}
export const networkTemplate=(id:string)=>networkTemplates.has(id);
export const templateAvailable=(id:string)=>Boolean(reportTemplates.find(t=>t.id===id&&!t.retired));


const plain = (node: RichNode): string => node.type === 'text' ? node.text ?? '' : node.content?.map(plain).join('') ?? '';
const serviceFooter = /^(?:Данное заключение не является диагнозом|Исследование выполнено на магнитно-резонансном томографе)(?:\s|$)/iu;

function addYellowBold(marks: RichNode['marks'] = []) {
  const result = structuredClone(marks ?? []);
  if (!result.some(mark => mark.type === 'bold')) result.push({ type: 'bold' });
  const yellow = result.find(mark => mark.type === 'highlight');
  if (yellow) yellow.attrs = { ...yellow.attrs, color: '#ffff00' };
  else result.push({ type: 'highlight', attrs: { color: '#ffff00' } });
  const style = result.find(mark => mark.type === 'textStyle');
  if (style) style.attrs = { ...style.attrs, fontSize: '14.66667px' };
  else result.push({ type: 'textStyle', attrs: { fontSize: '14.66667px' } });
  return result;
}

/** Replace a legacy spinal heading even when Word split it into styled runs. */
function normalizeSpinalHeadings(node: RichNode) {
  if (node.content) {
    if (node.type === 'paragraph' || node.type === 'heading') {
      const replacements = [
        ['Дорзальные грыжи дисков:', 'Дорзальные -ая экструзии -я дисков -а:'],
        ['Дорзальные протрузии дисков:', 'Дорзальные -ая протрузии -я дисков -а:'],
      ] as const;
      const result: RichNode[] = [];
      for (let i = 0; i < node.content.length;) {
        if (node.content[i].type !== 'text') { result.push(node.content[i++]); continue; }
        let end = i;
        while (end < node.content.length && node.content[end].type === 'text') end++;
        const runs = node.content.slice(i, end), combined = runs.map(run => run.text ?? '').join('');
        const matches: Array<{ start: number; end: number; replacement: string }> = [];
        for (const [needle, replacement] of replacements) {
          for (const match of combined.matchAll(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')))
            matches.push({ start: match.index!, end: match.index! + match[0].length, replacement });
        }
        matches.sort((a, b) => a.start - b.start);
        let cursor = 0;
        const appendRange = (from: number, to: number) => {
          let offset = 0;
          for (const run of runs) {
            const text = run.text ?? '', runEnd = offset + text.length;
            const left = Math.max(from, offset), right = Math.min(to, runEnd);
            if (right > left) result.push({ ...run, text: text.slice(left - offset, right - offset) });
            offset = runEnd;
          }
        };
        for (const match of matches) {
          if (match.start < cursor) continue;
          appendRange(cursor, match.start);
          let offset = 0, sourceRun = runs[0];
          for (const run of runs) { if (match.start < offset + (run.text ?? '').length) { sourceRun = run; break; } offset += (run.text ?? '').length; }
          result.push({ type: 'text', text: match.replacement, marks: addYellowBold(sourceRun.marks) });
          cursor = match.end;
        }
        appendRange(cursor, combined.length);
        i = end;
      }
      node.content = result;
    } else node.content.forEach(normalizeSpinalHeadings);
  }
}

function removeServiceFooter(node: RichNode) {
  if (!node.content) return;
  node.content = node.content.filter(child => !(child.type === 'paragraph' && serviceFooter.test(plain(child).trim())));
  node.content.forEach(removeServiceFooter);
}

/** A new independent document with source formatting and blank entry fields. */
export function makeTemplateDocument(templateId = DEFAULT_TEMPLATE_ID): RichNode {
 const template=reportTemplates.find(t=>t.id===templateId);if(!template)throw Error('Шаблон исследования не найден.');
 if(networkTemplates.has(templateId))return structuredClone(networkTemplates.get(templateId)!);
 return sourceDocument(template);
}
export function makeBuiltinTemplateDocument(id:string):RichNode {const template=baseTemplates.find(t=>t.id===id);if(!template)throw Error('Встроенный шаблон не найден.');return sourceDocument(template);}
function sourceDocument(template:ReportTemplate):RichNode {
 const templateId=template.id,document=structuredClone(template.doc);
  normalizeSpinalHeadings(document);
  removeServiceFooter(document);
  const spacing = (node: RichNode) => { if (['doc','paragraph','heading'].includes(node.type)) node.attrs={...node.attrs,lineHeight:1.05}; for(const mark of node.marks ?? []) if(mark.type==='textStyle' && mark.attrs) delete mark.attrs.lineHeight; node.content?.forEach(spacing); }; spacing(document);
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
  return justifyDescription(addReportSeparators(highlightBrainAlternatives(highlightDeletionNotes(separateRecommendations(compactTemplateTables(document)), { ct: templateId.startsWith('ct-') }), templateId)));
}
