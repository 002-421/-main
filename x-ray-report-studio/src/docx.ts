import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, HeadingLevel,
  LevelFormat, LineRuleType, Packer, Paragraph, ImageRun, ShadingType, Table, TableCell,
  TableLayoutType, TableRow, Tab, TextRun, UnderlineType, WidthType, PageNumber,
  HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, TextWrappingType,
  type IParagraphOptions, type IRunOptions, type NumberingDefinition, type ParagraphChild,
} from 'docx';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { draftVersion, validateDraft, type Module, type RichNode } from './model.ts';
import { compactWordSpaces } from './word-spacing.ts';
import { DISCLAIMER_TEXT, EQUIPMENT_TEXT } from './report-footer.ts';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const STATE_PART = 'customXml/mri-report-studio.xml';
const STATE_NS = 'urn:mri-report-studio:draft:v1';
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_STATE_BYTES = 8 * 1024 * 1024;
const PAGE_WIDTH = 11906;
const PAGE_HEIGHT = 16838;
const PAGE_MARGIN = 850;
const BODY_WIDTH = PAGE_WIDTH - 2 * PAGE_MARGIN;

export type EmbeddedDocxFont = { name: string; data: Uint8Array; bold?: Uint8Array; italic?: Uint8Array; boldItalic?: Uint8Array };
export type DocxOptions = {
  profile?: string;
  customModules?: Module[];
  cache?: Record<string, { body: RichNode; conclusion?: RichNode }>;
  title?: string;
  kind?: 'report' | 'template';
  templateId?: string;
  /** Full source font faces keep Word layout stable on machines without that font installed. */
  fonts?: EmbeddedDocxFont[];
};
export type ImportedDocx = ReturnType<typeof validateDraft> & { kind: 'report' | 'template'; templateId?: string; importWarnings?: string[]; editedInWord?: boolean };

function color(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const text = value.trim().toLowerCase();
  if (/^#?[\da-f]{6}$/.test(text)) return text.replace('#', '').toUpperCase();
  if (/^#[\da-f]{3}$/.test(text)) return text.slice(1).split('').map(c => c + c).join('').toUpperCase();
  const rgb = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)(?:\s*[,/]\s*[\d.]+)?\s*\)$/.exec(text);
  if (rgb) return rgb.slice(1, 4).map(v => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('').toUpperCase();
  return ({ black: '000000', white: 'FFFFFF', red: 'FF0000', blue: '0000FF', green: '008000', yellow: 'FFFF00', gray: '808080', grey: '808080', orange: 'FFA500', purple: '800080' } as Record<string, string>)[text];
}

function halfPoints(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return;
  const match = /^([\d.]+)\s*(px|pt)?$/.exec(String(value).trim());
  if (!match) return;
  const size = Number(match[1]) * (match[2] === 'pt' ? 2 : 1.5);
  return Number.isFinite(size) && size >= 2 && size <= 400 ? Math.round(size) : undefined;
}

function cleanText(value: unknown): string {
  // XML 1.0 cannot contain these control characters, even in otherwise valid JSON text.
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '');
}

function runOptions(node: RichNode, inherited: IRunOptions = {}, omitHighlight = false): IRunOptions {
  const options: any = { ...inherited };
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') options.bold = true;
    if (mark.type === 'italic') options.italics = true;
    if (mark.type === 'underline') options.underline = { type: UnderlineType.SINGLE };
    if (mark.type === 'strike') options.strike = true;
    if (mark.type === 'code') options.font = 'Consolas';
    if (mark.type === 'subscript') options.subScript = true;
    if (mark.type === 'superscript') options.superScript = true;
    if (mark.type === 'textStyle') {
      const attrs = mark.attrs ?? {};
      if (typeof attrs.fontFamily === 'string') options.font = attrs.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      const size = halfPoints(attrs.fontSize);
      if (size) options.size = size;
      const textColor = color(attrs.color);
      if (textColor) options.color = textColor;
      const background = color(attrs.backgroundColor);
      if (background && !omitHighlight) options.shading = { type: ShadingType.CLEAR, fill: background, color: 'auto' };
    }
    if (mark.type === 'highlight' && !omitHighlight) {
      options.shading = { type: ShadingType.CLEAR, fill: color(mark.attrs?.color) ?? 'FFFF00', color: 'auto' };
    }
  }
  const field = node.marks?.find(mark => mark.type === 'templateField');
  if (field) {
    // Editor field marks carry workflow state, not a permanent report highlight.
    // Resolve after other marks so a legacy placeholder highlight cannot survive
    // the user's first edit just because of the mark ordering.
    delete options.highlight; delete options.shading;
    if (field.attrs?.filled !== true) options.highlight = 'yellow';
  }
  if (omitHighlight) { delete options.highlight; delete options.shading; }
  return options;
}

function textRuns(text: string, options: IRunOptions): TextRun[] {
  // Literal newlines in field values must become Word line breaks rather than disappear.
  return cleanText(text).split(/(\r\n|\r|\n|\t)/).filter(Boolean).map(part =>
    part === '\t' ? new TextRun({ ...options, children: [new Tab()] })
      : /^(\r\n|\r|\n)$/.test(part) ? new TextRun({ ...options, break: 1 })
        : new TextRun({ ...options, text: part }));
}

