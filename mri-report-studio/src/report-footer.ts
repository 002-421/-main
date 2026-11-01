import type { RichNode } from './model';

const textOf = (node: RichNode): string => node.type === 'text' ? node.text ?? '' : node.content?.map(textOf).join('') ?? '';

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
    const disclaimer = content.findIndex((node, index) => index > physician && node.type === 'paragraph' && /Данное заключение не является диагнозом/i.test(textOf(node)));
    const equipment = content.findIndex((node, index) => index > disclaimer && node.type === 'paragraph' && /Исследование выполнено на магнитно-резонансном томографе/i.test(textOf(node)));
    const insertBefore = (index: number) => {
      if (index < 0 || content[index - 1]?.type === 'paragraph' && !textOf(content[index - 1])) return;
      const source = content[index];
      content.splice(index, 0, { type: 'paragraph', attrs: { ...(source.attrs ?? {}), spaceBeforePt: 0, spaceAfterPt: 0 }, content: [] });
    };
    insertBefore(equipment);
    insertBefore(disclaimer);
    insertBefore(physician);
  }
  next.content = content;
  return next;
}
