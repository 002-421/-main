import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state';
import { Step } from '@tiptap/pm/transform';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

export const REPORT_HISTORY_DEPTHS = [100, 250, 500, 1000] as const;
export type ReportHistoryDepth = typeof REPORT_HISTORY_DEPTHS[number];
export type StepJSON = Record<string, unknown>;
export type StoredSelection = Record<string, unknown>;
export type ReportHistoryEntry = {
  forward: StepJSON[];
  inverse: StepJSON[];
  before: StoredSelection;
  after: StoredSelection;
  time: number;
  groupedInput: boolean;
};
export type StoredReportHistory = { version: 1; undo: ReportHistoryEntry[]; redo: ReportHistoryEntry[] };

const HISTORY_LIMIT_BYTES = 512 * 1024;
const MAX_STEPS_PER_ENTRY = 4096;
const MAX_GROUP_STEPS = 256;
export const reportHistoryKey = new PluginKey<StoredReportHistory>('reportHistory');
let configuredDepth: ReportHistoryDepth = 500;
type HistoryMeta = { type: 'reset'; history?: unknown } | { type: 'undo' | 'redo' } | { type: 'depth'; depth: number };

const emptyHistory = (): StoredReportHistory => ({ version: 1, undo: [], redo: [] });
const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function validSelection(value: unknown): value is StoredSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const selection = value as Record<string, unknown>;
  return typeof selection.type === 'string' && (selection.type !== 'text' || (Number.isInteger(selection.anchor) && Number.isInteger(selection.head)));
}

function validSteps(value: unknown): value is StepJSON[] {
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_STEPS_PER_ENTRY && value.every(step => !!step && typeof step === 'object' && !Array.isArray(step) && typeof (step as Record<string, unknown>).stepType === 'string');
}

function validEntry(value: unknown): value is ReportHistoryEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return validSteps(entry.forward) && validSteps(entry.inverse) && validSelection(entry.before) && validSelection(entry.after) && Number.isFinite(entry.time) && typeof entry.groupedInput === 'boolean';
}

function selectionBeforeTransaction(tr: Transaction, oldState: EditorState, newState: EditorState): Selection {
  const previous = oldState.selection;
  try {
    if (previous.map(newState.doc, tr.mapping).eq(newState.selection)) return previous;
    // A fast DOM selection change can reach the browser before ProseMirror has
    // synchronized its state selection. Recover the input's true start from
    // the transaction's changed range instead of persisting a stale caret.
    // Mapping a collapsed caret at the end of inserted replacement text back
    // through the inverse map loses the selected range at its boundary.
    if (previous instanceof TextSelection && newState.selection instanceof TextSelection) {
      const head = newState.selection.head;
      const candidates: Array<{from:number;to:number;exactEnd:boolean;step:number}> = [];
      for (let index = 0; index < tr.mapping.maps.length; index++) {
        const beforeStep = tr.mapping.slice(0, index).invert();
        const afterStep = tr.mapping.slice(index + 1);
        tr.mapping.maps[index].forEach((oldStart, oldEnd, newStart, newEnd) => {
          const finalStart = afterStep.map(newStart, -1);
          const finalEnd = afterStep.map(newEnd, 1);
          if (head < Math.min(finalStart, finalEnd) || head > Math.max(finalStart, finalEnd)) return;
          const from = beforeStep.map(oldStart, -1);
          const to = beforeStep.map(oldEnd, 1);
          candidates.push({from:Math.min(from,to),to:Math.max(from,to),exactEnd:head===finalEnd,step:index});
        });
      }
      candidates.sort((left,right)=>Number(right.exactEnd)-Number(left.exactEnd)||right.step-left.step);
      const candidate = candidates[0];
      if (candidate) return TextSelection.between(oldState.doc.resolve(candidate.from), oldState.doc.resolve(candidate.to));
    }
  } catch {
    // Keep the prior selection if the transaction cannot map it safely.
  }
  return previous;
}

