import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { getReportHistory, reportHistoryPlugin, reportHistoryStorageBytes, setDefaultReportHistoryDepth } from '../src/report-history.ts';

if (typeof global.gc !== 'function') throw new Error('Run this synthetic benchmark with node --expose-gc.');
const schema=new Schema({nodes:{doc:{content:'block+'},paragraph:{content:'text*',group:'block'},text:{group:'inline'}}});
function measure(depth){
 setDefaultReportHistoryDepth(depth);
 global.gc();
 const before=process.memoryUsage().heapUsed;
 let state=EditorState.create({schema,doc:schema.node('doc',null,[schema.node('paragraph')]),plugins:[reportHistoryPlugin()]});
 for(let i=0;i<depth;i++){
  const from=state.selection.from,text='x';
  let tr=state.tr.insertText(text,from);
  tr=tr.setSelection(TextSelection.create(tr.doc,from+1)).setMeta('uiEvent','paste');
  state=state.apply(tr);
 }
 global.gc();
 const heap=process.memoryUsage().heapUsed-before,history=getReportHistory(state),bytes=reportHistoryStorageBytes(history);
 assert.equal(history.undo.length,depth);
 assert.equal(state.doc.textContent.length,depth);
 return{depth,serializedBytes:bytes,heapDeltaBytes:heap};
}
const result=[measure(500),measure(1000)];
console.log('Synthetic report history storage and memory estimate:',JSON.stringify(result));
setDefaultReportHistoryDepth(500);
