import type { Node } from '@tiptap/pm/model';

type Segment = { start: number; end: number; pos: number; text: string; field?: Node };
export type ProofSnapshot = { doc: Node; text: string; segments: Segment[] };
export type ProofTarget = { from: number; to: number } | { pos: number; field: Node; start: number; end: number };

/** Map visible, filled text to editor positions; empty prompts are not report text. */
export function proofreadingSnapshot(doc: Node): ProofSnapshot {
  let text = '';
  const segments: Segment[] = [];
  const separator = () => { if (text && !text.endsWith('\n')) text += '\n'; };
  doc.descendants((node, pos) => {
    if (node.isTextblock) separator();
    if (node.type.name === 'hardBreak') { text += '\n'; return; }
    if (node.isText) {
      const value = node.text ?? '';
      segments.push({ start: text.length, end: text.length + value.length, pos, text: value });
      text += value;
    } else if (node.type.name === 'reportField') {
      // An atom is one editor position but may contain several lines of text.
      // Separate it from surrounding prose to avoid unsafe cross-field fixes.
      separator();
      const value = String(node.attrs.value ?? '');
      if (value.trim()) {
        segments.push({ start: text.length, end: text.length + value.length, pos, text: value, field: node });
        text += value;
      }
      separator();
    }
  });
  return { doc, text, segments };
}

/** Resolve one suggested change without replacing field atoms or paragraph boundaries. */
export function proofreadingTarget(snapshot: ProofSnapshot, issue: { start: number; end: number }): ProofTarget | null {
  const { start, end } = issue;
  if (start < 0 || end <= start || end > snapshot.text.length) return null;
  const first = snapshot.segments.find(s => start >= s.start && start < s.end);
  const last = snapshot.segments.find(s => end > s.start && end <= s.end);
  if (!first || !last) return null;
  if (first.field) return first === last ? { pos: first.pos, field: first.field, start: start - first.start, end: end - first.start } : null;
  if (last.field) return null;
  const between = snapshot.segments.filter(s => s.end > start && s.start < end);
  for (let i = 1; i < between.length; i++) {
    const previous = between[i - 1], current = between[i];
    if (current.field || previous.end !== current.start || previous.pos + previous.text.length !== current.pos) return null;
  }
  return { from: first.pos + start - first.start, to: last.pos + end - last.start };
}
