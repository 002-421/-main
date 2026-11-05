import type { RichNode } from './model';

/** Keep the two report boundaries visible in both the editor and exports. */
export function addReportSeparators(input: RichNode): RichNode {
  const doc = structuredClone(input);
  const raw = (doc.content ?? []).filter(node => node.type !== 'horizontalRule');
  const content: RichNode[] = [];
  for (const node of raw) {
    if (node.type === 'paragraph' && !(node.content ?? []).some(child => child.type !== 'text' || child.text?.trim())) continue;
    const line = (node.content ?? []).map(child => child.text ?? '').join('');
    if (node.type === 'paragraph' && /Врач(?:-рентгенолог)?\s*:/i.test(line) && /дата\s*:/i.test(line)) {
      const left: RichNode[] = [], right: RichNode[] = []; let date = false;
      for (const child of node.content ?? []) {
        const offset = child.type === 'text' ? (child.text ?? '').search(/дата\s*:/i) : -1;
        if (offset >= 0) { if (offset) left.push({...child,text:child.text!.slice(0,offset).trimEnd()}); right.push({...child,text:child.text!.slice(offset).replace(/дата\s*:/i,'Дата:')}); date=true; }
        else (date ? right : left).push(child);
      }
      content.push({...node,content:left.filter(child=>child.type!=='text'||child.text)},{...node,attrs:{...node.attrs,textAlign:'left'},content:right});
    } else {
      if (/^дата\s*:/i.test(line.trim())) { node.attrs={...node.attrs,textAlign:'left'}; for(const child of node.content ?? []) if(child.text) child.text=child.text.replace(/дата\s*:/i,'Дата:'); }
      content.push(node);
    }
  }
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
