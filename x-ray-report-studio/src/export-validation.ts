import type { RichNode } from './model';
export function hasYellowFields(doc: RichNode): boolean {
  const yellow = (value: unknown) => /^(?:#ffff00|#ff0|yellow|rgb\(255,\s*255,\s*0\))$/i.test(String(value ?? '').trim());
  return (doc.type === 'reportField' && !String(doc.attrs?.value ?? '').trim())
    || Boolean(doc.marks?.some(mark => mark.type === 'templateField' && mark.attrs?.filled !== true || mark.type === 'highlight' && yellow(mark.attrs?.color)))
    || Boolean(doc.content?.some(hasYellowFields));
}