function inline(nodes: RichNode[] = [], inherited: IRunOptions = {}): ParagraphChild[] {
  return nodes.flatMap((node): ParagraphChild[] => {
    if (node.type === 'hardBreak') return [new TextRun({ ...inherited, break: 1 })];
    if (node.type === 'image') {
      const source=String(node.attrs?.src??'');
      const jpeg=/^data:image\/(?:jpeg|jpg);base64,/i.test(source);
      if(!jpeg&&!/^data:image\/png;base64,/.test(source)) return [];
      return [new ImageRun({type:jpeg?'jpg':'png',data:source,transformation:{width:Number(node.attrs?.width)||250,height:Number(node.attrs?.height)||90},...(node.attrs?.floating?{floating:{horizontalPosition:{relative:HorizontalPositionRelativeFrom.COLUMN,offset:Number(node.attrs?.positionXEmu)||0},verticalPosition:{relative:VerticalPositionRelativeFrom.PARAGRAPH,offset:Number(node.attrs?.positionYEmu)||0},allowOverlap:true,behindDocument:true,wrap:{type:TextWrappingType.NONE}}}:{}),altText:{title:'Подпись и печать врача',description:'Подпись и печать врача',name:'Подпись и печать врача'}})];
    }
    if (node.type === 'reportField') {
      const value = String(node.attrs?.value ?? '');
      const filled = Boolean(value.trim());
      const options = runOptions(node, inherited, filled);
      if (!filled) Object.assign(options, { highlight: 'yellow', shading: { type: ShadingType.CLEAR, fill: 'FFF0A4', color: 'auto' } });
      return textRuns(filled ? value : `⟦${node.attrs?.hint ?? ''}⟧`, options);
    }
    if (node.type === 'text') {
      const options = runOptions(node, inherited);
      const runs = textRuns(node.text ?? '', options);
      const link = node.marks?.find(m => m.type === 'link')?.attrs?.href;
      if (typeof link === 'string' && /^(https?:|mailto:)/i.test(link)) return [new ExternalHyperlink({ link, children: runs })];
      return runs;
    }
    return inline(node.content, inherited);
  });
}

type Context = { numbering: NumberingDefinition[]; depth: number; inherited?: IRunOptions; width?: number; indent?: number; source?: boolean; lineHeight?: number; spaceAfterPt?: number };
const ALIGNMENTS: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED,
};

function paragraph(node: RichNode, context: Context, extra: IParagraphOptions = {}): Paragraph {
  const attrs = node.attrs ?? {};
  const level = Math.min(3, Math.max(1, Number(attrs.level) || 2));
  const heading = node.type === 'heading' ? [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][level - 1] : undefined;
  // Tiptap's TextStyleKit stores the ribbon's line height on inline textStyle marks.
  const markedLineHeights: number[] = [];
  function lineHeights(child: RichNode) {
    child.marks?.forEach(mark => {
      if (mark.type !== 'textStyle' || mark.attrs?.lineHeight == null) return;
      const value = String(mark.attrs.lineHeight);
      const parsed = Number.parseFloat(value) / (value.endsWith('%') ? 100 : 1);
      if (Number.isFinite(parsed) && parsed >= 0.5 && parsed <= 5) markedLineHeights.push(parsed);
    });
    child.content?.forEach(lineHeights);
  }
  node.content?.forEach(lineHeights);
  const style = context.source && ['Title', 'Subtitle', 'Normal', 'Heading1', 'Heading2', 'Heading3'].includes(attrs.sourceStyle) ? attrs.sourceStyle : undefined;
  const sourceStyle = style ?? (heading ? `Heading${level}` : 'Normal');
  // Explicit ribbon formatting overrides the source paragraph's baseline.
  const lineHeight = markedLineHeights.length ? Math.max(...markedLineHeights) : attrs.lineHeight != null ? Number.parseFloat(String(attrs.lineHeight)) : NaN;
  const line = Number.isFinite(lineHeight) && lineHeight >= 0.5 && lineHeight <= 5 ? Math.round(lineHeight * 240) : context.source && sourceStyle === 'Title' ? 240 : Math.round((context.lineHeight ?? 1.45) * 240);
  const pt = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000 ? Math.round(value * 20) : fallback;
  const inherited: any = { ...context.inherited };
  if (context.source && sourceStyle !== 'Normal') {
    // The delivered template's theme sets majorHAnsi to Calibri. Word gives
    // that theme font precedence over the older literal rFonts family name.
    inherited.font = 'Calibri';
    inherited.color = '183A52';
    inherited.size = ({ Title: 42, Subtitle: 22, Heading1: 22, Heading2: 20, Heading3: 20 } as Record<string, number>)[sourceStyle];
  }
  if (typeof attrs.fontFamily === 'string') inherited.font = attrs.fontFamily;
  if (typeof attrs.fontSizePt === 'number' && attrs.fontSizePt > 0 && attrs.fontSizePt <= 200) inherited.size = Math.round(attrs.fontSizePt * 2);
  return new Paragraph({
    children: inline(compactWordSpaces(node.content ?? []), inherited),
    ...(style ? { style } : { heading }),
    alignment: ALIGNMENTS[attrs.textAlign],
    spacing: { line, lineRule: LineRuleType.AUTO, before: pt(attrs.spaceBeforePt, context.source && sourceStyle !== 'Normal' ? 180 : heading ? (level === 1 ? 0 : 180) : 0), after: pt(attrs.spaceAfterPt, heading ? 100 : Math.round((context.spaceAfterPt ?? 4.25) * 20)) },
    ...(typeof attrs.firstLineIndentPt === 'number' || typeof attrs.leftIndentPt === 'number' || typeof attrs.rightIndentPt === 'number' ? { indent: { ...(typeof attrs.firstLineIndentPt === 'number' ? { firstLine: pt(attrs.firstLineIndentPt, 0) } : {}), ...(typeof attrs.leftIndentPt === 'number' ? { left: pt(attrs.leftIndentPt, 0) } : {}), ...(typeof attrs.rightIndentPt === 'number' ? { right: pt(attrs.rightIndentPt, 0) } : {}) } } : {}),
    widowControl: true,
    ...(heading ? { keepNext: true, keepLines: true } : {}),
    ...(typeof attrs.keepNext === 'boolean' ? { keepNext: attrs.keepNext } : {}),
    ...(attrs.pageBreakBefore === true ? { pageBreakBefore: true } : {}),
    ...(context.indent ? { indent: { left: context.indent } } : {}),
    ...extra,
  });
}

