import test from 'node:test';
import assert from 'node:assert/strict';
import { compactWordSpaces } from '../src/word-spacing.ts';
test('Word whitespace is compacted across formatted runs without modifying the editor content',()=>{
 const nodes=[{type:'text',text:'  Размеры  '},{type:'text',text:'   органа ',marks:[{type:'bold'}]},{type:'text',text:'  1,2\u00a0см   '}];
 const result=compactWordSpaces(nodes);
 assert.equal(result.map(n=>n.text).join(''),'Размеры органа 1,2\u00a0см');
 assert.equal(nodes[0].text,'  Размеры  ');
 assert.deepEqual(result[1].marks,[{type:'bold'}]);
});
