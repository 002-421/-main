import type { RichNode } from './model';

const textOf = (node: RichNode): string => node.type === 'text' ? node.text ?? '' : node.content?.map(textOf).join('') ?? '';
export const DISCLAIMER_TEXT = 'Данное заключение не является диагнозом и должно быть интерпретировано лечащим врачом на основании клинико-лабораторных данных и других диагностических исследований';
export const EQUIPMENT_TEXT = 'Исследование выполнено на магнитно-резонансном томографе Philips Achieva с высокой напряженностью магнитного поля 1,5 Тесла';

/** Add visual spacing to the closing block and initialize report dates, including CT templates. */
export function initializeReportFooter(doc: RichNode, date = new Date().toLocaleDateString('ru-RU')): RichNode {
  const next = structuredClone(doc);
  const content = next.content ?? [];
  const physician = content.findIndex(node => node.type === 'paragraph' && /Врач(?:-рентгенолог)?\s*:/i.test(textOf(node)));
  const fillDate = (node: RichNode) => {
    if (node.type === 'reportField' && String(node.attrs?.id ?? '').endsWith('.reportdate')) {
      node.attrs = { ...node.attrs, value: date };
    }
    if (node.type === 'text') {
      for (const mark of node.marks ?? []) {
        if (mark.type === 'templateField' && String(mark.attrs?.id ?? '').endsWith('.reportdate')) {
          node.text = date;
          mark.attrs = { ...mark.attrs, filled: true };
        }
      }
    }
    node.content?.forEach(fillDate);
  };
  fillDate(next);
  if (physician >= 0) {
    const source = content[physician];
    if (textOf(content[physician - 1] ?? { type: '' }).trim()) {
      content.splice(physician, 0, { type: 'paragraph', attrs: { ...(source.attrs ?? {}), spaceBeforePt: 0, spaceAfterPt: 0 }, content: [] });
    }
  }
  next.content = content.filter(node => !/Данное заключение не является диагнозом|Исследование выполнено на магнитно-резонансном томографе/i.test(textOf(node)));
  return next;
}
