import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, HeadingLevel,
  LevelFormat, LineRuleType, Packer, Paragraph, ShadingType, Table, TableCell,
  TableLayoutType, TableRow, Tab, TextRun, UnderlineType, WidthType, PageNumber,
  type IParagraphOptions, type IRunOptions, type NumberingDefinition, type ParagraphChild,
} from 'docx';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { draftVersion, validateDraft, type Module, type RichNode } from './model.ts';

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
export type ImportedDocx = ReturnType<typeof validateDraft> & { kind: 'report' | 'template'; templateId?: string };

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
    children: inline(node.content, inherited),
    ...(style ? { style } : { heading }),
    alignment: ALIGNMENTS[attrs.textAlign],
    spacing: { line, lineRule: LineRuleType.AUTO, before: pt(attrs.spaceBeforePt, context.source && sourceStyle !== 'Normal' ? 180 : heading ? (level === 1 ? 0 : 180) : 0), after: pt(attrs.spaceAfterPt, heading ? 100 : Math.round((context.spaceAfterPt ?? 4.25) * 20)) },
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
  return nodes.flatMap((node): (Paragraph | Table)[] => {
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

/** Generate a real, editable Word document entirely on this device. */
export async function exportDocx(doc: RichNode, options: DocxOptions = {}): Promise<Blob> {
  const draft = { format: 'mri-report-studio', version: draftVersion, profile: options.profile ?? 'brain', doc, customModules: options.customModules ?? [], cache: options.cache ?? {}, kind: options.kind ?? 'report', templateId: validatedTemplateId(options.templateId) };
  validateDraft(draft);
  validatedCache(draft.cache);
  const source = doc.attrs?.sourceFormat === 'alliance-template';
  const a = doc.attrs ?? {};
  const millimetres = (value: unknown, fallback: number, min = 0, max = 1000) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? Math.round(value / 25.4 * 1440) : fallback;
  const pageWidth = source ? millimetres(a.pageWidthMm, PAGE_WIDTH, 100) : PAGE_WIDTH;
  const pageHeight = source ? millimetres(a.pageHeightMm, PAGE_HEIGHT, 100) : PAGE_HEIGHT;
  const marginLeft = source ? millimetres(a.marginLeftMm, 1020, 0, 80) : PAGE_MARGIN;
  const marginRight = source ? millimetres(a.marginRightMm, 1020, 0, 80) : PAGE_MARGIN;
  const font = source && typeof a.fontFamily === 'string' ? a.fontFamily : source ? 'DejaVu Sans' : 'Arial';
  const fontSize = source && typeof a.fontSizePt === 'number' && a.fontSizePt > 0 && a.fontSizePt <= 200 ? a.fontSizePt * 2 : source ? 20 : 21;
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
        top: source ? millimetres(a.marginTopMm, 907, 0, 80) : 800,
        bottom: source ? millimetres(a.marginBottomMm, 907, 0, 80) : 900,
        left: marginLeft, right: marginRight,
        ...(source ? { header: 369, footer: 369 } : {}),
      } } },
      ...(source ? { footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO }, children: [new TextRun({ font, size: 16, color: '64748B', text: typeof a.footerText === 'string' ? cleanText(a.footerText) : 'МРТ головы • v1.0   |   ' }), new TextRun({ font, size: fontSize, color: '000000', children: [PageNumber.CURRENT] })] })] }) } } : {}),
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
  if (metadata.hashAlgorithm !== 'SHA-256' || metadata.documentHash !== await fingerprint(zip['word/document.xml'])) {
    throw new Error('Этот файл был изменён в Word или другом редакторе. Чтобы не потерять изменения, откройте его в Word и скопируйте текст в новое описание.');
  }
  const actualHashes = await contentHashes(zip);
  if (!metadata.contentHashes || Object.keys(metadata.contentHashes).length !== Object.keys(actualHashes).length || Object.entries(actualHashes).some(([name, hash]) => metadata.contentHashes[name] !== hash)) {
    throw new Error('Форматирование или структура этого файла изменены в Word или другом редакторе. Откройте его в Word и скопируйте изменения в новое описание.');
  }
  const result = validateDraft(metadata.draft);
  return { ...result, cache: validatedCache(metadata.draft.cache), kind: metadata.draft.kind === 'template' ? 'template' : 'report', templateId: validatedTemplateId(metadata.draft.templateId) };
}
