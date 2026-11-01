import type { RichNode } from './model';

const textOf = (node: RichNode): string => node.type === 'text' ? node.text ?? '' : node.content?.map(textOf).join('') ?? '';
export const DISCLAIMER_TEXT = 'Данное заключение не является диагнозом и должно быть интерпретировано лечащим врачом на основании клинико-лабораторных данных и других диагностических исследований';
export const EQUIPMENT_TEXT = 'Исследование выполнено на магнитно-резонансном томографе Philips Achieva с высокой напряженностью магнитного поля 1,5 Тесла';

/** Add visual blank lines to the standard closing block and initialize its date. */
export function initializeReportFooter(doc: RichNode, date = new Date().toLocaleDateString('ru-RU')): RichNode {
  const next = structuredClone(doc);
  const content = next.content ?? [];
  const physician = content.findIndex(node => node.type === 'paragraph' && /Врач\s*:/i.test(textOf(node)) && node.content?.some(child => child.marks?.some(mark => mark.type === 'templateField' && String(mark.attrs?.id ?? '').endsWith('.reportdate'))));
  if (physician >= 0) {
    for (const child of content[physician].content ?? []) {
      const mark = child.marks?.find(item => item.type === 'templateField');
      if (mark && String(mark.attrs?.id ?? '').endsWith('.reportdate') && child.type === 'text') {
        child.text = date;
        mark.attrs = { ...mark.attrs, filled: true };
      }
    }
    const source = content[physician];
    content.splice(physician, 0, { type: 'paragraph', attrs: { ...(source.attrs ?? {}), spaceBeforePt: 0, spaceAfterPt: 0 }, content: [] });
    next.content = content.filter(node => !/Данное заключение не является диагнозом|Исследование выполнено на магнитно-резонансном томографе/i.test(textOf(node)));
  }
  if (!next.content) next.content = content;
  return next;
}