/** Corrupt or oversized history is discarded independently of the report document. */
export function sanitizeReportHistory(value: unknown, depth: number = configuredDepth): StoredReportHistory {
  const allowedDepth = REPORT_HISTORY_DEPTHS.includes(depth as ReportHistoryDepth) ? depth : 500;
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyHistory();
    const candidate = value as Record<string, unknown>;
    if (candidate.version !== 1 || !Array.isArray(candidate.undo) || !Array.isArray(candidate.redo)) return emptyHistory();
    if (JSON.stringify(candidate).length > HISTORY_LIMIT_BYTES) return emptyHistory();
    if (![...candidate.undo, ...candidate.redo].every(validEntry)) return emptyHistory();
    return {
      version: 1,
      undo: (candidate.undo as ReportHistoryEntry[]).slice(-allowedDepth).map(jsonClone),
      redo: (candidate.redo as ReportHistoryEntry[]).slice(-allowedDepth).map(jsonClone),
    };
  } catch {
    return emptyHistory();
  }
}

function entryForTransaction(tr: Transaction, oldState: EditorState, newState: EditorState): ReportHistoryEntry | null {
  if (!tr.docChanged || tr.steps.length === 0) return null;
  let doc = oldState.doc;
  const inverse: StepJSON[] = [];
  try {
    for (const step of tr.steps) {
      inverse.unshift(step.invert(doc).toJSON() as StepJSON);
      const result = step.apply(doc);
      if (result.failed || !result.doc) return null;
      doc = result.doc;
    }
    return {
      forward: tr.steps.map(step => step.toJSON() as StepJSON),
      inverse,
      before: selectionBeforeTransaction(tr, oldState, newState).toJSON() as StoredSelection,
      after: newState.selection.toJSON() as StoredSelection,
      time: Date.now(),
      groupedInput: tr.getMeta('uiEvent') === 'input',
    };
  } catch {
    return null;
  }
}

function sameSelection(left: StoredSelection, right: StoredSelection): boolean {
  return left.type === right.type && left.anchor === right.anchor && left.head === right.head;
}

function trimToLimit(history: StoredReportHistory): StoredReportHistory {
  const result = { version: 1 as const, undo: history.undo.slice(-configuredDepth), redo: history.redo.slice(-configuredDepth) };
  while (JSON.stringify(result).length > HISTORY_LIMIT_BYTES && (result.undo.length || result.redo.length)) {
    if (result.undo.length) result.undo.shift();
    else result.redo.shift();
  }
  return result;
}

function applyHistoryTransaction(tr: Transaction, value: StoredReportHistory, oldState: EditorState, newState: EditorState): StoredReportHistory {
  const meta = tr.getMeta(reportHistoryKey) as HistoryMeta | undefined;
  const origin = tr.getMeta('appendedTransaction') as Transaction | undefined;
  const originMeta = origin?.getMeta(reportHistoryKey) as HistoryMeta | undefined;
  // Inline-field and proofreading plugins may append normalization transactions.
  // Those are part of the original Undo/Redo/reset action and must not erase its
  // opposite stack or become a second, unrelated undo event.
  if (originMeta?.type === 'undo' || originMeta?.type === 'redo' || originMeta?.type === 'reset') return value;
  // A plugin-generated normalization transaction is a continuation of the
  // originating user edit. Merge its steps into the latest operation so one
  // Undo reverses the complete visible change, including field/highlight fixes.
  if (origin) {
    if (origin.getMeta('addToHistory') === false) return value;
    const appended = entryForTransaction(tr, oldState, newState);
    if (!appended) return value;
    const undo = value.undo.slice(), previous = undo.at(-1);
    if (!previous) return value;
    undo[undo.length - 1] = {
      ...previous,
      forward: [...previous.forward, ...appended.forward].slice(-MAX_STEPS_PER_ENTRY),
      inverse: [...appended.inverse, ...previous.inverse].slice(-MAX_STEPS_PER_ENTRY),
      after: appended.after,
    };
    return trimToLimit({ version: 1, undo, redo: value.redo });
  }
  if (meta?.type === 'reset') return sanitizeReportHistory(meta.history);
  if (meta?.type === 'depth') {
    configuredDepth = REPORT_HISTORY_DEPTHS.includes(meta.depth as ReportHistoryDepth) ? meta.depth as ReportHistoryDepth : 500;
    return trimToLimit(value);
  }
  if (meta?.type === 'undo') {
    const undo = value.undo.slice(), redo = value.redo.slice(), entry = undo.pop();
    if (entry) redo.push(entry);
    return trimToLimit({ version: 1, undo, redo });
  }
  if (meta?.type === 'redo') {
    const undo = value.undo.slice(), redo = value.redo.slice(), entry = redo.pop();
    if (entry) undo.push(entry);
    return trimToLimit({ version: 1, undo, redo });
  }
  if (!tr.docChanged || tr.getMeta('addToHistory') === false) return value;
  const entry = entryForTransaction(tr, oldState, newState);
  if (!entry) return value;
  const undo = value.undo.slice(), previous = undo.at(-1);
  if (entry.groupedInput && previous?.groupedInput && entry.time - previous.time < 750 &&
      previous.forward.length + entry.forward.length <= MAX_GROUP_STEPS &&
      previous.inverse.length + entry.inverse.length <= MAX_GROUP_STEPS && sameSelection(previous.after, entry.before)) {
    undo[undo.length - 1] = {
      ...previous,
      forward: [...previous.forward, ...entry.forward].slice(-MAX_STEPS_PER_ENTRY),
      inverse: [...entry.inverse, ...previous.inverse].slice(-MAX_STEPS_PER_ENTRY),
      after: entry.after,
      time: entry.time,
    };
  } else undo.push(entry);
  return trimToLimit({ version: 1, undo, redo: [] });
}

