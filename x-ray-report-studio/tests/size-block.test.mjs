import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSizeBlock } from '../src/size-block.ts';
test('size insertion uses modality units and break opportunities after slashes',()=>{
 for(const ct of [false,true]){
  const doc=makeSizeBlock(ct),runs=doc.content[0].content;
  assert.equal(runs.filter(run=>run.text==='/\u200b').length,2);
  assert.equal(runs.filter(run=>run.text==='0,0'&&run.marks?.[0].attrs.color==='#ffff00').length,3);
  assert.equal(runs.filter(run=>run.text===`\u00a0${ct?'мм':'см'}`).length,3);
 }
});
