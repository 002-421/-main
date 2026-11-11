import boundaries from './ai-review-boundaries.json' with { type: 'json' };
import type { RichNode } from './model';

type Boundary = { count: number; headerEnd: number; conclusionStart: number; signatureStart: number; doctorIndex: number };
const plan = boundaries as Record<string, Boundary>;
const text = (node: RichNode): string => node.text ?? (node.content ?? []).map(text).join('');
const section = (id: string, title: string, content: RichNode[]): RichNode => ({ type: 'reportSection', attrs: { id, title, moduleId: '' }, content });

/** Apply audited positions only to a freshly generated, unmodified bundled MRI template. */
export function structurePreparedBuiltin(templateId: string, input: RichNode): RichNode {
  const b = plan[templateId];
  const nodes = input.content;
  if (!b || input.type !== 'doc' || !nodes || nodes.length !== b.count ||
      !(b.headerEnd >= 4 && b.headerEnd + 1 < b.conclusionStart && b.conclusionStart < b.signatureStart && b.signatureStart <= b.doctorIndex && b.doctorIndex < nodes.length) ||
      nodes[b.headerEnd].type !== 'horizontalRule' || nodes[b.conclusionStart - 1].type !== 'horizontalRule' ||
      !/^ЗАКЛЮЧЕНИЕ\s*:/iu.test(text(nodes[b.conclusionStart]).trim()) ||
      !/^Врач\s*:/iu.test(text(nodes[b.doctorIndex]).trim()) ||
      nodes[b.signatureStart].type !== 'paragraph') throw new Error('Шаблон требует ручной проверки границ AI Review');
  const next = structuredClone(input);
  const content = next.content!;
  next.content = [
    section('header', 'Данные исследования', content.slice(0, b.headerEnd + 1)),
    section('description', 'Описание', content.slice(b.headerEnd + 1, b.conclusionStart)),
    section('conclusion', 'Заключение', content.slice(b.conclusionStart, b.signatureStart)),
    section('signature', 'Рекомендации и подпись', content.slice(b.signatureStart)),
  ];
  return next;
}

/** A preview only. Existing and user-authored documents are never migrated on open. */
export function planUserDocumentMigration(input: RichNode): { status: 'manual-review'; backup: RichNode } {
  return { status: 'manual-review', backup: structuredClone(input) };
}