export function reportHistoryPlugin(): Plugin<StoredReportHistory> {
  return new Plugin({
    key: reportHistoryKey,
    state: {
      init: () => emptyHistory(),
      apply: (tr, value, oldState, newState) => applyHistoryTransaction(tr, value, oldState, newState),
    },
  });
}

export const ReportHistory = Extension.create({
  name: 'reportHistory',
  addProseMirrorPlugins() { return [reportHistoryPlugin()]; },
});

export function configureReportHistoryDepth(view: EditorView, depth: number): ReportHistoryDepth {
  const normalized = REPORT_HISTORY_DEPTHS.includes(depth as ReportHistoryDepth) ? depth as ReportHistoryDepth : 500;
  configuredDepth = normalized;
  view.dispatch(view.state.tr.setMeta(reportHistoryKey, { type: 'depth', depth: normalized } satisfies HistoryMeta));
  return normalized;
}

export function setDefaultReportHistoryDepth(depth: number): ReportHistoryDepth {
  configuredDepth = REPORT_HISTORY_DEPTHS.includes(depth as ReportHistoryDepth) ? depth as ReportHistoryDepth : 500;
  return configuredDepth;
}

export function getReportHistory(state: EditorState): StoredReportHistory {
  return sanitizeReportHistory(reportHistoryKey.getState(state));
}

export function restoreReportHistory(view: EditorView, history: unknown): void {
  view.dispatch(view.state.tr.setMeta(reportHistoryKey, { type: 'reset', history } satisfies HistoryMeta));
}

export function canUndoReport(state: EditorState): boolean { return Boolean(reportHistoryKey.getState(state)?.undo.length); }
export function canRedoReport(state: EditorState): boolean { return Boolean(reportHistoryKey.getState(state)?.redo.length); }

export function runReportHistoryCommand(view: EditorView, direction: 'undo' | 'redo'): boolean {
  const history = reportHistoryKey.getState(view.state);
  const entry = direction === 'undo' ? history?.undo.at(-1) : history?.redo.at(-1);
  if (!entry) return false;
  const steps = direction === 'undo' ? entry.inverse : entry.forward;
  const targetSelection = direction === 'undo' ? entry.before : entry.after;
  try {
    let tr = view.state.tr;
    for (const json of steps) tr = tr.step(Step.fromJSON(view.state.schema, json));
    tr = tr.setSelection(Selection.fromJSON(tr.doc, targetSelection)).setMeta(reportHistoryKey, { type: direction } satisfies HistoryMeta);
    view.dispatch(tr);
    return true;
  } catch {
    // Never apply a partial edit. Drop only the invalid history record; the
    // persisted report document remains intact and normal saving can clean it.
    try { view.dispatch(view.state.tr.setMeta(reportHistoryKey, { type: 'reset', history: emptyHistory() } satisfies HistoryMeta)); } catch { /* Keep the document untouched if the editor is already closing. */ }
    return false;
  }
}

export function reportHistoryStorageBytes(history: StoredReportHistory): number {
  return new TextEncoder().encode(JSON.stringify(history)).byteLength;
}
