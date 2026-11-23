import type { RichNode } from './model.ts';

const PERSONAL_FIELD = /(?:^|\.)(?:patient|birthdate|number|doctor|reportdate)$/i;
const placeholder = (kind: 'person' | 'date' | 'number', marks: RichNode['marks'] = []) => {
  const value = kind === 'person' ? 'Ф.И.О.' : kind === 'date' ? 'дд.мм.гггг' : 'номер исследования';
  const next = structuredClone(marks ?? []);
  if (!next.some(mark => mark.type === 'bold')) next.push({ type: 'bold' });
  const hi = next.find(mark => mark.type === 'highlight');
  if (hi) hi.attrs = { ...hi.attrs, color: '#ffff00' };
  else next.push({ type: 'highlight', attrs: { color: '#ffff00' } });
  return { type: 'text', text: value, marks: next } as RichNode;
};

function textOf(node: RichNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'reportField') return String(node.attrs?.value || node.attrs?.hint || '');
  return node.content?.map(textOf).join('') ?? '';
}

function replaceIdentityLine(node: RichNode, kind: 'person' | 'date' | 'number') {
  const full = textOf(node);
  const match = kind === 'person'
    ? /^(\s*(?:Врач(?:-рентгенолог)?|Ф\.?\s*И\.?\s*О\.?\s*пациента|Пациент)\s*:\s*)/iu.exec(full)
    : kind === 'date'
      ? /^(\s*(?:Дата\s+рождения|Дата)\s*:\s*)/iu.exec(full)
      : /^(\s*(?:Протокол\s+(?:МРТ|КТ)?-?исследования|Номер\s+исследования)\s*№?\s*:?\s*)/iu.exec(full);
  if (!match) return false;
  const label = kind === 'person' && /Врач/i.test(match[1]) ? 'Врач: ' : match[1];
  const marks = node.content?.find(child => child.type === 'text')?.marks ?? [];
  const content: RichNode[] = [{ type: 'text', text: label, marks: structuredClone(marks) }];
  if (kind === 'person' && /Врач/i.test(label) && /(?:^|\s)дата\s*:/iu.test(full)) {
    content.push(placeholder('person', marks), { type: 'text', text: ' дата: ', marks: structuredClone(marks) }, placeholder('date', marks));
  } else content.push(placeholder(kind, marks));
  node.content = content;
  return true;
}

/** Remove personal identity values only from template-package exports. */
export function sanitizeTemplateForExport(input: RichNode): RichNode {
  const doc = structuredClone(input);
  const visit = (node: RichNode) => {
    if (node.type === 'reportField') {
      const id = String(node.attrs?.id ?? '');
      if (PERSONAL_FIELD.test(id)) {
        node.attrs = { ...node.attrs, value: '', hint: /birthdate|reportdate/i.test(id) ? 'дд.мм.гггг' : /number/i.test(id) ? 'номер исследования' : 'Ф.И.О.' };
      }
    }
    if (node.type === 'text') {
      const mark = node.marks?.find(item => item.type === 'templateField' && PERSONAL_FIELD.test(String(item.attrs?.id ?? '')));
      if (mark) {
        const id = String(mark.attrs?.id ?? '');
        node.text = /birthdate|reportdate/i.test(id) ? 'дд.мм.гггг' : /number/i.test(id) ? 'номер исследования' : 'Ф.И.О.';
        mark.attrs = { ...mark.attrs, hint:node.text, original:node.text, filled: false };
        node.marks = [...(node.marks ?? []).filter(item => item.type !== 'highlight'), { type: 'highlight', attrs: { color: '#ffff00' } }];
      }
    }
    if (node.type === 'paragraph') {
      const hasFields=(n:RichNode):boolean=>n.type==='reportField'||Boolean(n.marks?.some(m=>m.type==='templateField'))||Boolean(n.content?.some(hasFields));
      if (!hasFields(node) && (replaceIdentityLine(node, 'person') || replaceIdentityLine(node, 'date') || replaceIdentityLine(node, 'number'))) return;
    }
    node.content?.forEach(visit);
  };
  visit(doc);
  return doc;
}