function list(node: RichNode, context: Context): (Paragraph | Table)[] {
  const depth = Math.min(8, context.depth);
  const reference = `mri-list-${context.numbering.length + 1}`;
  const ordered = node.type === 'orderedList';
  context.numbering.push({ reference, levels: Array.from({ length: 9 }, (_, level) => ({
    level, format: ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET,
    text: ordered ? `%${level + 1}.` : ['•', '◦', '▪'][level % 3],
    start: ordered && level === depth ? Math.max(1, Math.floor(Number(node.attrs?.start) || 1)) : 1,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 360 + level * 360, hanging: 240 } }, run: { font: 'Arial' } },
  })) });
  const result: (Paragraph | Table)[] = [];
  for (const item of node.content ?? []) {
    let first = true;
    for (const child of item.content ?? []) {
      if ((child.type === 'paragraph' || child.type === 'heading') && first) {
        result.push(paragraph(child, context, { numbering: { reference, level: depth } }));
        first = false;
      } else result.push(...blocks([child], { ...context, depth: context.depth + 1, indent: 360 + depth * 360 }));
    }
    if (first) result.push(paragraph({ type: 'paragraph' }, context, { numbering: { reference, level: depth } }));
  }
  return result;
}

function span(value: unknown, limit: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, limit) : 1;
}

function table(node: RichNode, context: Context): Table {
  const rows = (node.content ?? []).filter(row => row.type === 'tableRow');
  // Track logical grid positions because cells covered by a rowspan are omitted in Tiptap JSON.
  const occupied: number[] = [];
  const placements: { node: RichNode; column: number; columns: number; rows: number }[][] = [];
  let columns = 1;
  rows.forEach((row, rowIndex) => {
    let column = 0;
    placements.push((row.content ?? []).map(cell => {
      while ((occupied[column] ?? 0) > rowIndex) column++;
      const columnSpan = span(cell.attrs?.colspan, 100);
      const rowSpan = span(cell.attrs?.rowspan, Math.max(1, rows.length - rowIndex));
      const result = { node: cell, column, columns: columnSpan, rows: rowSpan };
      for (let i = 0; i < columnSpan; i++) occupied[column + i] = rowIndex + rowSpan;
      column += columnSpan;
      columns = Math.max(columns, column);
      return result;
    }));
  });
  const width = Math.max(300, context.width ?? BODY_WIDTH);
  const requested = new Array<number>(columns).fill(0);
  placements.flat().forEach(cell => {
    const widths = cell.node.attrs?.colwidth;
    if (!Array.isArray(widths)) return;
    widths.slice(0, cell.columns).forEach((px: unknown, i: number) => {
      const value = Number(px);
      if (Number.isFinite(value) && value > 0) requested[cell.column + i] = value * 15;
    });
  });
  const fixed = requested.reduce((sum, value) => sum + value, 0);
  const missing = requested.filter(value => !value).length;
  const average = fixed ? fixed / (columns - missing) : width / columns;
  const preferred = requested.map(value => value || (fixed < width && missing ? (width - fixed) / missing : average));
  const total = preferred.reduce((sum, value) => sum + value, 0);
  const preserveSourceWidths = context.source && missing === 0 && fixed <= width + 30;
  const columnWidths = preferred.map(value => Math.max(1, Math.round(preserveSourceWidths ? value : value / total * width)));
  const tableWidth = preserveSourceWidths ? columnWidths.reduce((sum, value) => sum + value, 0) : width;
  const border = { style: BorderStyle.SINGLE, size: 4, color: context.source ? 'auto' : 'CDD6E2' };
  const docxRows = placements.map((row, index) => new TableRow({
    cantSplit: true,
    tableHeader: index === 0 && row.length > 0 && row.every(cell => cell.node.type === 'tableHeader'),
    children: row.map(cell => {
      const cellWidth = columnWidths.slice(cell.column, cell.column + cell.columns).reduce((sum, value) => sum + value, 0);
      const header = cell.node.type === 'tableHeader';
      const children = blocks(cell.node.content ?? [], { ...context, depth: 0, width: cellWidth - (context.source ? 216 : 160), inherited: { ...context.inherited, ...(header ? { bold: true } : {}) } });
      // Every Word cell must end with a paragraph, including cells containing a nested table.
      if (!(children.at(-1) instanceof Paragraph)) children.push(new Paragraph({}));
      return new TableCell({
        children, columnSpan: cell.columns, rowSpan: cell.rows,
        width: { size: cellWidth, type: WidthType.DXA },
        margins: context.source ? { top: 0, bottom: 0, left: 108, right: 108 } : { top: 70, bottom: 70, left: 90, right: 90 },
        shading: color(cell.node.attrs?.backgroundColor) ? { type: ShadingType.CLEAR, fill: color(cell.node.attrs?.backgroundColor)!, color: 'auto' } : header ? { type: ShadingType.CLEAR, fill: 'F1F4F8', color: 'auto' } : undefined,
      });
    }),
  }));
  if (!docxRows.length) docxRows.push(new TableRow({ children: [new TableCell({ children: [new Paragraph({})] })] }));
  return new Table({
    rows: docxRows, columnWidths, width: { size: tableWidth, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    // Word's source TableGrid puts the first cell's text on the body margin;
    // its border sits one cell inset plus half the border width to the left.
    ...(context.source ? { indent: { size: -113, type: WidthType.DXA } } : {}),
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
  });
}

function blocks(nodes: RichNode[], context: Context): (Paragraph | Table)[] {
  const sequence: RichNode[] = [];
  const nodeText = (node: RichNode): string => node.type === 'text' ? node.text ?? '' : (node.content ?? []).map(nodeText).join('');
  const hasDateField = (node: RichNode): boolean => Boolean(node.marks?.some(mark => mark.type === 'templateField' && String(mark.attrs?.id ?? '').endsWith('.reportdate')) || node.content?.some(hasDateField));
  for (let index = 0; index < nodes.length; index++) {
    const current = nodes[index], next = nodes[index + 1];
    if (current.type === 'paragraph' && /Врач(?:-рентгенолог)?\s*:/i.test(nodeText(current))
      && next?.type === 'paragraph' && hasDateField(next)) {
      sequence.push({ type: 'signatureRow', content: [current, next] });
      index++;
    } else sequence.push(current);
  }
  const signatureTable = (left: RichNode, right: RichNode): Table => {
    const width = Math.max(300, context.width ?? BODY_WIDTH);
    const leftWidth = Math.round(width * 0.67), rightWidth = width - leftWidth;
    const rightDate = structuredClone(right);
    const lowercaseDateLabel = (node: RichNode) => {
      if (node.type === 'text') node.text = (node.text ?? '').replace(/дата\s*:/i, 'Дата:');
      node.content?.forEach(lowercaseDateLabel);
    };
    lowercaseDateLabel(rightDate);
    const noBorders = { top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } };
    return new Table({
      rows: [new TableRow({ cantSplit: true, children: [
        new TableCell({ width: { size: leftWidth, type: WidthType.DXA }, margins: { top: 0, bottom: 0, left: 0, right: 0 }, children: [paragraph(left, { ...context, width: leftWidth }, { alignment: AlignmentType.LEFT }), paragraph({ ...rightDate, attrs: { ...rightDate.attrs, textAlign: 'left' } }, { ...context, width: leftWidth }, { alignment: AlignmentType.LEFT })] }),
        new TableCell({ width: { size: rightWidth, type: WidthType.DXA }, margins: { top: 0, bottom: 0, left: 0, right: 0 }, children: [new Paragraph({})] }),
      ] })],
      columnWidths: [leftWidth, rightWidth], width: { size: width, type: WidthType.DXA }, layout: TableLayoutType.FIXED, borders: noBorders,
    });
  };
  return sequence.flatMap((node): (Paragraph | Table)[] => {
    if (node.type === 'signatureRow') return [signatureTable(node.content![0], node.content![1])];
    if (node.type === 'image') {
      const attrs = node.attrs ?? {};
      const source = String(attrs.src ?? '');
      if (!/^data:image\/png;base64,/.test(source)) return [];
      return [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 100, after: 120 },
        children: [new ImageRun({
          type: 'png', data: source,
          transformation: { width: Number(attrs.width) || 640, height: Number(attrs.height) || 291 },
          altText: { title: String(attrs.alt ?? 'Справочная схема'), description: String(attrs.alt ?? 'Справочная схема'), name: 'Справочная схема' },
        })],
      })];
    }
    if (node.type === 'paragraph' && /Врач(?:-рентгенолог)?\s*:/i.test(nodeText(node)) && hasDateField(node)) {
      const left: RichNode[] = [], right: RichNode[] = [];
      let isDate = false;
      for (const child of node.content ?? []) {
        if (child.type === 'text' && /дата\s*:/i.test(child.text ?? '')) {
          isDate = true;
          right.push({ ...child, text: (child.text ?? '').replace(/^\s*/, '').replace(/дата\s*:/i, 'Дата:') });
        } else (isDate ? right : left).push(child);
      }
      return [signatureTable({ ...node, content: left }, { ...node, content: right })];
    }
    if (node.type === 'paragraph' || node.type === 'heading') return [paragraph(node, context)];
    if (node.type === 'table') return [table(node, context)];
    if (node.type === 'bulletList' || node.type === 'orderedList') return list(node, context);
    if (node.type === 'horizontalRule') return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, color: 'CDD6E2', size: 6 } }, spacing: { before: 100, after: 100 } })];
    if (node.type === 'blockquote') return blocks(node.content ?? [], { ...context, indent: (context.indent ?? 0) + 360 });
    if (node.type === 'codeBlock') return [paragraph(node, { ...context, inherited: { ...context.inherited, font: 'Consolas' } })];
    if (node.type === 'text' || node.type === 'reportField' || node.type === 'hardBreak') return [paragraph({ type: 'paragraph', content: [node] }, context)];
    // reportSection is an editor grouping; its real heading and body are ordinary Word blocks.
    return blocks(node.content ?? [], context);
  });
}

