import type { RichNode } from './model';

/** Keep the two report boundaries visible in both the editor and exports. */
export function addReportSeparators(input: RichNode): RichNode {
  const doc = structuredClone(input);
  const content = doc.content ?? [];
  const text = (node: RichNode): string => node.text ?? (node.content ?? []).map(text).join('');
  let headerEnd = -1;
  for (let i = 0; i < content.length; i++) {
    if (/^(?:Протокол|Ф\.?И\.?О\.?\s*пациент|Дата рождения|Область и вид исследования|Вид исследования|Контрастный препарат|Доза\s*:|День цикла)/i.test(text(content[i]).trim())) headerEnd = i;
    if (/^\s*ЗАКЛЮЧЕНИЕ\s*:/i.test(text(content[i]))) break;
  }
  const boundaries = new Set<number>();
  if (headerEnd >= 0 && headerEnd + 1 < content.length) boundaries.add(headerEnd + 1);
  content.forEach((node, index) => {
    if (/^\s*ЗАКЛЮЧЕНИЕ\s*:/i.test(text(node))) boundaries.add(index);
  });
  doc.content = content.flatMap((node, index) => boundaries.has(index) && node.type !== 'horizontalRule' && content[index - 1]?.type !== 'horizontalRule'
    ? [{ type: 'horizontalRule' } as RichNode, node] : [node]);
  return doc;
}
