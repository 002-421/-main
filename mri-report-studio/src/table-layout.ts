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
