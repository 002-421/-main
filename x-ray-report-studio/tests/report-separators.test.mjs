import test from 'node:test';
import assert from 'node:assert/strict';
import { addReportSeparators } from '../src/report-separators.ts';
test('report separators remain two after repeated normalization with empty paragraphs',()=>{
 const p=text=>({type:'paragraph',content:text?[{type:'text',text}]:[]});
 const doc={type:'doc',content:[p('Вид исследования: МРТ'),p('Описание'),{type:'horizontalRule'},p(''),{type:'horizontalRule'},p(''),{type:'horizontalRule'},p('ЗАКЛЮЧЕНИЕ: норма')]};
 const once=addReportSeparators(doc),twice=addReportSeparators(once);
 assert.deepEqual(twice,once);
 assert.equal(twice.content.filter(n=>n.type==='horizontalRule').length,2);
});
