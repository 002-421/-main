import type { RichNode } from './model';

const TABLE_WIDTH_LIMIT = 640;
const isBlank = (node: RichNode) => node.type === 'hardBreak' || node.type === 'text' && !(node.text ?? '').trim();

/** Compact source-template tables for the report page while preserving their column proportions. */
export function compactTemplateTables(input: RichNode): RichNode {
  const doc = structuredClone(input);
  const visit = (node: RichNode) => {
    if (node.type === 'table') {
      const firstRow = node.content?.find(child => child.type === 'tableRow');
      const widths = (firstRow?.content ?? []).flatMap(cell => Array.isArray(cell.attrs?.colwidth) ? cell.attrs.colwidth.map(Number) : []);
      const total = widths.reduce((sum, width) => sum + (Number.isFinite(width) && width > 0 ? width : 0), 0);
      const scale = total > TABLE_WIDTH_LIMIT ? TABLE_WIDTH_LIMIT / total : 1;
      const scaleWidths = (cell: RichNode) => {
        if (Array.isArray(cell.attrs?.colwidth) && scale < 1) {
          cell.attrs = { ...cell.attrs, colwidth: cell.attrs.colwidth.map(value => Math.max(1, Math.round(Number(value) * scale))) };
        }
        cell.content?.forEach(scaleWidths);
      };
      node.content?.forEach(scaleWidths);
      const compactBreaks = (cell: RichNode) => {
        if (cell.type === 'paragraph') {
          cell.attrs = { ...cell.attrs, fontSizePt: Math.min(Number(cell.attrs?.fontSizePt) || 9, 9), spaceAfterPt: Math.min(Number(cell.attrs?.spaceAfterPt) || 1, 1) };
        }
        if (cell.type === 'text' && cell.marks) cell.marks = cell.marks.map(mark => {
          if (mark.type !== 'textStyle') return mark;
          const size = Number.parseFloat(String(mark.attrs?.fontSize ?? '12'));
          return { ...mark, attrs: { ...mark.attrs, fontSize: `${Math.min(Number.isFinite(size) ? size : 12, 12)}px` } };
        });
        if (cell.type === 'paragraph' && cell.content) {
          while (cell.content.length && isBlank(cell.content[0])) cell.content.shift();
          while (cell.content.length && isBlank(cell.content[cell.content.length - 1])) cell.content.pop();
          const compact: RichNode[] = [];
          for (let index = 0; index < cell.content.length;) {
            if (!isBlank(cell.content[index])) { compact.push(cell.content[index++]); continue; }
            let end = index;
            let hasBreak = false;
            while (end < cell.content.length && isBlank(cell.content[end])) { hasBreak ||= cell.content[end].type === 'hardBreak'; end++; }
            if (hasBreak) compact.push({ type: 'hardBreak', content: [] });
            else compact.push(cell.content[index]);
            index = end;
          }
          cell.content = compact;
        }
        cell.content?.forEach(compactBreaks);
      };
      node.content?.forEach(compactBreaks);
    } else node.content?.forEach(visit);
  };
  visit(doc);
  const setTypography = (node: RichNode, inTable = false) => {
    const tableContent = inTable || node.type === 'table';
    if (node.type === 'paragraph' || node.type === 'heading') node.attrs = {
      ...node.attrs, fontFamily: 'Arial', fontSizePt: tableContent ? 9 : 12,
    };
    if (node.type === 'text' && node.marks) node.marks = node.marks.map(mark => mark.type === 'textStyle'
      ? { ...mark, attrs: { ...mark.attrs, fontFamily: 'Arial', fontSize: tableContent ? '12px' : '16px' } }
      : mark);
    node.content?.forEach(child => setTypography(child, tableContent));
  };
  doc.attrs = { ...doc.attrs, fontFamily: 'Arial', fontSizePt: 12 };
  setTypography(doc);
  return doc;
}

const textOf = (node: RichNode): string => node.type === 'text' ? node.text ?? '' : node.content?.map(textOf).join('') ?? '';

export function separateRecommendations(input: RichNode): RichNode {
  const doc = structuredClone(input);
  const walk = (node: RichNode) => {
    if (!node.content) return;
    const separated: RichNode[] = [];
    for (const child of node.content) {
      const text = textOf(child).trim();
      const isSectionStart = child.type === 'paragraph' && (/^\s*(?:Рекоменд|Рекоменду)/i.test(text) || /^заключение\s*:?$/i.test(text) || /^заключение\s*:/i.test(text));
      if (isSectionStart) {
        const previous = separated.at(-1);
        if (previous?.type !== 'paragraph' || textOf(previous).trim()) {
          separated.push({ type: 'paragraph', attrs: { ...(child.attrs ?? {}), fontFamily: 'Arial', fontSizePt: 12, spaceBeforePt: 0, spaceAfterPt: 0 }, content: [] });
        }
      }
      walk(child);
      separated.push(child);
    }
    node.content = separated;
  };
  walk(doc);
  return doc;
}

const DELETION_HIGHLIGHT = { type: 'highlight', attrs: { color: '#ffff00' } };
const ITALIC_MARK = { type: 'italic' };