function base64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 32768) parts.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
  return btoa(parts.join(''));
}

async function fingerprint(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function contentHashes(zip: Record<string, Uint8Array>): Promise<Record<string, string>> {
  const entries = await Promise.all(Object.entries(zip).filter(([name]) => isWordContent(name)).map(async ([name, data]) => [name, await fingerprint(data)]));
  return Object.fromEntries(entries);
}

function isWordContent(name: string): boolean {
  return name.startsWith('word/') && (name.endsWith('.xml') || name.endsWith('.rels') || /^word\/fonts\/[^/]+\.(?:odttf|ttf|otf)$/i.test(name));
}

function validatedCache(input: unknown): Record<string, { body: RichNode; conclusion?: RichNode }> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result: Record<string, { body: RichNode; conclusion?: RichNode }> = {};
  const entries = Object.entries(input);
  if (entries.length > 100) throw new Error('В файле слишком много сохранённых модулей.');
  for (const [id, item] of entries) {
    if (!/^[A-Za-z\d_.-]{1,120}$/.test(id) || !item || typeof item !== 'object') throw new Error('Некорректный сохранённый модуль.');
    const value = item as { body?: RichNode; conclusion?: RichNode };
    if (value.body?.type !== 'reportSection' || (value.conclusion && value.conclusion.type !== 'paragraph')) throw new Error('Некорректный сохранённый модуль.');
    validateDraft({ format: 'mri-report-studio', version: draftVersion, doc: { type: 'doc', content: [value.body, ...(value.conclusion ? [value.conclusion] : [])] } });
    result[id] = { body: value.body, ...(value.conclusion ? { conclusion: value.conclusion } : {}) };
  }
  return result;
}

function validatedTemplateId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[A-Za-z\d_.-]{1,120}$/.test(value)) throw new Error('Некорректный идентификатор шаблона в файле Word.');
  return value;
}

