import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { Step } from '@tiptap/pm/transform';
import { canRedoReport, canUndoReport, getReportHistory, reportHistoryKey, reportHistoryPlugin, reportHistoryStorageBytes, runReportHistoryCommand, sanitizeReportHistory, setDefaultReportHistoryDepth } from '../src/report-history.ts';

const schema = new Schema({ nodes: { doc: { content: 'block+' }, paragraph: { content: 'text*', group: 'block' }, text: { group: 'inline' } }, marks: { highlight: { attrs: { color: { default: '#ffff00' } } } } });
const initialState = () => EditorState.create({ schema, doc: schema.node('doc', null, [schema.node('paragraph')]), plugins: [reportHistoryPlugin()] });
function addAction(state, text) {
  const from = state.selection.from;
  let tr = state.tr.insertText(text, from);
  tr = tr.setSelection(TextSelection.create(tr.doc, from + text.length)).setMeta('uiEvent', 'paste');
  return state.apply(tr);
}

test('per-report history stores compact reversible ProseMirror steps and selects allowed depths', () => {
  for (const depth of [100, 250, 500, 1000]) {
    setDefaultReportHistoryDepth(depth);
    let state = initialState();
    for (let i = 0; i < depth + 1; i++) state = addAction(state, 'x');
    const history = getReportHistory(state);
    assert.equal(history.undo.length, depth);
    assert.equal(history.redo.length, 0);
    assert.ok(history.undo.every(entry => entry.forward[0].stepType === 'replace'));
    assert.ok(reportHistoryStorageBytes(history) > 0);
    assert.ok(canUndoReport(state));
    assert.equal(canRedoReport(state), false);
  }
  setDefaultReportHistoryDepth(500);
});

test('serialized operation history survives validation and a damaged history resets without changing the report', () => {
  setDefaultReportHistoryDepth(500);
  let state = addAction(initialState(), 'safe synthetic report text');
  const stored = JSON.parse(JSON.stringify(getReportHistory(state)));
  assert.equal(sanitizeReportHistory(stored).undo.length, 1);
  assert.equal(sanitizeReportHistory({ version: 1, undo: [{ forward: [{ stepType: 'unknown' }], inverse: [], before: {}, after: {}, time: 1, groupedInput: false }], redo: [] }).undo.length, 0);
  assert.equal(state.doc.textContent, 'safe synthetic report text');
});

test('Undo moves the operation to Redo and Redo restores it without cross-document state', () => {
  setDefaultReportHistoryDepth(500);
  let state = addAction(initialState(), 'synthetic A');
  const history = getReportHistory(state), entry = history.undo.at(-1);
  let undo = state.tr;
  for (const step of entry.inverse) undo = undo.step(Step.fromJSON(schema, step));
  undo = undo.setSelection(TextSelection.create(undo.doc, entry.before.head)).setMeta(reportHistoryKey, { type: 'undo' });
  state = state.apply(undo);
  assert.equal(state.doc.textContent, '');
  assert.equal(canUndoReport(state), false);
  assert.equal(canRedoReport(state), true);
  const redoEntry = getReportHistory(state).redo.at(-1);
  let redo = state.tr;
  for (const step of redoEntry.forward) redo = redo.step(Step.fromJSON(schema, step));
  redo = redo.setSelection(TextSelection.create(redo.doc, redoEntry.after.head)).setMeta(reportHistoryKey, { type: 'redo' });
  state = state.apply(redo);
  assert.equal(state.doc.textContent, 'synthetic A');
  assert.equal(canUndoReport(state), true);
  assert.equal(canRedoReport(state), false);
});

test('appended normalization steps share one Undo action and restore original yellow field marks', () => {
  setDefaultReportHistoryDepth(500);
  const highlight = schema.marks.highlight.create({ color: '#ffff00' });
  const original = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('0,0', [highlight])])]);
  let state = EditorState.create({ schema, doc: original, selection: TextSelection.create(original, 2), plugins: [reportHistoryPlugin()] });
  const userEdit = state.tr.replaceWith(1, 4, schema.text('1,2'));
  state = state.apply(userEdit);
  const normalization = state.tr.addMark(1, 4, highlight).setMeta('appendedTransaction', userEdit);
  state = state.apply(normalization);
  assert.equal(getReportHistory(state).undo.length, 1, 'automatic normalization is merged into the user edit');
  assert.equal(getReportHistory(state).undo[0].forward.length, 2);
  let undo = state.tr;
  for (const step of getReportHistory(state).undo[0].inverse) undo = undo.step(Step.fromJSON(schema, step));
  undo = undo.setSelection(TextSelection.create(undo.doc, 2)).setMeta(reportHistoryKey, { type: 'undo' });
  state = state.apply(undo);
  assert.equal(state.doc.textContent, '0,0');
  assert.ok(state.doc.firstChild.firstChild.marks.some(mark => mark.type.name === 'highlight'), 'Undo restores the original yellow placeholder mark');
});

test('a structurally valid but unsupported operation is discarded without changing report text', () => {
  setDefaultReportHistoryDepth(500);
  let state = addAction(initialState(), 'protected synthetic text');
  const invalid = { version: 1, undo: [{ forward: [{ stepType: 'unknown' }], inverse: [{ stepType: 'unknown' }], before: { type: 'text', anchor: 1, head: 1 }, after: { type: 'text', anchor: 2, head: 2 }, time: Date.now(), groupedInput: false }], redo: [] };
  state = state.apply(state.tr.setMeta(reportHistoryKey, { type: 'reset', history: invalid }));
  const view = { get state() { return state; }, dispatch(transaction) { state = state.apply(transaction); } };
  assert.equal(runReportHistoryCommand(view, 'undo'), false);
  assert.equal(state.doc.textContent, 'protected synthetic text');
  assert.equal(canUndoReport(state), false, 'the broken history stack is cleared');
});

test('history storage is bounded and a corrupt payload cannot contain an unbounded stack', () => {
  setDefaultReportHistoryDepth(1000);
  let state = initialState();
  for (let i = 0; i < 1000; i++) state = addAction(state, 'x');
  const history = getReportHistory(state);
  const bytes = reportHistoryStorageBytes(history);
  assert.equal(history.undo.length, 1000);
  assert.ok(bytes < 512 * 1024, `1000 short synthetic operations occupy ${bytes} serialized bytes`);
  assert.equal(sanitizeReportHistory({ version: 1, undo: history.undo, redo: history.redo, extra: 'x'.repeat(300 * 1024) }).undo.length, 0);
  setDefaultReportHistoryDepth(500);
});