/** Make text explicitly marked for later removal stand out in editing and Word. */
export function highlightDeletionNotes(input: RichNode): RichNode {
  const doc = structuredClone(input);
  const textOfNode = (node: RichNode): string => node.type === 'text' ? node.text ?? '' : node.content?.map(textOfNode).join('') ?? '';
  const styleText = (node: RichNode) => {
    const marks = [...(node.marks ?? [])];
    if (!marks.some(mark => mark.type === 'italic')) marks.push(ITALIC_MARK);
    if (!marks.some(mark => mark.type === 'highlight')) marks.push(DELETION_HIGHLIGHT);
    const textStyle = marks.find(mark => mark.type === 'textStyle');
    if (textStyle) textStyle.attrs = { ...textStyle.attrs, fontFamily: 'Arial', fontSize: '13.333px' };
    else marks.push({ type: 'textStyle', attrs: { fontFamily: 'Arial', fontSize: '13.333px' } });
    node.marks = marks;
  };
  const styleParagraph = (paragraph: RichNode) => {
    paragraph.attrs = { ...paragraph.attrs, fontFamily: 'Arial', fontSizePt: 10 };
    const style = (node: RichNode) => {
      if (node.type === 'text') styleText(node);
      node.content?.forEach(style);
    };
    style(paragraph);
  };
  const styleAgeBasedNorms = (paragraph: RichNode) => {
    if (paragraph.type !== 'paragraph' || !paragraph.content) return;
    const number = String.raw`\d+(?:[,.]\d+)?`;
    const range = `${number}(?:\\s*[-–—]\\s*${number})?`;
    const ageClause = `(?:после|до)\\s*\\d+\\s*лет\\s*[-–—:]?\\s*${range}`;
    const pairedNorm = new RegExp(`норма\\s*${range}\\s*,\\s*${ageClause}(?:\\s*,\\s*${ageClause})*`, 'gi');
    const fullText = paragraph.content.map(child => child.type === 'text' ? child.text ?? '' : child.type === 'hardBreak' ? '\n' : '').join('');
    const ranges = [...fullText.matchAll(pairedNorm)].map(match => ({ start: match.index!, end: match.index! + match[0].length }));
    if (!ranges.length) return;
    const split: RichNode[] = [];
    let offset = 0;
    for (const child of paragraph.content) {
      if (child.type !== 'text') { split.push(child); if (child.type === 'hardBreak') offset++; continue; }
      const text = child.text ?? '';
      const end = offset + text.length;
      const cuts = new Set([0, text.length]);
      for (const selected of ranges) {
        if (selected.start > offset && selected.start < end) cuts.add(selected.start - offset);
        if (selected.end > offset && selected.end < end) cuts.add(selected.end - offset);
      }
      const points = [...cuts].sort((a, b) => a - b);
      for (let index = 0; index < points.length - 1; index++) {
        const start = points[index], finish = points[index + 1];
        if (finish <= start) continue;
        const part = { ...child, text: text.slice(start, finish), ...(child.marks ? { marks: structuredClone(child.marks) } : {}) };
        const absoluteStart = offset + start, absoluteEnd = offset + finish;
        if (ranges.some(selected => absoluteStart >= selected.start && absoluteEnd <= selected.end)) styleText(part);
        split.push(part);
      }
      offset = end;
    }
    paragraph.content = split;
  };
  const walk = (node: RichNode) => {
    if (!node.content) return;
    let inWolfeReference = false;
    for (const child of node.content) {
      if (child.type === 'paragraph') {
        const text = textOfNode(child).trim();
        const startsWolfeReference = /^По структуре, выделяют 4 типа молочных жел[её]з \(по Wolfe\)/i.test(text);
        const isWolfeType = /^Тип\s*[1-4]\s*:/i.test(text);
        if (startsWolfeReference) inWolfeReference = true;
        const explicitlyMarked = /(?:нужно\s+)?удалять\s*!?/i.test(text);
        if (explicitlyMarked || startsWolfeReference || inWolfeReference && isWolfeType) styleParagraph(child);
        if (inWolfeReference && /^Тип\s*4\s*:/i.test(text)) inWolfeReference = false;
        else if (inWolfeReference && !startsWolfeReference && !isWolfeType) inWolfeReference = false;
      }
      walk(child);
    }
  };
  walk(doc);
  const markAgeNorms = (node: RichNode) => {
    if (node.type === 'paragraph') styleAgeBasedNorms(node);
    node.content?.forEach(markAgeNorms);
  };
  markAgeNorms(doc);
  const topLevel = doc.content ?? [];
  const physician = topLevel.findIndex(node => node.type === 'paragraph'
    && /Врач\s*:/i.test(textOfNode(node))
    && node.content?.some(child => child.marks?.some(mark => mark.type === 'templateField' && String(mark.attrs?.id ?? '').endsWith('.reportdate'))));
  const stylePostSignature = (node: RichNode) => {
    const text = textOfNode(node).trim();
    if (/^(?:Данное заключение не является диагнозом|Исследование выполнено на магнитно-резонансном томографе)/i.test(text)) return;
    if (node.type === 'paragraph' && text) styleParagraph(node);
    else node.content?.forEach(stylePostSignature);
  };
  if (physician >= 0) topLevel.slice(physician + 1).forEach(stylePostSignature);
  return doc;
}