type XmlElement = { name: string; attrs: Record<string, string>; children: (XmlElement | string)[] };
function decodeXml(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_all, entity: string) => {
    if (entity[0] === '#') { const hex = entity[1]?.toLowerCase() === 'x'; const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10); return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : ''; }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[entity.toLowerCase()] ?? '';
  });
}
/** Bounded, non-validating tokenizer for the small OOXML subset used by Word documents. */
function parseXml(xml: string): XmlElement {
  if (xml.length > MAX_STATE_BYTES * 2 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Недопустимая структура XML в файле Word.');
  const root: XmlElement = { name: '#root', attrs: {}, children: [] }, stack = [root];
  const tokens = xml.match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>|<[^>]+>|[^<]+/g) ?? [];
  if (tokens.length > 500_000) throw new Error('В документе Word слишком много элементов.');
  for (const token of tokens) {
    if (token.startsWith('<!--') || token.startsWith('<?') || token.startsWith('<!')) continue;
    if (token.startsWith('</')) { if (stack.length < 2 || stack.at(-1)!.name !== token.slice(2, -1).trim()) throw new Error('Повреждена структура XML в файле Word.'); stack.pop(); continue; }
    if (token.startsWith('<')) {
      const match = /^<([\w:.-]+)([\s\S]*?)\/?\s*>$/.exec(token); if (!match) throw new Error('Повреждена структура XML в файле Word.');
      const attrs: Record<string, string> = {}; const attrRe = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g; let attr: RegExpExecArray | null;
      while ((attr = attrRe.exec(match[2]))) attrs[attr[1]] = decodeXml(attr[2] ?? attr[3] ?? '');
      const el: XmlElement = { name: match[1], attrs, children: [] }; stack.at(-1)!.children.push(el);
      if (!/\/\s*>$/.test(token)) { if (stack.length > 64) throw new Error('Слишком глубокая структура XML в файле Word.'); stack.push(el); }
    } else if (token) stack.at(-1)!.children.push(decodeXml(token));
  }
  if (stack.length !== 1) throw new Error('Повреждена структура XML в файле Word.');
  return root;
}
const elements = (node: XmlElement, name: string) => node.children.filter((child): child is XmlElement => typeof child !== 'string' && child.name === name);
const first = (node: XmlElement, name: string) => elements(node, name)[0];
function descendants(node: XmlElement, name: string, found: XmlElement[] = []): XmlElement[] { for (const child of node.children) if (typeof child !== 'string') { if (child.name === name) found.push(child); descendants(child, name, found); } return found; }
function xmlText(node: XmlElement): string { return node.children.map(child => typeof child === 'string' ? child : xmlText(child)).join(''); }
function parseWordMarks(run: XmlElement): RichNode['marks'] {
  const props = first(run, 'w:rPr'); if (!props) return [];
  const marks: NonNullable<RichNode['marks']> = [];
  for (const [tag, type] of [['w:b', 'bold'], ['w:i', 'italic'], ['w:u', 'underline'], ['w:strike', 'strike'], ['w:vertAlign', 'subscript']] as const) {
    const el = first(props, tag); if (!el || el.attrs['w:val'] === '0' || el.attrs['w:val'] === 'none') continue;
    if (tag === 'w:vertAlign') { marks.push({ type: el.attrs['w:val'] === 'superscript' ? 'superscript' : 'subscript' }); continue; }
    marks.push({ type });
  }
  const style: Record<string, string> = {};
  const fonts = first(props, 'w:rFonts'); if (fonts) { const family = fonts.attrs['w:ascii'] ?? fonts.attrs['w:hAnsi'] ?? fonts.attrs['w:eastAsia']; if (family) style.fontFamily = family; }
  const size = first(props, 'w:sz')?.attrs['w:val']; if (size && /^\d+$/.test(size)) style.fontSize = `${Number(size) * 2 / 3}pt`;
  const textColor = first(props, 'w:color')?.attrs['w:val']; if (textColor && /^[\da-f]{6}$/i.test(textColor)) style.color = `#${textColor}`;
  const shading = first(props, 'w:shd'), highlight = first(props, 'w:highlight')?.attrs['w:val'];
  const fill = shading?.attrs['w:fill']; if (highlight === 'yellow' || (fill && ['fff0a4', 'ffff00'].includes(fill.toLowerCase()))) marks.push({ type: 'highlight', attrs: { color: '#ffff00' } });
  else if (fill && /^[\da-f]{6}$/i.test(fill) && !['auto', 'ffffff'].includes(fill.toLowerCase())) marks.push({ type: 'highlight', attrs: { color: `#${fill}` } });
  if (Object.keys(style).length) marks.push({ type: 'textStyle', attrs: style });
  return marks;
}
function parseWordParagraph(node: XmlElement): RichNode {
  const props = first(node, 'w:pPr'), pStyle = first(props ?? node, 'w:pStyle')?.attrs['w:val'] ?? '';
  const level = /^Heading([1-3])$/i.exec(pStyle)?.[1];
  const attrs: Record<string, unknown> = {};
  const align = first(props ?? node, 'w:jc')?.attrs['w:val']; if (align && ['left', 'center', 'right', 'both', 'distribute'].includes(align)) attrs.textAlign = align === 'both' || align === 'distribute' ? 'justify' : align;
  if (level) attrs.level = Number(level);
  const ind = first(props ?? node, 'w:ind'); if (ind?.attrs['w:firstLine']) attrs.firstLineIndentPt = Number(ind.attrs['w:firstLine']) / 20; if (ind?.attrs['w:left']) attrs.leftIndentPt = Number(ind.attrs['w:left']) / 20; if (ind?.attrs['w:right']) attrs.rightIndentPt = Number(ind.attrs['w:right']) / 20;
  const spacing = first(props ?? node, 'w:spacing'); if (spacing?.attrs['w:before']) attrs.spaceBeforePt = Number(spacing.attrs['w:before']) / 20; if (spacing?.attrs['w:after']) attrs.spaceAfterPt = Number(spacing.attrs['w:after']) / 20; if (spacing?.attrs['w:line'] && spacing.attrs['w:lineRule'] === 'auto') attrs.lineHeight = Number(spacing.attrs['w:line']) / 240;
  if (pStyle) attrs.sourceStyle = pStyle;
  const content: RichNode[] = [];
  for (const child of node.children) {
    if (typeof child === 'string' || child.name !== 'w:r') continue;
    const marks = parseWordMarks(child);
    for (const item of child.children) {
      if (typeof item === 'string') continue;
      if (item.name === 'w:t' || item.name === 'w:delText') { const text = xmlText(item); if (text) content.push({ type: 'text', text, ...(marks?.length ? { marks } : {}) }); }
      else if (item.name === 'w:tab') content.push({ type: 'text', text: '\t', ...(marks?.length ? { marks } : {}) });
      else if (item.name === 'w:br' && item.attrs['w:type'] === 'page') attrs.pageBreakBefore = true;
      else if (item.name === 'w:br' || item.name === 'w:cr') content.push({ type: 'hardBreak' });
    }
  }
  if (!content.length && first(props ?? node, 'w:pBdr')) return { type: 'horizontalRule' };
  return { type: level ? 'heading' : 'paragraph', ...(Object.keys(attrs).length ? { attrs } : {}), content };
}
function parseWordTable(node: XmlElement): RichNode {
  const rows = elements(node, 'w:tr').map((row, rowIndex) => ({ type: 'tableRow', content: elements(row, 'w:tc').map(cell => {
    const span = Number(first(cell, 'w:tcPr') && first(first(cell, 'w:tcPr')!, 'w:gridSpan')?.attrs['w:val']) || 1;
    const paragraphs = elements(cell, 'w:p').map(parseWordParagraph);
    const attrs = span > 1 ? { colspan: Math.min(span, 32) } : {};
    const rowType = rowIndex === 0 && Boolean(first(first(row, 'w:trPr') ?? row, 'w:tblHeader')) ? 'tableHeader' : 'tableCell';
    return { type: rowType, attrs, content: paragraphs.length ? paragraphs : [{ type: 'paragraph', content: [] }] };
  }) }));
  return { type: 'table', content: rows };
}
function fieldsFromDraft(doc: RichNode): { id: string; hint: string }[] {
  const fields: { id: string; hint: string }[] = [];
  const visit = (node: RichNode) => { if (node.type === 'reportField' && typeof node.attrs?.id === 'string') fields.push({ id: node.attrs.id, hint: String(node.attrs.hint ?? '') }); node.content?.forEach(visit); };
  visit(doc); return fields;
}
function restoreTemplateFields(doc: RichNode, original: RichNode): RichNode {
  const fields = fieldsFromDraft(original); let index = 0;
  const visit = (node: RichNode): RichNode => {
    if (node.type === 'paragraph' || node.type === 'heading') {
      const content: RichNode[] = [];
      const insertTextGroup = (group: RichNode[]) => {
        const joined = group.map(item => item.text ?? '').join(''), parts = group.map(item => ({ from: 0, to: 0, node: item }));
        let offset = 0; for (const part of parts) { part.from = offset; offset += part.node.text?.length ?? 0; part.to = offset; }
        const appendRange = (start: number, end: number) => { for (const part of parts) { const left = Math.max(start, part.from), right = Math.min(end, part.to); if (right > left) content.push({ ...part.node, text: joined.slice(left, right) }); } };
        let cursor = 0, match: RegExpExecArray | null; const marker = /⟦([^⟧]{1,200})⟧/g;
        while ((match = marker.exec(joined))) {
          appendRange(cursor, match.index);
          if (fields.length) {
            const label = match[1], matchedAt = fields.findIndex((field, at) => at >= index && field.hint === label);
            if (matchedAt < 0 && index >= fields.length) { content.push({ type: 'text', text: match[0], ...(parts.find(part => match!.index >= part.from && match!.index < part.to)?.node.marks ? { marks: parts.find(part => match!.index >= part.from && match!.index < part.to)?.node.marks } : {}) }); cursor = marker.lastIndex; continue; }
            const field = fields[matchedAt >= 0 ? matchedAt : index]; index = Math.max(index, (matchedAt >= 0 ? matchedAt : index) + 1);
            const marks = parts.find(part => match!.index >= part.from && match!.index < part.to)?.node.marks;
            content.push({ type: 'reportField', attrs: { id: field.id, hint: label || field.hint, value: '' }, ...(marks ? { marks } : {}) });
          } else appendRange(match.index, marker.lastIndex);
          cursor = marker.lastIndex;
        }
        appendRange(cursor, joined.length);
      };
      let textGroup: RichNode[] = [];
      const flush = () => { if (textGroup.length) insertTextGroup(textGroup); textGroup = []; };
      for (const child of node.content ?? []) {
        if (child.type === 'text') textGroup.push(child);
        else { flush(); content.push(visit(child)); }
      }
      flush();
      return { ...node, content };
    }
    return { ...node, ...(node.content ? { content: node.content.map(visit) } : {}) };
  };
  return visit(doc);
}
function parseEditedWordDocument(xml: string, original: RichNode = { type: 'doc', content: [] }): { doc: RichNode; warnings: string[] } {
  const root = parseXml(xml), body = descendants(root, 'w:body')[0]; if (!body) throw new Error('В документе Word не найдена основная часть.');
  const content: RichNode[] = [];
  for (const child of body.children) if (typeof child !== 'string') {
    if (child.name === 'w:p') content.push(parseWordParagraph(child));
    else if (child.name === 'w:tbl') content.push(parseWordTable(child));
  }
  if (!content.length) throw new Error('В документе Word отсутствует текст шаблона.');
  const warnings: string[] = [];
  const unsupported = ['w:drawing', 'w:object', 'w:altChunk', 'w:sdt', 'w:ins', 'w:del', 'w:numPr', 'w:vMerge', 'w:hyperlink', 'w:footnoteReference', 'w:endnoteReference', 'w:sym', 'w:fldSimple'].reduce((sum, name) => sum + descendants(body, name).length, 0);
  if (unsupported) warnings.push(`Не удалось полностью сохранить ${unsupported} неподдерживаемых элементов Word (изображения, списки, объекты или исправления). Проверьте предпросмотр.`);
  const doc = restoreTemplateFields({ type: 'doc', attrs: structuredClone(original.attrs ?? {}), content }, original);
  return { doc, warnings };
}

