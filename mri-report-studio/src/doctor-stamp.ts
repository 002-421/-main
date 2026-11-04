import type { RichNode } from './model';

const STAMP_ALT = 'Подпись и печать врача';
const text = (node: RichNode): string => node.type === 'text' ? node.text ?? ''
  : node.type === 'reportField' ? String(node.attrs?.value || node.attrs?.hint || '')
    : (node.content ?? []).map(text).join('');

export function attachDoctorStamp(
  input: RichNode,
  stamps: Record<string, string>,
  sizes: Record<string, { width: number; height: number }>,
): RichNode {
  const doc = structuredClone(input);
  const removePrevious = (nodes: RichNode[]) => {
    for (let index = nodes.length - 1; index >= 0; index--) {
      const node = nodes[index];
      if (node.type === 'image' && node.attrs?.alt === STAMP_ALT) nodes.splice(index, 1);
      else if (node.content) removePrevious(node.content);
    }
  };
  removePrevious(doc.content ??= []);

  let physician = '';
  const findPhysician = (node: RichNode) => {
    if (node.type === 'paragraph') {
      const line = text(node);
      if (/врач(?:-рентгенолог)?\s*:/i.test(line)) physician = line;
    }
    if (!physician) node.content?.forEach(findPhysician);
  };
  findPhysician(doc);
  const normalizedLine = physician.toLocaleLowerCase('ru');
  const doctor = Object.keys(stamps).sort((a, b) => b.length - a.length)
    .find(name => normalizedLine.includes(name.toLocaleLowerCase('ru')));
  const src = doctor ? stamps[doctor] : '';
  if (!src) return doc;
  const dimensions = sizes[doctor!] ?? { width: 140, height: 55 };
  const stamp: RichNode = { type: 'image', attrs: {
    src, alt: STAMP_ALT,
    width: Math.max(1, Math.min(140, Math.round(dimensions.width))),
    height: Math.max(1, Math.min(55, Math.round(dimensions.height))),
  } };

  const insert = (nodes: RichNode[]): boolean => {
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      if (node.type === 'paragraph' && /врач(?:-рентгенолог)?\s*:/i.test(text(node))) {
        const children = node.content ??= [];
        const combined = children.map(text).join('');
        const dateOffset = combined.search(/\bдата\s*:/i);
        if (dateOffset >= 0) {
          const left: RichNode[] = [], right: RichNode[] = [];
          let offset = 0;
          for (const child of children) {
            const value = text(child);
            if (offset + value.length <= dateOffset) left.push(child);
            else if (offset >= dateOffset) right.push(child);
            else if (child.type === 'text') {
              const cut = dateOffset - offset;
              if (cut > 0) left.push({ ...child, text: (child.text ?? '').slice(0, cut) });
              if (cut < (child.text ?? '').length) right.push({ ...child, text: (child.text ?? '').slice(cut) });
            } else (offset < dateOffset ? left : right).push(child);
            offset += value.length;
          }
          const dateLine = { ...structuredClone(node), content: right };
          node.content = left;
          nodes.splice(index + 1, 0, stamp, dateLine);
        } else nodes.splice(index + 1, 0, stamp);
        return true;
      }
      if (node.content && insert(node.content)) return true;
    }
    return false;
  };
  insert(doc.content);
  return doc;
}

export function containsDoctorStamp(doc: RichNode): boolean {
  let found = false;
  const walk = (node: RichNode) => {
    if (node.type === 'image' && node.attrs?.alt === STAMP_ALT) found = true;
    if (!found) node.content?.forEach(walk);
  };
  walk(doc);
  return found;
}
