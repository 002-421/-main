import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSizeBlock } from '../src/size-block.ts';
test('size insertion matches compact numeric dimensions followed by orientation legend',()=>{
 for(const ct of [false,true]){
  const runs=makeSizeBlock(ct).content[0].content;
  const text=runs.map(run=>run.text).join('');
  assert.equal(text,`0,0х0,0х0,0\u00a0${ct?'мм':'см'} (фронтальный/\u200bсагиттальный/\u200bвертикальный)`);
  assert.equal(runs.filter(run=>run.text==='0,0'&&run.marks?.[0].attrs.color==='#ffff00').length,3);
 }
});