/** Recover visible Word content when Studio's optional custom XML was removed or damaged. */
export async function recoverDocx(input: ArrayBuffer | Uint8Array | Blob): Promise<{ doc: RichNode; warnings: string[] }> {
  if (input instanceof Blob && input.size > MAX_FILE_BYTES) throw new Error('Файл Word превышает 32 МБ.');
  const bytes = input instanceof Blob ? new Uint8Array(await input.arrayBuffer()) : input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > MAX_FILE_BYTES) throw new Error('Файл Word превышает 32 МБ.');
  let oversized = false, total = 0, zip: ReturnType<typeof unzipSync>;
  try {
    zip = unzipSync(bytes, { filter: entry => {
      if (entry.name !== 'word/document.xml' && entry.name !== '[Content_Types].xml' && entry.name !== '_rels/.rels') return false;
      total += entry.originalSize;
      if (entry.originalSize > MAX_STATE_BYTES * 2 || total > MAX_FILE_BYTES) { oversized = true; return false; }
      return true;
    } });
  } catch { throw new Error('Не удалось прочитать файл Word. Возможно, файл повреждён.'); }
  if (oversized) throw new Error('Содержимое файла Word слишком большое.');
  if (!zip['[Content_Types].xml'] || !zip['_rels/.rels'] || !zip['word/document.xml']) throw new Error('В файле отсутствуют обязательные части DOCX.');
  const types = strFromU8(zip['[Content_Types].xml']);
  if (!types.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')) throw new Error('Файл не содержит документ Microsoft Word.');
  const parsed = parseEditedWordDocument(strFromU8(zip['word/document.xml']));
  const doc = validateDraft({ format: 'mri-report-studio', version: draftVersion, profile: 'custom', doc: parsed.doc, customModules: [] }).doc;
  return { doc, warnings: ['Служебные данные XRS отсутствуют или повреждены. Проверьте сведения о пациенте, поля и структуру перед открытием.', ...parsed.warnings] };
}

