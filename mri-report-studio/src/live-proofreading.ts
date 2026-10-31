import { Extension, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { ProofIssue } from './proofreading-core';

export type LiveProofIssue = { issue: ProofIssue; from: number; to: number };
export type ProofStatus = { enabled: boolean; checking: boolean; count: number; error?: string };
type Segment = { start: number; end: number; pos: number };
export type LiveProofSnapshot = { doc: ProseMirrorNode; text: string; segments: Segment[] };
type ProofState = ProofStatus & { issues: LiveProofIssue[]; decorations: DecorationSet; revision: number };
type ProofMeta = { enabled?: boolean; refresh?: boolean; checking?: boolean; issues?: LiveProofIssue[]; error?: string };
type Options = { getPersonalWords: () => string[]; onStatus?: (status: ProofStatus) => void };

const proofKey = new PluginKey<ProofState>('mriLiveProofreading');

/** Only actual report prose is checked. Empty prompts and atoms break context. */
export function createProofreadingSnapshot(doc: ProseMirrorNode): LiveProofSnapshot {
  const segments: Segment[] = [];
  let text = '';
  const separator = () => { if (text && !text.endsWith('\n')) text += '\n'; };
  doc.descendants((node, pos) => {
    if (node.isTextblock) separator();
    if (node.type.name === 'hardBreak') { text += '\n'; return; }
    if (node.isText) {
      const field = node.marks.find(mark => mark.type.name === 'templateField');
      if (field && field.attrs.filled === false) { separator(); return; }
      const value = node.text ?? '';
      segments.push({ start: text.length, end: text.length + value.length, pos });
      text += value;
    } else if (node.isLeaf && !node.isText) separator();
  });
  return { doc, text, segments };
}

/** Refuse edits across paragraphs, missing prompts, hard breaks or atoms. */
export function locateProofreadingIssue(snapshot: LiveProofSnapshot, issue: ProofIssue): LiveProofIssue | null {
  if (issue.start < 0 || issue.end <= issue.start || issue.end > snapshot.text.length) return null;
  const first = snapshot.segments.findIndex(s => issue.start >= s.start && issue.start < s.end);
  const last = snapshot.segments.findIndex(s => issue.end > s.start && issue.end <= s.end);
  if (first < 0 || last < first) return null;
  for (let i = first + 1; i <= last; i++) {
    const a = snapshot.segments[i - 1], b = snapshot.segments[i];
    if (a.end !== b.start || a.pos + a.end - a.start !== b.pos) return null;
  }
  const a = snapshot.segments[first], b = snapshot.segments[last];
  return { issue, from: a.pos + issue.start - a.start, to: b.pos + issue.end - b.start };
}

function decorations(doc: ProseMirrorNode, issues: LiveProofIssue[]) {
  return DecorationSet.create(doc, issues.map(item => Decoration.inline(item.from, item.to, {
    class: item.issue.kind === 'spelling' ? 'proof-spelling' : 'proof-grammar',
    'data-proof-id': item.issue.id,
    'data-proof-kind': item.issue.kind,
    title: item.issue.message,
  })));
}

export const LiveProofreading = Extension.create<Options>({
  name: 'liveProofreading',
  addOptions() { return { getPersonalWords: () => [], onStatus: undefined }; },
  addProseMirrorPlugins() {
    const options = this.options;
    return [new Plugin<ProofState>({
      key: proofKey,
      state: {
        init: () => ({ enabled: true, checking: false, count: 0, issues: [], decorations: DecorationSet.empty, revision: 0 }),
        apply(transaction, previous) {
          const meta = transaction.getMeta(proofKey) as ProofMeta | undefined;
          if (!meta && !transaction.docChanged) return previous;
          const next = { ...previous };
          if (meta?.enabled !== undefined) next.enabled = meta.enabled;
          if (transaction.docChanged || meta?.refresh || meta?.enabled !== undefined) {
            next.revision++;
            next.issues = [];
            next.count = 0;
            next.decorations = DecorationSet.empty;
            next.checking = false;
            delete next.error;
          }
          if (meta?.checking !== undefined) next.checking = meta.checking;
          if (meta?.error) next.error = meta.error;
          if (meta?.issues && next.enabled) {
            next.issues = meta.issues;
            next.count = next.issues.length;
            next.decorations = decorations(transaction.doc, next.issues);
            next.checking = false;
            delete next.error;
          }
          if (!next.enabled) { next.checking = false; next.issues = []; next.count = 0; next.decorations = DecorationSet.empty; }
          return next;
        },
      },
      props: { decorations: state => proofKey.getState(state)?.decorations ?? DecorationSet.empty },
      view(view) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let generation = 0;
        let destroyed = false;
        let previousStatus = '';
        const notify = () => {
          const state = proofKey.getState(view.state)!;
          const status: ProofStatus = { enabled: state.enabled, checking: state.checking, count: state.count, ...(state.error ? { error: state.error } : {}) };
          const serialized = JSON.stringify(status);
          if (serialized !== previousStatus) { previousStatus = serialized; options.onStatus?.(status); }
        };
        const schedule = (delay = 850) => {
          clearTimeout(timer);
          const task = ++generation;
          if (!proofKey.getState(view.state)?.enabled) { notify(); return; }
          timer = setTimeout(async () => {
            if (destroyed || task !== generation) return;
            const snapshot = createProofreadingSnapshot(view.state.doc);
            const words = [...options.getPersonalWords()];
            view.dispatch(view.state.tr.setMeta(proofKey, { checking: true } satisfies ProofMeta).setMeta('addToHistory', false));
            try {
              const { checkRussian } = await import('./proofreading');
              const raw = await checkRussian(snapshot.text, words);
              if (destroyed || task !== generation || !snapshot.doc.eq(view.state.doc) || !proofKey.getState(view.state)?.enabled) return;
              const found = raw.map(issue => locateProofreadingIssue(snapshot, issue)).filter((item): item is LiveProofIssue => item !== null);
              view.dispatch(view.state.tr.setMeta(proofKey, { issues: found } satisfies ProofMeta).setMeta('addToHistory', false));
            } catch (error) {
              if (destroyed || task !== generation || !snapshot.doc.eq(view.state.doc)) return;
              view.dispatch(view.state.tr.setMeta(proofKey, { checking: false, error: error instanceof Error ? error.message : 'Проверка текста недоступна' } satisfies ProofMeta).setMeta('addToHistory', false));
            }
          }, delay);
        };
        schedule(300);
        return {
          update(currentView, previousState) {
            const current = proofKey.getState(currentView.state)!;
            const previous = proofKey.getState(previousState);
            if (current.revision !== previous?.revision || current.enabled !== previous?.enabled || !currentView.state.doc.eq(previousState.doc)) schedule();
            notify();
          },
          destroy() { destroyed = true; generation++; clearTimeout(timer); },
        };
      },
    })];
  },
});

export function setLiveProofreading(editor: Editor, enabled: boolean) {
  editor.view.dispatch(editor.state.tr.setMeta(proofKey, { enabled } satisfies ProofMeta).setMeta('addToHistory', false));
}

export function refreshProofreading(editor: Editor) {
  editor.view.dispatch(editor.state.tr.setMeta(proofKey, { refresh: true } satisfies ProofMeta).setMeta('addToHistory', false));
}

export function getProofStatus(editor: Editor): ProofStatus {
  const state = proofKey.getState(editor.state);
  return state ? { enabled: state.enabled, checking: state.checking, count: state.count, ...(state.error ? { error: state.error } : {}) } : { enabled: false, checking: false, count: 0 };
}

export function getLiveProofIssueAtPosition(editor: Editor, pos: number): LiveProofIssue | null {
  return proofKey.getState(editor.state)?.issues.find(item => pos >= item.from && pos <= item.to) ?? null;
}
