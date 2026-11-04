import type { RichNode } from './model';

const STAMP_ALT = 'Подпись и печать врача';
const STAMP_WIDTH = 360;
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
  const dimensions = sizes[doctor!] ?? { width: 360, height: 130 };
  const height = Math.max(1, Math.round(STAMP_WIDTH * dimensions.height / Math.max(1, dimensions.width)));
  const stamp: RichNode = { type: 'image', attrs: {
    src, alt: STAMP_ALT,
    width: STAMP_WIDTH, height, floating: true,
  } };

  const insert = (nodes: RichNode[]): boolean => {
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      if (node.type === 'paragraph' && /врач(?:-рентгенолог)?\s*:/i.test(text(node))) {
        const children = node.content ??= [];
        const combined = children.map(text).join('');
        const dateOffset = combined.search(/\bдата\s*:/i);
        if (dateOffset >= 0) {
          let offset = 0, at = children.length;
          for (let childIndex = 0; childIndex < children.length; childIndex++) {
            const child = children[childIndex], value = text(child);
            if (offset <= dateOffset && dateOffset <= offset + value.length) {
              at = childIndex;
              if (child.type === 'text') {
                const cut = dateOffset - offset;
                const left = (child.text ?? '').slice(0, cut), right = (child.text ?? '').slice(cut);
                const replacement = [...(left ? [{ ...child, text: left }] : []), stamp, ...(right ? [{ ...child, text: right }] : [])];
                children.splice(childIndex, 1, ...replacement);
                return true;
              }
              break;
            }
            offset += value.length;
          }
          children.splice(at, 0, stamp);
        } else children.push(stamp);
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