/** Generate a real, editable Word document entirely on this device. */
export async function exportDocx(doc: RichNode, options: DocxOptions = {}): Promise<Blob> {
  const draft = { format: 'mri-report-studio', version: draftVersion, profile: options.profile ?? 'brain', doc, customModules: options.customModules ?? [], cache: options.cache ?? {}, kind: options.kind ?? 'report', templateId: validatedTemplateId(options.templateId) };
  validateDraft(draft);
  validatedCache(draft.cache);
  const source = doc.attrs?.sourceFormat === 'alliance-template' || Boolean(options.templateId);
  const a = doc.attrs ?? {};
  const millimetres = (value: unknown, fallback: number, min = 0, max = 1000) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? Math.round(value / 25.4 * 1440) : fallback;
  const pageWidth = source ? millimetres(a.pageWidthMm, PAGE_WIDTH, 100) : PAGE_WIDTH;
  const pageHeight = source ? millimetres(a.pageHeightMm, PAGE_HEIGHT, 100) : PAGE_HEIGHT;
  const marginLeft = source ? millimetres(a.marginLeftMm, 1020, 0, 80) : PAGE_MARGIN;
  const marginRight = source ? millimetres(a.marginRightMm, 1020, 0, 80) : PAGE_MARGIN;
  const font = source && typeof a.fontFamily === 'string' ? a.fontFamily : 'Arial';
  const fontSize = source && typeof a.fontSizePt === 'number' && a.fontSizePt > 0 && a.fontSizePt <= 200 ? a.fontSizePt * 2 : 24;
  const context: Context = {
    numbering: [], depth: 0, source, width: pageWidth - marginLeft - marginRight,
    ...(source ? { inherited: { font, size: fontSize, color: '000000' }, lineHeight: Number(a.lineHeight) || 1.05, spaceAfterPt: Number(a.spaceAfterPt) || 5 } : {}),
  };
  const children = blocks(doc.content ?? [], context);
  if (!children.length) children.push(new Paragraph({}));
  const file = new Document({
    creator: 'МРТ Альянс', title: cleanText(options.title ?? 'Протокол МРТ-исследования'),
    description: 'Редактируемое описание МРТ',
    // docx's implementation consumes Uint8Array-compatible font buffers in both
    // browser and Node; its public declarations narrow these buffers to Buffer.
    ...(options.fonts?.length ? { fonts: options.fonts as any } : {}),
    styles: source ? { default: {
      document: { run: { font, size: fontSize, color: '000000', language: { value: 'ru-RU' } }, paragraph: { spacing: { line: Math.round((Number(a.lineHeight) || 1.05) * 240), lineRule: LineRuleType.AUTO, after: Math.round((Number(a.spaceAfterPt) || 5) * 20) } } },
      title: { run: { font: 'Calibri', size: 42, bold: false, color: '183A52', characterSpacing: 5, kern: 28 }, paragraph: { keepNext: true, border: { bottom: { style: BorderStyle.SINGLE, size: 8, space: 4, color: '4F81BD' } }, spacing: { before: 180, after: 100, line: 240, lineRule: LineRuleType.AUTO } } },
      heading1: { run: { font: 'Calibri', size: 22, bold: true, color: '183A52' }, paragraph: { keepNext: true, keepLines: true, spacing: { before: 180, after: 100 } } },
      heading2: { run: { font: 'Calibri', size: 20, bold: true, color: '183A52' }, paragraph: { keepNext: true, keepLines: true, spacing: { before: 180, after: 100 } } },
      heading3: { run: { font: 'Calibri', size: 20, bold: true, color: '183A52' }, paragraph: { keepNext: true, keepLines: true, spacing: { before: 180, after: 100 } } },
    }, paragraphStyles: [{ id: 'Subtitle', name: 'Subtitle', basedOn: 'Normal', next: 'Normal', run: { font: 'Calibri', size: 22, italics: true, color: '183A52', characterSpacing: 15 }, paragraph: { keepNext: true, spacing: { before: 180, after: 100 } } }] } : { default: {
      document: { run: { font: 'Arial', size: 21, color: '172333', language: { value: 'ru-RU' } }, paragraph: { spacing: { line: 348, lineRule: LineRuleType.AUTO, after: 85 } } },
      heading1: { run: { font: 'Arial', size: 32, bold: true, color: '172333' }, paragraph: { keepNext: true, spacing: { before: 0, after: 180 } } },
      heading2: { run: { font: 'Arial', size: 23, bold: true, color: '172333' }, paragraph: { keepNext: true } },
      heading3: { run: { font: 'Arial', size: 21, bold: true, color: '172333' }, paragraph: { keepNext: true } },
    } },
    numbering: { config: context.numbering },
    sections: [{
      properties: { page: { size: { width: pageWidth, height: pageHeight }, margin: {
        top: Math.max(source ? millimetres(a.marginTopMm, 907, 0, 80) : 800, millimetres(43, 0)),
        bottom: source ? millimetres(a.marginBottomMm, 907, 0, 80) : 900,
        left: marginLeft, right: marginRight,
        ...(source ? { header: 369, footer: 369 } : {}),
      } } },
      ...(source ? { footers: { default: new Footer({ children: [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0, line: 200, lineRule: LineRuleType.AUTO }, children: [new TextRun({ font, size: 16, color: '64748B', text: DISCLAIMER_TEXT })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0, line: 200, lineRule: LineRuleType.AUTO }, children: [new TextRun({ font, size: 16, color: '64748B', italics: true, text: EQUIPMENT_TEXT })] }),
        new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 0, after: 0, line: 200, lineRule: LineRuleType.AUTO }, children: [new TextRun({ font, size: fontSize, color: '000000', children: [PageNumber.CURRENT] })] }),
      ] }) } } : {}),
      children,
    }],
  });
  const zip = unzipSync(new Uint8Array(await Packer.toArrayBuffer(file)));
  zip['customXml/itemPropsMRI.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><ds:datastoreItem ds:itemID="{A4B86616-2D71-4B08-9A17-D625BFE59739}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="${STATE_NS}"/></ds:schemaRefs></ds:datastoreItem>`);
  zip['customXml/_rels/mri-report-studio.xml.rels'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdMriProperties" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemPropsMRI.xml"/></Relationships>');
  const contentTypes = strFromU8(zip['[Content_Types].xml']).replace('</Types>', '<Override PartName="/customXml/itemPropsMRI.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>');
  zip['[Content_Types].xml'] = strToU8(contentTypes);
  const relationships = strFromU8(zip['word/_rels/document.xml.rels']).replace('</Relationships>', '<Relationship Id="rIdMriDraft" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/mri-report-studio.xml"/></Relationships>');
  zip['word/_rels/document.xml.rels'] = strToU8(relationships);
  const hashes = await contentHashes(zip);
  const metadata = strToU8(JSON.stringify({ draft, documentHash: hashes['word/document.xml'], contentHashes: hashes, hashAlgorithm: 'SHA-256' }));
  if (metadata.length > MAX_STATE_BYTES) throw new Error('Документ слишком большой для сохранения редактируемых данных.');
  zip[STATE_PART] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><mri:report xmlns:mri="${STATE_NS}"><mri:state encoding="base64">${base64(metadata)}</mri:state></mri:report>`);
  const packed = zipSync(zip, { level: 6 });
  return new Blob([packed.slice().buffer as ArrayBuffer], { type: DOCX_MIME });
}

/** Restore Studio metadata; a DOCX from another application returns null. */
export async function importOwnDocx(input: ArrayBuffer | Uint8Array | Blob): Promise<ImportedDocx | null> {
  if (input instanceof Blob && input.size > MAX_FILE_BYTES) throw new Error('Файл Word превышает 32 МБ.');
  const bytes = input instanceof Blob ? new Uint8Array(await input.arrayBuffer()) : input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > MAX_FILE_BYTES) throw new Error('Файл Word превышает 32 МБ.');
  let oversized = false;
  let uncompressedBytes = 0;
  let zip: ReturnType<typeof unzipSync>;
  try {
    zip = unzipSync(bytes, { filter: entry => {
      if (entry.name !== STATE_PART && !isWordContent(entry.name)) return false;
      uncompressedBytes += entry.originalSize;
      if (entry.originalSize > MAX_STATE_BYTES * 2 || uncompressedBytes > MAX_FILE_BYTES) { oversized = true; return false; }
      return true;
    } });
  } catch { throw new Error('Не удалось прочитать файл Word. Возможно, файл повреждён.'); }
  if (oversized) throw new Error('Содержимое файла Word слишком большое.');
  if (!zip[STATE_PART]) return null;
  const xml = strFromU8(zip[STATE_PART]);
  const match = /<mri:state\s+encoding="base64">([A-Za-z\d+/=\s]+)<\/mri:state>/.exec(xml);
  if (!xml.includes(`xmlns:mri="${STATE_NS}"`) || !match || !zip['word/document.xml']) throw new Error('Повреждены редактируемые данные описания в файле Word.');
  let metadata: any;
  try {
    const raw = atob(match[1].replace(/\s/g, ''));
    if (raw.length > MAX_STATE_BYTES) throw new Error();
    metadata = JSON.parse(strFromU8(Uint8Array.from(raw, c => c.charCodeAt(0))));
  } catch { throw new Error('Повреждены редактируемые данные описания в файле Word.'); }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Повреждены редактируемые данные описания в файле Word.');
  if (metadata.hashAlgorithm !== 'SHA-256' || typeof metadata.documentHash !== 'string') throw new Error('Повреждены контрольные данные Word-файла.');
  const baseDraft = validateDraft(metadata.draft);
  const actualHashes = await contentHashes(zip);
  const documentChanged = metadata.documentHash !== await fingerprint(zip['word/document.xml']);
  const contentChanged = !metadata.contentHashes || Object.keys(metadata.contentHashes).length !== Object.keys(actualHashes).length || Object.entries(actualHashes).some(([name, hash]) => metadata.contentHashes[name] !== hash);
  const kind = metadata.draft.kind === 'template' ? 'template' : 'report';
  const templateId = validatedTemplateId(metadata.draft.templateId);
  let importedDoc = baseDraft.doc;
  let importWarnings: string[] = [];
  if (documentChanged) {
    const parsed = parseEditedWordDocument(strFromU8(zip['word/document.xml']), importedDoc);
    importedDoc = parsed.doc; importWarnings = parsed.warnings;
  }
  if (contentChanged && !documentChanged) importWarnings.push('В документе изменены стили или другие элементы Word. Они не входят в поддерживаемое редактируемое содержимое шаблона.');
  const result = validateDraft({ ...metadata.draft, doc: importedDoc });
  return { ...result, cache: validatedCache(metadata.draft.cache), kind, templateId, editedInWord: documentChanged || contentChanged, importWarnings };
}
